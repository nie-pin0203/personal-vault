import type { Mutation, Row } from "./types";
type Cache = { credentials: Row[]; categories: Row[]; pending: Mutation[] };
export const emptyCache = (): Cache => ({
  credentials: [],
  categories: [],
  pending: [],
});
// The persisted cache and queue contain only ciphertext and non-sensitive identifiers.
export function readCache(user: string): Cache {
  try {
    return (
      JSON.parse(localStorage.getItem(`miyu-cipher-${user}`) || "null") ||
      emptyCache()
    );
  } catch {
    return emptyCache();
  }
}
export function writeCache(user: string, cache: Cache) {
  localStorage.setItem(`miyu-cipher-${user}`, JSON.stringify(cache));
}
export function overlay(
  rows: Row[],
  pending: Mutation[],
  table: Mutation["table"],
) {
  const map = new Map(rows.map((r) => [r.id, r]));
  pending
    .filter((m) => m.table === table)
    .forEach((m) => {
      if (m.row) map.set(m.id, m.row);
      else map.delete(m.id);
    });
  return [...map.values()];
}
export function enqueue(queue: Mutation[], mutation: Mutation) {
  const previous = queue.find(
    (m) => m.id === mutation.id && m.table === mutation.table,
  );
  const next = {
    ...mutation,
    expected: previous?.expected ?? mutation.expected,
  };
  if (next.row) next.row = { ...next.row, version: next.expected + 1 };
  const rest = queue.filter((m) => m !== previous);
  return next.expected === 0 && !next.row ? rest : [...rest, next];
}
