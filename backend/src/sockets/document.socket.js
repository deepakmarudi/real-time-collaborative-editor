import { query } from "../db/pool.js";
import { getDocumentForUser } from "../services/document-access.service.js";
import {
  DocumentState,
  OperationConflictError,
} from "../realtime/document-state.js";
import {
  scheduleDocumentPersistence,
} from "../realtime/document-persistence.js";
import { TextOperation } from "../realtime/text-operation.js";

const documentStates = new Map();
const documentQueues = new Map();

function getDocumentRoom(documentId) {
  return `document:${documentId}`;
}

function getUniqueActiveUsers(sockets) {
  const users = new Map();

  for (const activeSocket of sockets) {
    const user = activeSocket.data.user;

    if (!user?.id) continue;

    users.set(user.id, {
      id: user.id,
      name: user.name,
      email: user.email,
    });
  }

  return [...users.values()];
}

function buildRecovery(state, knownVersion) {
  if (!Number.isInteger(knownVersion)) {
    return {
      historyAvailable: false,
      missedOperations: [],
    };
  }

  try {
    const missedOperations =
      state.getOperationsAfter(knownVersion);

    return {
      historyAvailable: true,
      missedOperations: missedOperations.map((entry) => ({
        operationId: entry.operationId,
        baseVersion: entry.baseVersion,
        version: entry.version,
        operation: entry.operation.toJSON(),
      })),
    };
  } catch (error) {
    if (
      error instanceof OperationConflictError &&
      (error.code === "HISTORY_MISSING" ||
        error.code === "FUTURE_VERSION")
    ) {
      return {
        historyAvailable: false,
        missedOperations: [],
      };
    }

    throw error;
  }
}

async function getDocumentState(documentId) {
  const existingState = documentStates.get(documentId);

  if (existingState) {
    return existingState;
  }

  const result = await query(
    `
    SELECT content, version
    FROM documents
    WHERE id = $1
    `,
    [documentId]
  );

  if (result.rows.length === 0) {
    throw new OperationConflictError(
      "DOCUMENT_NOT_FOUND",
      "Document not found"
    );
  }

  const state = new DocumentState({
    content: result.rows[0].content,
    version: Number(result.rows[0].version),
    maxHistory: 200,
  });

  documentStates.set(documentId, state);

  return state;
}

function runForDocument(documentId, task) {
  const previousTask =
    documentQueues.get(documentId) ?? Promise.resolve();

  const currentTask = previousTask.then(task, task);

  const queueBarrier = currentTask.then(
    () => undefined,
    () => undefined
  );

  documentQueues.set(documentId, queueBarrier);

  queueBarrier.then(() => {
    if (documentQueues.get(documentId) === queueBarrier) {
      documentQueues.delete(documentId);
    }
  });

  return currentTask;
}

function sendOperationError(callback, error, documentId) {
  const state = documentStates.get(documentId);
  const snapshot = state?.getSnapshot();

  if (error instanceof OperationConflictError) {
    callback?.({
      ok: false,
      code: error.code,
      message: error.message,
      document: snapshot
        ? {
            content: snapshot.content,
            version: snapshot.version,
          }
        : undefined,
    });

    return;
  }

  console.error("Document operation failed:", error);

  callback?.({
    ok: false,
    code: "INTERNAL_ERROR",
    message: "Failed to apply document operation",
  });
}

