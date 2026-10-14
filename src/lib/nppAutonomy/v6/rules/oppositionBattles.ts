/**
 * NPP engine 6.11: the opposition picks its battles (v6).
 *
 * Below v6 the opposition's NPPs bloc-vote against every government bill,
 * whatever the arithmetic. Against a government that commands the chamber
 * that bloc can never defeat anything, so it only stops opposition members
 * from backing bills they agree with. At v6 the bloc holds only while the
 * government side (governing party plus coalition partners) is short of a
 * commanding share of the lower chamber; above it, opposition NPPs vote their
 * own positions, home regions and donors like any other member.
 */

/** Government-side share of the chamber at which an opposition bloc is futile. */
export const OPPOSITION_FUTILE_SHARE = 0.55;

/** Government-side share of seats, from a live chamber tally. */
export function governmentSeatShare(
  seatsByParty: Readonly<Record<string, number>>,
  governingPartyIds: readonly string[]
): number {
  const total = Object.values(seatsByParty).reduce((sum, seats) => sum + Math.max(0, seats), 0);
  if (total <= 0) return 0;
  const government = new Set(governingPartyIds);
  const held = Object.entries(seatsByParty)
    .filter(([party]) => government.has(party))
    .reduce((sum, [, seats]) => sum + Math.max(0, seats), 0);
  return held / total;
}

/** Whether the opposition should bloc-vote against government bills at all. */
export function oppositionBlocWorthwhile(
  seatsByParty: Readonly<Record<string, number>>,
  governingPartyIds: readonly string[]
): boolean {
  return governmentSeatShare(seatsByParty, governingPartyIds) < OPPOSITION_FUTILE_SHARE;
}
