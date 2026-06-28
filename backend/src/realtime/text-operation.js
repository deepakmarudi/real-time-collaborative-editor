function validateCount(count, label) {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

export class TextOperation {
  constructor() {
    this.ops = [];
    this.baseLength = 0;
    this.targetLength = 0;
  }

  retain(count) {
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

  insert(text) {
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

  delete(count) {
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

  apply(text) {
    if (typeof text !== "string") {
      throw new Error("Operation can only be applied to a string");
    }

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
        continue;
      }

      if (component > 0) {
        result += text.slice(
          sourceIndex,
          sourceIndex + component
        );

        sourceIndex += component;
        continue;
      }

      sourceIndex += Math.abs(component);
    }

    if (sourceIndex !== text.length) {
      throw new Error("Operation did not consume the complete text");
    }

    return result;
  }

  toJSON() {
    return {
      ops: [...this.ops],
    };
  }

  static fromJSON(value) {
    if (!value || !Array.isArray(value.ops)) {
      throw new Error("Invalid serialized operation");
    }

    const operation = new TextOperation();

    for (const component of value.ops) {
      if (typeof component === "string") {
        operation.insert(component);
      } else if (Number.isInteger(component) && component > 0) {
        operation.retain(component);
      } else if (Number.isInteger(component) && component < 0) {
        operation.delete(Math.abs(component));
      } else {
        throw new Error("Invalid operation component");
      }
    }

    return operation;
  }

  static fromDiff(beforeText, afterText) {
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

  static transform(firstOperation, secondOperation) {
    if (firstOperation.baseLength !== secondOperation.baseLength) {
      throw new Error("Operation base lengths do not match");
    }

    const firstPrime = new TextOperation();
    const secondPrime = new TextOperation();

    const firstOps = [...firstOperation.ops];
    const secondOps = [...secondOperation.ops];

    let firstIndex = 0;
    let secondIndex = 0;

    let first = firstOps[firstIndex++];
    let second = secondOps[secondIndex++];

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

        first -= length;
        second -= length;
      } else if (first < 0 && second < 0) {
        const length = Math.min(
          Math.abs(first),
          Math.abs(second)
        );

        first += length;
        second += length;
      } else if (first < 0 && second > 0) {
        const length = Math.min(Math.abs(first), second);

        firstPrime.delete(length);

        first += length;
        second -= length;
      } else if (first > 0 && second < 0) {
        const length = Math.min(first, Math.abs(second));

        secondPrime.delete(length);

        first -= length;
        second += length;
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