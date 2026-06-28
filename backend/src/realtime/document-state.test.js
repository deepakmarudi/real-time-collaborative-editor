import test from "node:test";
import assert from "node:assert/strict";
import {
  DocumentState,
  OperationConflictError,
} from "./document-state.js";
import { TextOperation } from "./text-operation.js";

test("accepts an operation based on the current version", () => {
  const state = new DocumentState({
    content: "cat",
    version: 0,
  });

  const result = state.acceptOperation({
    operationId: "operation-1",
    baseVersion: 0,
    operation: TextOperation.fromDiff("cat", "cart"),
  });

  assert.equal(result.content, "cart");
  assert.equal(result.version, 1);
  assert.equal(result.duplicate, false);
});

test("transforms an operation based on an older version", () => {
  const state = new DocumentState({
    content: "ac",
    version: 0,
  });

  state.acceptOperation({
    operationId: "accepted-operation",
    baseVersion: 0,
    operation: TextOperation.fromDiff("ac", "abc"),
  });

  const result = state.acceptOperation({
    operationId: "stale-operation",
    baseVersion: 0,
    operation: TextOperation.fromDiff("ac", "aXc"),
  });

  assert.equal(result.content, "abXc");
  assert.equal(result.version, 2);
});

test("does not apply the same operation twice", () => {
  const state = new DocumentState({
    content: "cat",
    version: 0,
  });

  const input = {
    operationId: "same-operation",
    baseVersion: 0,
    operation: TextOperation.fromDiff("cat", "cart"),
  };

  state.acceptOperation(input);
  const duplicateResult = state.acceptOperation(input);

  assert.equal(duplicateResult.duplicate, true);
  assert.equal(state.getSnapshot().content, "cart");
  assert.equal(state.getSnapshot().version, 1);
});

test("rejects an operation from a future version", () => {
  const state = new DocumentState({
    content: "cat",
    version: 2,
  });

  assert.throws(
    () => {
      state.acceptOperation({
        operationId: "future-operation",
        baseVersion: 5,
        operation: TextOperation.fromDiff("cat", "cart"),
      });
    },
    (error) =>
      error instanceof OperationConflictError &&
      error.code === "FUTURE_VERSION"
  );
});

test("rejects an operation when history was removed", () => {
  const state = new DocumentState({
    content: "a",
    version: 0,
    maxHistory: 1,
  });

  state.acceptOperation({
    operationId: "operation-1",
    baseVersion: 0,
    operation: TextOperation.fromDiff("a", "ab"),
  });

  state.acceptOperation({
    operationId: "operation-2",
    baseVersion: 1,
    operation: TextOperation.fromDiff("ab", "abc"),
  });

  assert.throws(
    () => {
      state.acceptOperation({
        operationId: "old-operation",
        baseVersion: 0,
        operation: TextOperation.fromDiff("a", "Xa"),
      });
    },
    (error) =>
      error instanceof OperationConflictError &&
      error.code === "HISTORY_MISSING"
  );
});

test("returns ordered operations missed by a client", () => {
  const state = new DocumentState({
    content: "a",
    version: 0,
  });

  state.acceptOperation({
    operationId: "operation-1",
    baseVersion: 0,
    operation: TextOperation.fromDiff("a", "ab"),
  });

  state.acceptOperation({
    operationId: "operation-2",
    baseVersion: 1,
    operation: TextOperation.fromDiff("ab", "abc"),
  });

  const missedOperations = state.getOperationsAfter(0);

  assert.equal(missedOperations.length, 2);
  assert.equal(
    missedOperations[0].operationId,
    "operation-1"
  );
  assert.equal(missedOperations[0].version, 1);
  assert.equal(
    missedOperations[1].operationId,
    "operation-2"
  );
  assert.equal(missedOperations[1].version, 2);
});

test("rejects reconnect requests older than retained history", () => {
  const state = new DocumentState({
    content: "a",
    version: 0,
    maxHistory: 1,
  });

  state.acceptOperation({
    operationId: "operation-1",
    baseVersion: 0,
    operation: TextOperation.fromDiff("a", "ab"),
  });

  state.acceptOperation({
    operationId: "operation-2",
    baseVersion: 1,
    operation: TextOperation.fromDiff("ab", "abc"),
  });

  assert.throws(
    () => state.getOperationsAfter(0),
    (error) =>
      error instanceof OperationConflictError &&
      error.code === "HISTORY_MISSING"
  );
});