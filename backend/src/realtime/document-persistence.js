import { query } from "../db/pool.js";

const SAVE_DELAY_MS = 800;
const RETRY_DELAY_MS = 2000;

const pendingSnapshots = new Map();
const saveTimers = new Map();
const activeSaves = new Map();

function armSaveTimer(documentId, delay) {
  const existingTimer = saveTimers.get(documentId);

  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    saveTimers.delete(documentId);

    flushDocumentSnapshot(documentId).catch((error) => {
      console.error(
        `Failed to persist document ${documentId}:`,
        error
      );

      if (pendingSnapshots.has(documentId)) {
        armSaveTimer(documentId, RETRY_DELAY_MS);
      }
    });
  }, delay);

  saveTimers.set(documentId, timer);
}

export function scheduleDocumentPersistence(
  documentId,
  snapshot
) {
  if (
    !snapshot ||
    typeof snapshot.content !== "string" ||
    !Number.isInteger(snapshot.version)
  ) {
    throw new Error("Invalid document snapshot");
  }

  const existingSnapshot = pendingSnapshots.get(documentId);

  if (
    existingSnapshot &&
    existingSnapshot.version > snapshot.version
  ) {
    return;
  }

  pendingSnapshots.set(documentId, {
    content: snapshot.content,
    version: snapshot.version,
  });

  armSaveTimer(documentId, SAVE_DELAY_MS);
}

async function persistSnapshot(documentId, snapshot) {
  const result = await query(
    `
    UPDATE documents
    SET
      content = $1,
      version = $2,
      updated_at = NOW()
    WHERE id = $3
      AND version < $2
    RETURNING version
    `,
    [snapshot.content, snapshot.version, documentId]
  );

  if (result.rowCount === 1) {
    console.log(
      `Persisted document ${documentId} at version ${snapshot.version}`
    );

    return;
  }

  const currentResult = await query(
    `
    SELECT content, version
    FROM documents
    WHERE id = $1
    `,
    [documentId]
  );

  if (currentResult.rows.length === 0) {
    throw new Error("Document no longer exists");
  }

  const databaseDocument = currentResult.rows[0];
  const databaseVersion = Number(databaseDocument.version);

  if (
    databaseVersion === snapshot.version &&
    databaseDocument.content === snapshot.content
  ) {
    return;
  }

  if (databaseVersion > snapshot.version) {
    return;
  }

  throw new Error(
    `Persistence conflict: database version is ${databaseVersion}, snapshot version is ${snapshot.version}`
  );
}

export async function flushDocumentSnapshot(documentId) {
  const activeSave = activeSaves.get(documentId);

  if (activeSave) {
    await activeSave;

    if (pendingSnapshots.has(documentId)) {
      return flushDocumentSnapshot(documentId);
    }

    return;
  }

  const snapshot = pendingSnapshots.get(documentId);

  if (!snapshot) return;

  pendingSnapshots.delete(documentId);

  const savePromise = persistSnapshot(documentId, snapshot);

  activeSaves.set(documentId, savePromise);

  try {
    await savePromise;
  } catch (error) {
    const newerSnapshot = pendingSnapshots.get(documentId);

    if (
      !newerSnapshot ||
      newerSnapshot.version < snapshot.version
    ) {
      pendingSnapshots.set(documentId, snapshot);
    }

    throw error;
  } finally {
    if (activeSaves.get(documentId) === savePromise) {
      activeSaves.delete(documentId);
    }
  }
}

export async function flushAllDocumentSnapshots() {
  for (const timer of saveTimers.values()) {
    clearTimeout(timer);
  }

  saveTimers.clear();

  await Promise.allSettled(activeSaves.values());

  const documentIds = [...pendingSnapshots.keys()];

  const results = await Promise.allSettled(
    documentIds.map((documentId) =>
      flushDocumentSnapshot(documentId)
    )
  );

  const failedResult = results.find(
    (result) => result.status === "rejected"
  );

  if (failedResult?.status === "rejected") {
    throw failedResult.reason;
  }
}