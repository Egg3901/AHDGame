/**
 * SEED INDEPENDENCE: DO NOT DERIVE FROM ANOTHER ERA.
 * Authored for 2025 directly; never imports or transforms the 1953/1990/2021 tables.
 *
 * 2025 German Bundestag Zweitstimmen per Land
 *
 * Vote-share percentages from the 21st Bundestag election (23 February
 * 2025), the chamber `deRegions2027.ts` seats. Used by
 * `calculateDEStatePartyOrgs` when the active preset is `2027-default`.
 *
 * National result the regional table is calibrated against: CDU/CSU 28.5
 * (CDU 22.6 + CSU 6.0), AfD 20.8, SPD 16.4, Gruene 11.6, Linke 8.8,
 * BSW 5.0, FDP 4.3. The BSW (Sahra Wagenknecht Alliance, founded 2024) has
 * no `deParties.ts` seed, so its share goes unallocated rather than being
 * folded into a party that did not win it. The FDP fell below the 5%
 * threshold and left the Bundestag but continues as a seeded default.
 *
 * Key differences from the 2021 dataset:
 *   - Union weakest since the postwar era in the West (near 30% rather
 *     than mid-40s); SPD at historic lows outside Bremen and Lower Saxony.
 *   - AfD first in all five eastern Laender (32-39%) and near 20% in the
 *     West and South; Linke rebound strongest in Berlin (19.9%), Bremen
 *     and Hamburg.
 *   - CSU still only contests in BY; CDU still absent from BY.
 *
 * Values rounded for gameplay calibration from the official
 * Bundeswahlleiter 2025 Zweitstimmen-by-Land tables
 * (https://www.bundeswahlleiter.de/en/bundestagswahlen/2025/ergebnisse/bund.html),
 * cross-checked against the per-state summary table.
 */

export const DE_LAND_VOTE_SHARES_2025: Record<string, Record<string, number>> = {
  BW: { spd: 14, cdu: 32, grn: 14, fdp: 4, afd: 20, lnk: 7 },
  BY: { spd: 12, csu: 37, grn: 12, fdp: 4, afd: 19, lnk: 6 },
  NW: { spd: 20, cdu: 30, grn: 12, fdp: 4, afd: 17, lnk: 8 },
  HE: { spd: 18, cdu: 29, grn: 13, fdp: 5, afd: 18, lnk: 9 },
  RP: { spd: 19, cdu: 31, grn: 10, fdp: 5, afd: 20, lnk: 6 },
  SL: { spd: 22, cdu: 27, grn: 7, fdp: 4, afd: 22, lnk: 7 },
  NI: { spd: 23, cdu: 28, grn: 12, fdp: 4, afd: 18, lnk: 8 },
  SH: { spd: 19, cdu: 28, grn: 15, fdp: 5, afd: 16, lnk: 8 },
  HH: { spd: 23, cdu: 21, grn: 19, fdp: 4, afd: 11, lnk: 14 },
  BRE: { spd: 23, cdu: 20, grn: 16, fdp: 4, afd: 15, lnk: 15 },
  BE: { spd: 15, cdu: 18, grn: 17, fdp: 4, afd: 15, lnk: 20 },
  BB: { spd: 15, cdu: 18, grn: 7, fdp: 3, afd: 33, lnk: 11 },
  MV: { spd: 12, cdu: 18, grn: 5, fdp: 3, afd: 35, lnk: 12 },
  SN: { spd: 9, cdu: 20, grn: 7, fdp: 3, afd: 37, lnk: 11 },
  ST: { spd: 11, cdu: 19, grn: 4, fdp: 3, afd: 37, lnk: 11 },
  TH: { spd: 9, cdu: 19, grn: 4, fdp: 3, afd: 39, lnk: 15 },
};

export default DE_LAND_VOTE_SHARES_2025;
