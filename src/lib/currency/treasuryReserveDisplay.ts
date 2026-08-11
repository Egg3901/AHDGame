/**
 * Post-cf-inconsistency-fix Phase 6: party/state-party treasury reserves are
 * persisted in the party's local home currency, matching the treasury they
 * gate. There is no longer any anchor↔local conversion on this surface — the
 * `<input>` value, the stored DB value, and the runtime reserve check all
 * speak the same units.
 *
 * The only helper here normalises a stored integer to a clean input string.
 * Kept as a single function (instead of inlined) so we have one place to
 * tweak if the input UX ever wants e.g. localized digit grouping.
 */
export function formatTreasuryReserveInputValue(amount: number | null | undefined): string {
  const value = Number.isFinite(amount) && (amount ?? 0) > 0 ? (amount as number) : 0;
  return Math.round(value).toString();
}
