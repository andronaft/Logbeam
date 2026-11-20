/**
 * Calculates the new scroll position needed to keep a row visible within the viewport.
 * If the row is already fully visible, the current scrollTop is preserved.
 */
export function keepInView(rowIndex: number, rowHeight: number, scrollTop: number, clientHeight: number): number {
  if (clientHeight <= 0) return scrollTop;
  const top = rowIndex * rowHeight;
  const bottom = top + rowHeight;
  if (top < scrollTop) {
    return top;
  }
  if (bottom > scrollTop + clientHeight) {
    return Math.max(0, bottom - clientHeight);
  }
  return scrollTop;
}

/**
 * Computes the target index when moving selection by delta (+1 for next, -1 for previous).
 * When nothing is selected (currentIndex < 0), picks topVisibleIndex for forward (+1),
 * or max(0, topVisibleIndex - 1) for backward (-1) navigation.
 */
export function targetLineIndex(currentIndex: number, delta: number, totalLines: number, topVisibleIndex = 0): number {
  if (totalLines <= 0) return -1;
  if (currentIndex < 0) {
    const start = Math.max(0, Math.min(totalLines - 1, topVisibleIndex));
    return delta > 0 ? start : Math.max(0, start - 1);
  }
  return Math.max(0, Math.min(totalLines - 1, currentIndex + delta));
}

/**
 * The index of the next (direction +1) or previous (-1) item after `current` that passes `predicate`,
 * wrapping around at the ends; -1 when none does. `current` may be -1 (before the first item) or
 * `items.length` (after the last), e.g. when nothing is selected and the top of the view is used.
 */
export function findJump<T>(items: readonly T[], current: number, predicate: (item: T) => boolean, direction: 1 | -1): number {
  const n = items.length;
  if (n === 0) return -1;
  let start = current + direction;
  if (start < 0 || start >= n) start = direction > 0 ? 0 : n - 1;
  // from the item after (or before) current, once round
  for (let k = 0; k < n; k++) {
    const i = (start + direction * k + n) % n;
    if (predicate(items[i])) return i;
  }
  return -1;
}
