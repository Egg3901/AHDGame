/**
 * Estimated IE regional vote share (%) by NUTS-III region and party slug.
 * Two preset tables — one per starting year. Used by
 * `calculateIEStatePartyOrgs` to seed `statePartyOrg.organization`.
 *
 * Slugs match the party-name lookups in
 * `ieStatePartyOrgCalculations.ts` and the seeded `politicalParties` rows.
 *
 * - 2024 baseline (2019-default preset): post-2024 General Election regional
 *   first-preference estimates. Parties: FF, FG, SF, Lab, Green.
 * - 1989 baseline (1991-default preset): 1989 General Election regional
 *   first-preference estimates. Parties: FF, FG, Lab, Workers' Party (WP),
 *   Progressive Democrats (PD).
 * - 1954 baseline (1953-default preset): 1954 General Election regional
 *   first-preference estimates. Parties: FF, FG, Lab.
 *
 * Numbers are calibration estimates derived from RTÉ tally / Tallymen
 * coverage and post-election summaries; they're not exact RL figures
 * because the 8 NUTS-III regions aggregate multiple Dáil constituencies.
 * The goal is org-tier calibration, not historical exactness — small drift
 * inside the 5–70 org band falls out in the wash once the registration-lane
 * step overwrites organization values.
 */
export const IE_REGION_VOTE_SHARES_2024: Record<string, Record<string, number>> = {
  DUB: { ff: 19, fg: 18, sf: 21, lab: 7, green: 6 },
  KIL: { ff: 23, fg: 21, sf: 18, lab: 5, green: 4 },
  MID: { ff: 26, fg: 23, sf: 17, lab: 4, green: 3 },
  WEX: { ff: 22, fg: 19, sf: 17, lab: 5, green: 3 },
  LIM: { ff: 25, fg: 22, sf: 17, lab: 4, green: 4 },
  COR: { ff: 22, fg: 23, sf: 17, lab: 5, green: 4 },
  GAL: { ff: 24, fg: 22, sf: 17, lab: 4, green: 3 },
  DON: { ff: 24, fg: 19, sf: 22, lab: 4, green: 3 },
};

export const IE_REGION_VOTE_SHARES_1989: Record<string, Record<string, number>> = {
  DUB: { ff: 38, fg: 28, lab: 12, wp: 7, pd: 7 },
  KIL: { ff: 44, fg: 30, lab: 9, wp: 2, pd: 7 },
  MID: { ff: 50, fg: 33, lab: 8, wp: 1, pd: 3 },
  WEX: { ff: 46, fg: 30, lab: 11, wp: 2, pd: 4 },
  LIM: { ff: 46, fg: 32, lab: 8, wp: 1, pd: 6 },
  COR: { ff: 41, fg: 32, lab: 11, wp: 2, pd: 7 },
  GAL: { ff: 49, fg: 34, lab: 7, wp: 1, pd: 4 },
  DON: { ff: 50, fg: 32, lab: 7, wp: 2, pd: 4 },
};

/**
 * 1954 baseline for the `1953-default` preset — the 18 May 1954 general
 * election, which seated the 15th Dáil that `ieRegions1953.ts` models
 * (147 seats) and which the `ieDail: 1954` cycle anchor already points at.
 *
 * National result: FF 43.4, FG 32.0, Labour 12.1. Clann na Poblachta (3.8),
 * Clann na Talmhan (3.1) and the large Independent bloc (~5.6) have no seed in
 * `ieParties.ts` and are deliberately NOT folded into FF/FG/Labour — their
 * share is simply unallocated, the same convention the BR and JP 1953 tables
 * use (#3781).
 *
 * Before this table existed, `1953-default` fell through to the 2024 table
 * (#3780). FF/FG/Labour all resolve by name there, so — unlike DE — IE did get
 * a row per region per party and was never presence-blocked. The defect was
 * pure calibration: 2024 gives a fragmented FF 19-26 / FG 18-23 field with
 * Sinn Féin's share silently dropped, where 1954 was a two-and-a-half party
 * system with FF above 40 nearly everywhere. That understated both big parties
 * by roughly half and flattened the org gap Labour should sit below.
 *
 * Regional shape: FF weakest in Dublin and strongest in the west and the
 * border; Labour concentrated in the "Labour belt" (Dublin, Kildare/Mid-East,
 * Carlow-Kilkenny-Wexford, Munster) and close to absent in Connacht/Ulster,
 * where Clann na Talmhan held the small-farmer vote.
 *
 * Dublin (#3873): FG's real base in this period was Dublin's southside
 * middle-class suburbs — Cumann na nGaedheal/Fine Gael had won Dublin
 * constituencies outright as far back as the 1920s-30s, and the party's TDs
 * and the 1954-57 inter-party government's leadership disproportionately sat
 * for Dublin seats. FF's national dominance was rural- and border-anchored
 * (see MID/GAL/DON below), not uniform — Dublin is the one region where its
 * organisation genuinely trails FG rather than merely narrowing. Every other
 * region keeps FF ahead, so the national aggregate stays FF-led (~43/32,
 * matching the real 1954 result) while the org seed is no longer a single
 * party leading in all 8.
 */
export const IE_REGION_VOTE_SHARES_1953: Record<string, Record<string, number>> = {
  DUB: { ff: 32, fg: 37, lab: 18 },
  KIL: { ff: 42, fg: 32, lab: 15 },
  MID: { ff: 46, fg: 33, lab: 9 },
  WEX: { ff: 41, fg: 31, lab: 18 },
  LIM: { ff: 44, fg: 30, lab: 14 },
  COR: { ff: 43, fg: 32, lab: 13 },
  GAL: { ff: 46, fg: 36, lab: 5 },
  DON: { ff: 45, fg: 33, lab: 4 },
};
