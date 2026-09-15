/**
 * Short collision-resistant id. Timestamp prefix keeps ids roughly sortable by
 * creation, which makes stored data easy to eyeball while debugging.
 */
export function makeId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