export function registerDocumentSocketHandlers(io, socket) {
  socket.on("document:join", async (payload = {}, callback) => {
    const { documentId, knownVersion } = payload;

    if (typeof documentId !== "string" || !documentId) {
      callback?.({
        ok: false,
        code: "INVALID_DOCUMENT_ID",
        message: "Document ID is required",
      });

      return;
    }

    try {
      const access = await getDocumentForUser(
        socket.user.id,
        documentId,
        "viewer"
      );

      if (!access.ok) {
        callback?.({
          ok: false,
          code: "ACCESS_DENIED",
          message: access.message,
        });

        return;
      }

      const room = getDocumentRoom(documentId);

      const joinResult = await runForDocument(
        documentId,
        async () => {
          const state = await getDocumentState(documentId);

          const socketsBeforeJoin =
            await io.in(room).fetchSockets();

          const wasAlreadyActive = socketsBeforeJoin.some(
            (activeSocket) =>
              activeSocket.data.user?.id === socket.user.id
          );

          const recovery = buildRecovery(
            state,
            knownVersion
          );

          await socket.join(room);

          const socketsAfterJoin =
            await io.in(room).fetchSockets();

          return {
            snapshot: state.getSnapshot(),
            activeUsers:
              getUniqueActiveUsers(socketsAfterJoin),
            becameActive: !wasAlreadyActive,
            recovery,
          };
        }
      );

      callback?.({
        ok: true,
        document: {
          ...access.document,
          content: joinResult.snapshot.content,
          version: joinResult.snapshot.version,
        },
        activeUsers: joinResult.activeUsers,
        recovery: joinResult.recovery,
      });

      if (joinResult.becameActive) {
        socket.to(room).emit("presence:user-joined", {
          user: {
            id: socket.user.id,
            name: socket.user.name,
            email: socket.user.email,
          },
        });
      }
    } catch (error) {
      sendOperationError(callback, error, documentId);
    }
  });

  socket.on(
    "document:operation",
    async (payload = {}, callback) => {
      const {
        documentId,
        operationId,
        baseVersion,
        operation: serializedOperation,
      } = payload;

      if (typeof documentId !== "string" || !documentId) {
        callback?.({
          ok: false,
          code: "INVALID_DOCUMENT_ID",
          message: "Document ID is required",
        });

        return;
      }

      if (
        typeof operationId !== "string" ||
        !operationId ||
        operationId.length > 100
      ) {
        callback?.({
          ok: false,
          code: "INVALID_OPERATION_ID",
          message: "A valid operation ID is required",
        });

        return;
      }

      const room = getDocumentRoom(documentId);

      if (!socket.rooms.has(room)) {
        callback?.({
          ok: false,
          code: "NOT_JOINED",
          message: "Join the document before editing it",
        });

        return;
      }

      try {
        const access = await getDocumentForUser(
          socket.user.id,
          documentId,
          "editor"
        );

        if (!access.ok) {
          callback?.({
            ok: false,
            code: "ACCESS_DENIED",
            message: access.message,
          });

          return;
        }

        const accepted = await runForDocument(
          documentId,
          async () => {
            const state = await getDocumentState(documentId);

            let operation;

            try {
              operation = TextOperation.fromJSON(
                serializedOperation
              );
            } catch (error) {
              throw new OperationConflictError(
                "INVALID_OPERATION",
                error instanceof Error
                  ? error.message
                  : "Invalid operation"
              );
            }

            const result = state.acceptOperation({
              operationId,
              baseVersion,
              operation,
            });

            if (!result.duplicate) {
              scheduleDocumentPersistence(documentId, {
                content: result.content,
                version: result.version,
              });
            }

            return result;
          }
        );

        if (!accepted.duplicate) {
          socket.to(room).emit(
            "document:operation-applied",
            {
              documentId,
              operationId: accepted.operationId,
              baseVersion: accepted.version - 1,
              version: accepted.version,
              operation: accepted.operation.toJSON(),
              updatedBy: {
                id: socket.user.id,
                name: socket.user.name,
              },
            }
          );
        }

        callback?.({
          ok: true,
          operationId: accepted.operationId,
          version: accepted.version,
          currentVersion: accepted.currentVersion,
          duplicate: accepted.duplicate,
          operation: accepted.operation.toJSON(),
        });
      } catch (error) {
        sendOperationError(callback, error, documentId);
      }
    }
  );

  socket.on("disconnecting", async () => {
    for (const room of socket.rooms) {
      if (!room.startsWith("document:")) continue;

      const roomSockets = await io.in(room).fetchSockets();

      const hasAnotherActiveSocket = roomSockets.some(
        (activeSocket) =>
          activeSocket.id !== socket.id &&
          activeSocket.data.user?.id === socket.user.id
      );

      if (!hasAnotherActiveSocket) {
        socket.to(room).emit("presence:user-left", {
          user: {
            id: socket.user.id,
            name: socket.user.name,
          },
        });
      }
    }
  });
}