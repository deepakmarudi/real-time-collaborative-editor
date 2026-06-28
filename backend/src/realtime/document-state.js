import { TextOperation } from "./text-operation.js";

export class OperationConflictError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OperationConflictError";
    this.code = code;
  }
}

export class DocumentState {
  constructor({ content, version, maxHistory = 200 }) {
    if (typeof content !== "string") {
      throw new Error("Document content must be a string");
    }

    if (!Number.isInteger(version) || version < 0) {
      throw new Error(
        "Document version must be a non-negative integer"
      );
    }

    if (!Number.isInteger(maxHistory) || maxHistory < 1) {
      throw new Error(
        "Maximum history must be a positive integer"
      );
    }

    this.content = content;
    this.version = version;
    this.maxHistory = maxHistory;
    this.history = [];
    this.historyStartVersion = version;
  }

  acceptOperation({
    operationId,
    baseVersion,
    operation,
  }) {
    if (typeof operationId !== "string" || !operationId.trim()) {
      throw new OperationConflictError(
        "INVALID_OPERATION_ID",
        "Operation ID is required"
      );
    }

    if (!Number.isInteger(baseVersion) || baseVersion < 0) {
      throw new OperationConflictError(
        "INVALID_VERSION",
        "Base version must be a non-negative integer"
      );
    }

    if (!(operation instanceof TextOperation)) {
      throw new OperationConflictError(
        "INVALID_OPERATION",
        "A TextOperation instance is required"
      );
    }

    const existingOperation = this.history.find(
      (entry) => entry.operationId === operationId
    );

    if (existingOperation) {
      return {
        ...existingOperation,
        content: this.content,
        currentVersion: this.version,
        duplicate: true,
      };
    }

    if (baseVersion > this.version) {
      throw new OperationConflictError(
        "FUTURE_VERSION",
        `Client version ${baseVersion} is ahead of server version ${this.version}`
      );
    }

    if (baseVersion < this.historyStartVersion) {
      throw new OperationConflictError(
        "HISTORY_MISSING",
        "The operation is too old to transform"
      );
    }

    let transformedOperation = operation;
    let expectedVersion = baseVersion + 1;

    const newerOperations = this.history.filter(
      (entry) => entry.version > baseVersion
    );

    for (const acceptedEntry of newerOperations) {
      if (acceptedEntry.version !== expectedVersion) {
        throw new OperationConflictError(
          "HISTORY_MISSING",
          "Server operation history contains a version gap"
        );
      }

      const [, transformedIncoming] = TextOperation.transform(
        acceptedEntry.operation,
        transformedOperation
      );

      transformedOperation = transformedIncoming;
      expectedVersion += 1;
    }

    const nextContent = transformedOperation.apply(
      this.content
    );

    const nextVersion = this.version + 1;

    const acceptedEntry = {
      operationId,
      baseVersion,
      version: nextVersion,
      operation: transformedOperation,
    };

    this.content = nextContent;
    this.version = nextVersion;
    this.history.push(acceptedEntry);

    this.trimHistory();

    return {
      ...acceptedEntry,
      content: this.content,
      currentVersion: this.version,
      duplicate: false,
    };
  }

  getOperationsAfter(version) {
    if (!Number.isInteger(version) || version < 0) {
      throw new OperationConflictError(
        "INVALID_VERSION",
        "Known version must be a non-negative integer"
      );
    }

    if (version > this.version) {
      throw new OperationConflictError(
        "FUTURE_VERSION",
        `Client version ${version} is ahead of server version ${this.version}`
      );
    }

    if (version < this.historyStartVersion) {
      throw new OperationConflictError(
        "HISTORY_MISSING",
        "Required reconnect history is no longer available"
      );
    }

    let expectedVersion = version + 1;

    const operations = this.history.filter(
      (entry) => entry.version > version
    );

    for (const entry of operations) {
      if (entry.version !== expectedVersion) {
        throw new OperationConflictError(
          "HISTORY_MISSING",
          "Reconnect history contains a version gap"
        );
      }

      expectedVersion += 1;
    }

    return operations.map((entry) => ({
      operationId: entry.operationId,
      baseVersion: entry.version - 1,
      version: entry.version,
      operation: entry.operation,
    }));
  }

  trimHistory() {
    while (this.history.length > this.maxHistory) {
      const removedEntry = this.history.shift();

      this.historyStartVersion = removedEntry.version;
    }
  }

  getSnapshot() {
    return {
      content: this.content,
      version: this.version,
      historyStartVersion: this.historyStartVersion,
      historyLength: this.history.length,
    };
  }
}