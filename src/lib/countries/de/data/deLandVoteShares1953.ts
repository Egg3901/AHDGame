/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Authored for 1953 directly; never imports or transforms the 1990/2021 tables.
 *
 * 1953 German Bundestag Zweitstimmen per Land
 *
 * Vote-share percentages from the 2nd Bundestag election (6 September 1953),
 * the chamber `deRegions1953.ts` seats. Used by `calculateDEStatePartyOrgs`
 * when the active preset is `1953-default`.
 *
 * National result the regional table is calibrated against: CDU 36.4 + CSU 8.8
 * = 45.2, SPD 28.8, FDP 9.5, GB/BHE 5.9, DP 3.3. Parties outside the seeded
 * 1953 roster are NOT modeled — the Bayernpartei (~9% in BY), Zentrum, the KPD
 * (2.2%, banned 1956) and the DRP have no `deParties.ts` seed, so their share
 * simply goes unallocated rather than being folded into a party that did not
 * win it.
 *
 * Key differences from the 1990 and 2021 datasets:
 *   - Greens (1980), PDS (1989), Linke (2007) and AfD (2013) all postdate the
 *     era. None appear here, and `deParties.ts` preset-filters them out anyway.
 *   - Two 1953-only parties DO appear, and this is the only table that carries
 *     them: `dp` (Deutsche Partei — Konrad Adenauer's Lower-Saxon coalition
 *     partner, a genuine regional force in NI/SH and negligible in the south)
 *     and `gbbhe` (Gesamtdeutscher Block/BHE — the expellee party, strongest
 *     exactly where the 1945-50 expulsions resettled: SH, NI, BY, HE). Before
 *     this table existed, `1953-default` fell through to the 2021 table, which
 *     has no slug for either — so DP and GB/BHE got NO statePartyOrg row in any
 *     region and `canPartyFieldInState` hard-blocked two of the six seeded 1953
 *     parties from fielding a single candidate (#3780).
 *   - Only the 11 FRG Länder of `deRegions1953.ts`. The 2021 fallback also
 *     emitted BB/MV/SN/ST/TH rows — regions that are not DE in 1953 and whose
 *     `${stateId}_${partySeqId}` ids collide with the DDR's own National-Front
 *     org rows (`ddRegions1953.ts` uses the same five ids).
 *   - CSU still only contests in BY; CDU still absent from BY.
 *
 * Two Länder had NO 1953 Bundestag vote and are explicitly modeled, not
 * copied — flagged here so the numbers are never mistaken for results:
 *   - SL (Saarland) was a French protectorate until 1957 and elected no
 *     Bundestag deputies. Seeded from the era's actual Saar party landscape
 *     (the pro-autonomy CVP mapping to CDU, the SPS to SPD, the DPS to FDP) so
 *     the region is contested rather than dead. DP and GB/BHE did not organise
 *     in the Saar and are omitted — an omitted party means "no presence
 *     seeded", which is the historically correct outcome here.
 *   - BE (West Berlin) sent 22 indirectly-elected, non-voting observer
 *     deputies under Four-Power status. Seeded from the Berlin Abgeordnetenhaus
 *     balance of the period (a strong SPD city under Ernst Reuter's successors),
 *     again with no DP/GB-BHE organisation.
 *
 * Values rounded for gameplay calibration from Bundeswahlleiter 1953
 * Zweitstimmen-by-Land tables.
 */

export const DE_LAND_VOTE_SHARES_1953: Record<string, Record<string, number>> = {
  BW: { cdu: 42, spd: 25, fdp: 17, gbbhe: 6, dp: 1 },
  BY: { csu: 47, spd: 23, fdp: 5, gbbhe: 6, dp: 1 }, // Bayernpartei ~9% unmodeled
  NW: { cdu: 43, spd: 31, fdp: 10, gbbhe: 3, dp: 2 },
  HE: { cdu: 35, spd: 35, fdp: 13, gbbhe: 8, dp: 2 },
  RP: { cdu: 46, spd: 27, fdp: 13, gbbhe: 6, dp: 1 },
  SL: { cdu: 30, spd: 25, fdp: 20 }, // MODELED — French protectorate, no Bundestag vote
  NI: { cdu: 35, spd: 29, fdp: 8, gbbhe: 11, dp: 11 }, // DP heartland
  SH: { cdu: 47, spd: 27, fdp: 7, gbbhe: 12, dp: 5 }, // heaviest expellee resettlement
  HH: { cdu: 39, spd: 38, fdp: 9, gbbhe: 5, dp: 4 },
  BRE: { cdu: 29, spd: 38, fdp: 13, gbbhe: 6, dp: 5 },
  BE: { cdu: 30, spd: 44, fdp: 13 }, // MODELED — observer deputies only, no direct vote
};

export default DE_LAND_VOTE_SHARES_1953;
