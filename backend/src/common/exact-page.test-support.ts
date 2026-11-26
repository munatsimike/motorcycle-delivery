// In-memory adapter for service unit tests. SQL semantics are tested separately
// against PostgreSQL; this adapter only exercises hydration and API mapping.
export function mockExactPage<T extends { id: string }>(
  query: { values: unknown[] }, rows: T[], ownerOf: (row: T) => string,
  timeOf: (row: T) => Date | null | undefined, ascending = false,
) {
  const values = query.values;
  const owner = values[0];
  const take = Number(values[values.length - 1]);
  const cursor = values.length === 4 ? String(values[1]) : null;
  const cursorId = values.length === 4 ? String(values[2]) : null;
  const compare = (a: { at: string; id: string }, b: { at: string; id: string }) =>
    a.at.localeCompare(b.at) || a.id.localeCompare(b.id);
  return rows.filter(row => ownerOf(row) === owner && timeOf(row) != null)
    .map(row => ({ id: row.id, at: timeOf(row)!.toISOString() }))
    .filter(row => !cursor || (ascending ? compare(row, { at: cursor, id: cursorId! }) > 0 : compare(row, { at: cursor, id: cursorId! }) < 0))
    .sort((a, b) => (ascending ? 1 : -1) * compare(a, b)).slice(0, take);
}
