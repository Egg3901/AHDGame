/** Opening economic documents must contain finite money and balanced totals. */
export function nonFinitePaths(value: unknown, path = ""): string[] {
  if (typeof value === "number") return Number.isFinite(value) ? [] : [path];
  if (!value || typeof value !== "object" || value instanceof Date) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    nonFinitePaths(child, path ? `${path}.${key}` : key)
  );
}

export function reconciles(actual: number, expected: number, tolerance = 0.000001): boolean {
  return (
    Number.isFinite(actual) &&
    Number.isFinite(expected) &&
    Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * tolerance
  );
}
