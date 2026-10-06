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

/**
 * A player country opens near the 0.5%-GDP deficit envelope. A surplus means
 * its program book is undersized against real receipts, so bound both sides.
 */
export const OPENING_DEFICIT_GDP_MAX = 0.0075;
export const OPENING_SURPLUS_GDP_MAX = 0.0025;

export function openingBalanceWithinEnvelope(surplus: number, gdp: number): boolean {
  if (!Number.isFinite(surplus) || !Number.isFinite(gdp) || gdp <= 0) return false;
  const balance = surplus / gdp;
  return balance >= -OPENING_DEFICIT_GDP_MAX && balance <= OPENING_SURPLUS_GDP_MAX;
}
