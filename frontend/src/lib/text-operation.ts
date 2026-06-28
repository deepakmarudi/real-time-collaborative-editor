export type OperationComponent = number | string;

export type SerializedTextOperation = {
  ops: OperationComponent[];
};

function validateCount(count: number, label: string) {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

export class TextOperation {
  ops: OperationComponent[] = [];
  baseLength = 0;
  targetLength = 0;

  retain(count: number) {
    validateCount(count, "Retain count");

    if (count === 0) return this;

    this.baseLength += count;
    this.targetLength += count;

    const lastIndex = this.ops.length - 1;
    const lastOperation = this.ops[lastIndex];

    if (typeof lastOperation === "number" && lastOperation > 0) {
      this.ops[lastIndex] = lastOperation + count;
    } else {
      this.ops.push(count);
    }

    return this;
  }

  insert(text: string) {
    if (typeof text !== "string") {
      throw new Error("Inserted value must be a string");
    }

    if (text.length === 0) return this;

    this.targetLength += text.length;

    const lastIndex = this.ops.length - 1;
    const lastOperation = this.ops[lastIndex];

    if (typeof lastOperation === "string") {
      this.ops[lastIndex] = lastOperation + text;
      return this;
    }

    if (typeof lastOperation === "number" && lastOperation < 0) {
      const previousOperation = this.ops[lastIndex - 1];

      if (typeof previousOperation === "string") {
        this.ops[lastIndex - 1] = previousOperation + text;
      } else {
        this.ops.splice(lastIndex, 0, text);
      }

      return this;
    }

    this.ops.push(text);
    return this;
  }

  delete(count: number) {
    validateCount(count, "Delete count");

    if (count === 0) return this;

    this.baseLength += count;

    const lastIndex = this.ops.length - 1;
    const lastOperation = this.ops[lastIndex];

    if (typeof lastOperation === "number" && lastOperation < 0) {
      this.ops[lastIndex] = lastOperation - count;
    } else {
      this.ops.push(-count);
    }

    return this;
  }

  apply(text: string) {
    if (text.length !== this.baseLength) {
      throw new Error(
        `Expected text length ${this.baseLength}, received ${text.length}`
      );
    }

    let sourceIndex = 0;
    let result = "";

    for (const component of this.ops) {
      if (typeof component === "string") {
        result += component;
      } else if (component > 0) {
        result += text.slice(
          sourceIndex,
          sourceIndex + component
        );

        sourceIndex += component;
      } else {
        sourceIndex += Math.abs(component);
      }
    }

    if (sourceIndex !== text.length) {
      throw new Error("Operation did not consume the complete text");
    }

    return result;
  }

  toJSON(): SerializedTextOperation {
    return {
      ops: [...this.ops],
    };
  }

  static fromJSON(value: unknown) {
    if (typeof value !== "object" || value === null) {
      throw new Error("Invalid serialized operation");
    }

    const serialized = value as { ops?: unknown };

    if (!Array.isArray(serialized.ops)) {
      throw new Error("Invalid serialized operation");
    }

    const operation = new TextOperation();

    for (const component of serialized.ops) {
      if (typeof component === "string") {
        operation.insert(component);
      } else if (
        typeof component === "number" &&
        Number.isInteger(component) &&
        component > 0
      ) {
        operation.retain(component);
      } else if (
        typeof component === "number" &&
        Number.isInteger(component) &&
        component < 0
      ) {
        operation.delete(Math.abs(component));
      } else {
        throw new Error("Invalid operation component");
      }
    }

    return operation;
  }

  static fromDiff(beforeText: string, afterText: string) {
    let prefixLength = 0;

    while (
      prefixLength < beforeText.length &&
      prefixLength < afterText.length &&
      beforeText[prefixLength] === afterText[prefixLength]
    ) {
      prefixLength += 1;
    }

    let suffixLength = 0;

    while (
      suffixLength < beforeText.length - prefixLength &&
      suffixLength < afterText.length - prefixLength &&
      beforeText[beforeText.length - 1 - suffixLength] ===
        afterText[afterText.length - 1 - suffixLength]
    ) {
      suffixLength += 1;
    }

    const deletedLength =
      beforeText.length - prefixLength - suffixLength;

    const insertedText = afterText.slice(
      prefixLength,
      afterText.length - suffixLength
    );

    return new TextOperation()
      .retain(prefixLength)
      .delete(deletedLength)
      .insert(insertedText)
      .retain(suffixLength);
  }

  static transform(
    firstOperation: TextOperation,
    secondOperation: TextOperation
  ): [TextOperation, TextOperation] {
    if (firstOperation.baseLength !== secondOperation.baseLength) {
      throw new Error("Operation base lengths do not match");
    }

    const firstPrime = new TextOperation();
    const secondPrime = new TextOperation();

    const firstOps = [...firstOperation.ops];
    const secondOps = [...secondOperation.ops];

    let firstIndex = 0;
    let secondIndex = 0;

    let first: OperationComponent | undefined =
      firstOps[firstIndex++];

    let second: OperationComponent | undefined =
      secondOps[secondIndex++];

    while (first !== undefined || second !== undefined) {
      if (typeof first === "string") {
        firstPrime.insert(first);
        secondPrime.retain(first.length);
        first = firstOps[firstIndex++];
        continue;
      }

      if (typeof second === "string") {
        firstPrime.retain(second.length);
        secondPrime.insert(second);
        second = secondOps[secondIndex++];
        continue;
      }

      if (first === undefined || second === undefined) {
        throw new Error("Operations cover different source text");
      }

      if (first > 0 && second > 0) {
        const length = Math.min(first, second);

        firstPrime.retain(length);
        secondPrime.retain(length);

        first = first - length;
        second = second - length;
      } else if (first < 0 && second < 0) {
        const length = Math.min(
          Math.abs(first),
          Math.abs(second)
        );

        first = first + length;
        second = second + length;
      } else if (first < 0 && second > 0) {
        const length = Math.min(Math.abs(first), second);

        firstPrime.delete(length);

        first = first + length;
        second = second - length;
      } else if (first > 0 && second < 0) {
        const length = Math.min(first, Math.abs(second));

        secondPrime.delete(length);

        first = first - length;
        second = second + length;
      } else {
        throw new Error("Invalid operation components");
      }

      if (first === 0) {
        first = firstOps[firstIndex++];
      }

      if (second === 0) {
        second = secondOps[secondIndex++];
      }
    }

    return [firstPrime, secondPrime];
  }
}