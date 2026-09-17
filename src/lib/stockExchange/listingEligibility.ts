/**
 * Canonical definition of an eligible tradable stock-exchange listing (#2033).
 *
 * A snapshot row is a *listing* (a visible operating firm) but only a subset
 * of rows are *tradable securities*. State enterprises with no issued shares
 * and no public float cannot trade, cannot carry a two-sided book, and must
 * not dilute securities breadth metrics. They stay visible as firms; they
 * leave every tradable denominator and numerator.
 *
 * Snapshot rows are already scoped to public, exchange-visible corporations
 * (the builder filters `isPrivate` / `hiddenFromExchange`, and dissolved
 * corporations are deleted, so they never appear as current rows). The only
 * remaining issuance signal on the row itself is shares vs float, which is
 * what this predicate checks. Every consumer (snapshot builder, vital-signs
 * metrics, UI) imports this module: do not re-derive the rule locally.
 *
 * Pure data-in/data-out so the rule ports to any future host unchanged.
 */
export interface TradabilitySlice {
  totalShares?: number | null;
  publicFloat?: number | null;
}

const finitePositive = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/** True when the row describes shares that can actually be issued and traded. */
export function isTradableListing(listing: TradabilitySlice): boolean {
  return finitePositive(listing.totalShares) && finitePositive(listing.publicFloat);
}

/** The current eligible set: every row that passes {@link isTradableListing}. */
export function tradableListings<T extends TradabilitySlice>(listings: T[]): T[] {
  return listings.filter(isTradableListing);
}

/** Ids of the current eligible set, for intersecting retained-window numerators. */
export function tradableListingIds(
  listings: Array<TradabilitySlice & { _id: { toString(): string } }>
): Set<string> {
  const ids = new Set<string>();
  for (const listing of listings) {
    if (isTradableListing(listing)) ids.add(listing._id.toString());
  }
  return ids;
}

/**
 * Clamp a breadth ratio into 0..1. Numerators are already intersected with
 * the eligible set, so clamping is defense in depth, never the correction.
 */
export function clampShare(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

/** Finite price-change value or the neutral fallback. Never NaN/Infinity. */
export function finitePriceChange(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
