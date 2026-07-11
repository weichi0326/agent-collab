export function skillRowsForRetry<T>(
  rows: readonly T[],
  failedRowIndexes: ReadonlySet<number>,
): T[] {
  return rows.filter((_row, index) => failedRowIndexes.has(index));
}
