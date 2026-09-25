/** Resolve one immediate reader move from the latest in-memory position. */
export function stepReadingPosition(current: number, direction: 1 | -1, maxIndex: number): number {
  return Math.max(0, Math.min(current + direction, maxIndex));
}