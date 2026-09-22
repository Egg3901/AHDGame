/**
 * 1990 German Bundestag Zweitstimmen per Land
 *
 * Vote share percentages from the 12th Bundestag election (December 1990),
 * the first all-German parliamentary election after reunification. Used by
 * `calculateDEStatePartyOrgs` when the active preset is `1991-default`.
 *
 * Key differences from the 2021 dataset:
 *   - AfD doesn't exist yet (founded 2013). No `afd` entry.
 *   - Die Linke doesn't exist yet (founded 2007). The East-only PDS
 *     (Partei des Demokratischen Sozialismus, SED successor) gets the
 *     `pds` slot and only appears in the five new Länder + East Berlin.
 *   - Grüne is much smaller (3.8% West, 6% East as Bündnis 90/Grüne).
 *     Recorded under the same `grn` slug for engine compatibility — the
 *     two parallel organisations didn't formally merge until 1993.
 *   - CSU still only contests in BY; CDU still absent from BY.
 *
 * Values rounded for gameplay calibration from Bundeswahlleiter 1990
 * Zweitstimmen-by-Land tables.
 */

export const DE_LAND_VOTE_SHARES_1990: Record<string, Record<string, number>> = {
  BW: { spd: 30, cdu: 47, grn: 4, fdp: 11 },
  BY: { spd: 26, csu: 52, grn: 4, fdp: 9 },
  BE: { spd: 30, cdu: 38, grn: 5, fdp: 9, pds: 9 }, // East+West Berlin combined
  BB: { spd: 33, cdu: 36, grn: 6, fdp: 9, pds: 13 },
  BRE: { spd: 42, cdu: 30, grn: 9, fdp: 13 },
  HH: { spd: 40, cdu: 35, grn: 6, fdp: 13 },
  HE: { spd: 40, cdu: 41, grn: 5, fdp: 11 },
  MV: { spd: 27, cdu: 41, grn: 4, fdp: 9, pds: 14 },
  NI: { spd: 39, cdu: 41, grn: 5, fdp: 10 },
  NW: { spd: 41, cdu: 38, grn: 5, fdp: 11 },
  RP: { spd: 36, cdu: 45, grn: 4, fdp: 10 },
  SL: { spd: 51, cdu: 38, grn: 3, fdp: 5 },
  SN: { spd: 18, cdu: 50, grn: 5, fdp: 13, pds: 9 },
  ST: { spd: 24, cdu: 39, grn: 5, fdp: 19, pds: 9 },
  SH: { spd: 47, cdu: 33, grn: 5, fdp: 11 },
  TH: { spd: 22, cdu: 45, grn: 6, fdp: 14, pds: 8 },
};

export default DE_LAND_VOTE_SHARES_1990;
