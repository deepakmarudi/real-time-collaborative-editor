import test from "node:test";
import assert from "node:assert/strict";
import { TextOperation } from "./text-operation.js";

test("applies an insertion", () => {
  const before = "Hello world";
  const after = "Hello brave world";

  const operation = TextOperation.fromDiff(before, after);

  assert.equal(operation.apply(before), after);
});

test("applies a deletion", () => {
  const before = "Hello cruel world";
  const after = "Hello world";

  const operation = TextOperation.fromDiff(before, after);

  assert.equal(operation.apply(before), after);
});

test("applies a replacement", () => {
  const before = "I like Java";
  const after = "I like TypeScript";

  const operation = TextOperation.fromDiff(before, after);

  assert.equal(operation.apply(before), after);
});

test("serializes and restores an operation", () => {
  const original = "cat";
  const operation = TextOperation.fromDiff(original, "cart");

  const restored = TextOperation.fromJSON(operation.toJSON());

  assert.equal(restored.apply(original), "cart");
});

test("transforms simultaneous insertions", () => {
  const original = "ac";

  const accepted = TextOperation.fromDiff(original, "abc");
  const incoming = TextOperation.fromDiff(original, "aXc");

  const [, transformedIncoming] = TextOperation.transform(
    accepted,
    incoming
  );

  const result = transformedIncoming.apply(
    accepted.apply(original)
  );

  assert.equal(result, "abXc");
});

test("preserves insertion inside concurrent deletion", () => {
  const original = "abcd";

  const accepted = TextOperation.fromDiff(original, "abXcd");
  const incoming = TextOperation.fromDiff(original, "ad");

  const [, transformedIncoming] = TextOperation.transform(
    accepted,
    incoming
  );

  const result = transformedIncoming.apply(
    accepted.apply(original)
  );

  assert.equal(result, "aXd");
});

test("concurrent operations converge", () => {
  const original = "Hello world";

  const first = TextOperation.fromDiff(
    original,
    "Beautiful Hello world"
  );

  const second = TextOperation.fromDiff(
    original,
    "Hello JavaScript world"
  );

  const [firstPrime, secondPrime] = TextOperation.transform(
    first,
    second
  );

  const firstThenSecond = secondPrime.apply(
    first.apply(original)
  );

  const secondThenFirst = firstPrime.apply(
    second.apply(original)
  );

  assert.equal(firstThenSecond, secondThenFirst);
});