import { describe, expect, test } from "bun:test";
import { stepReadingPosition } from "../src/lib/reading-position";

describe("rapid sentence navigation", () => {
  test("two immediate next presses advance exactly two sentences", () => {
    let current = 7;
    current = stepReadingPosition(current, 1, 20);
    current = stepReadingPosition(current, 1, 20);
    expect(current).toBe(9);
  });

  test("movement stays inside the document", () => {
    expect(stepReadingPosition(0, -1, 10)).toBe(0);
    expect(stepReadingPosition(10, 1, 10)).toBe(10);
  });
});