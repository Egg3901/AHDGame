import type { Db } from "mongodb";
import type { StatePartyOrg, PoliticalParty } from "@/lib/db/types";
import { DE_LAND_VOTE_SHARES_1990 } from "./deLandVoteShares1990";
import { DE_LAND_VOTE_SHARES_1953 } from "./deLandVoteShares1953";

/**
 * Calculate DE state party organization levels from Bundestag Zweitstimmen
 * shares per Bundesland. Picks the per-preset polling table:
 *   - `2019-default` (default) — 2021 Bundestag results (CDU/CSU/SPD/Greens/
 *     FDP/AfD/Linke).
 *   - `1991-default` — 1990 Bundestag results (CDU/CSU/SPD/Greens/FDP/PDS;
 *     no AfD or Linke).
 *   - `1953-default` — 1953 Bundestag results (CDU/CSU/SPD/FDP/DP/GB-BHE),
 *     over the 11 FRG Länder only.
 *
 * Before the 1953 table existed, `1953-default` fell through to the 2021 table.
 * SPD/CDU/CSU/FDP still resolved by name, so DE looked contested — but `dp` and
 * `gbbhe` had no slug at all, so the Deutsche Partei and the GB/BHE got ZERO
 * statePartyOrg rows in every region. A region WITH org data and no row for a
 * party is a hard block in `canPartyFieldInState`, so two of the six seeded
 * 1953 parties could not field a candidate anywhere (#3780). The stale table
 * also emitted BB/MV/SN/ST/TH rows, whose ids collide with the DDR's (#3780).
 *
 * Organisations scale from vote share:
 * - 0% vote → 5 org (minimal presence)
 * - 40% vote → 70 org (dominant party)
 *
 * CSU only contests in Bayern (its sister-party CDU stays out of BY). CDU
 * likewise has no presence in BY. Slug → sequentialId is resolved at runtime
 * against the live `politicalParties` collection so preset-filtered seeds
 * (e.g. PDS only under 1991, AfD/Linke only under 2019) are picked up
 * correctly without hardcoded ordering assumptions.
 */

const MIN_ORG = 5;
const MAX_ORG = 70;

// DE party abbreviation → DB name. Used by `buildDEPartySlugToSeqId` to look
// up live sequentialIds. Slugs match the polling tables in
// `deLandVoteShares1990.ts` and the inlined 2021 table below.
const DE_PARTY_SLUG_TO_NAME: Record<string, string> = {
  spd: "Sozialdemokratische Partei Deutschlands",
  cdu: "Christlich Demokratische Union",
  csu: "Christlich-Soziale Union in Bayern",
  grn: "Bündnis 90/Die Grünen",
  fdp: "Freie Demokratische Partei",
  lnk: "Die Linke",
  afd: "Alternative für Deutschland",
  pds: "Partei des Demokratischen Sozialismus",
  // 1953-only: Adenauer's two junior coalition partners in the 2nd Bundestag.
  // Both are `validForPresets: ["1953-default"]` in `deParties.ts`, so
  // `buildDEPartySlugToSeqId` simply omits them under every other preset.
  dp: "Deutsche Partei",
  gbbhe: "Gesamtdeutscher Block/BHE",
};

/**
 * 2021 Bundestag Zweitstimmen share per Land (%). CSU shown only in BY.
 * Omitting a party from a Land means "no presence seeded".
 */
const DE_LAND_VOTE_SHARES_2021: Record<string, Record<string, number>> = {
  BW: { spd: 22, cdu: 25, grn: 17, fdp: 15, afd: 10, lnk: 3 },
  BY: { spd: 18, csu: 32, grn: 14, fdp: 11, afd: 9, lnk: 3 },
  NW: { spd: 29, cdu: 26, grn: 16, fdp: 11, afd: 7, lnk: 4 },
  HE: { spd: 28, cdu: 23, grn: 16, fdp: 13, afd: 9, lnk: 4 },
  RP: { spd: 29, cdu: 25, grn: 13, fdp: 12, afd: 9, lnk: 3 },
  SL: { spd: 37, cdu: 24, grn: 10, fdp: 12, afd: 10, lnk: 4 },
  NI: { spd: 33, cdu: 24, grn: 16, fdp: 11, afd: 7, lnk: 3 },
  SH: { spd: 28, cdu: 22, grn: 18, fdp: 13, afd: 7, lnk: 3 },
  HH: { spd: 30, cdu: 15, grn: 25, fdp: 11, afd: 5, lnk: 7 },
  BRE: { spd: 32, cdu: 17, grn: 19, fdp: 9, afd: 7, lnk: 6 },
  BE: { spd: 23, cdu: 16, grn: 22, fdp: 9, afd: 8, lnk: 11 },
  BB: { spd: 30, cdu: 15, grn: 9, fdp: 9, afd: 18, lnk: 8 },
  MV: { spd: 29, cdu: 17, grn: 9, fdp: 8, afd: 18, lnk: 11 },
  SN: { spd: 19, cdu: 17, grn: 9, fdp: 11, afd: 25, lnk: 9 },
  ST: { spd: 25, cdu: 21, grn: 7, fdp: 10, afd: 20, lnk: 10 },
  TH: { spd: 23, cdu: 17, grn: 6, fdp: 9, afd: 24, lnk: 11 },
};

function calculateDEPartyOrg(voteShare: number): number {
  const scaled = MIN_ORG + (voteShare / 40) * (MAX_ORG - MIN_ORG);
  return Math.min(Math.max(Math.round(scaled), MIN_ORG), MAX_ORG);
}

/**
 * Resolve each DE party slug to the matching `sequentialId` in the DB.
 * Robust to preset filtering — only returns mappings for parties that
 * actually exist under the active preset (e.g. `pds` under 1991, `afd`
 * and `lnk` under 2019).
 */
export async function buildDEPartySlugToSeqId(db: Db): Promise<Record<string, string>> {
  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId: "DE" })
    .project<{ name: string; sequentialId: number }>({ name: 1, sequentialId: 1 })
    .toArray();
  const byName = new Map(parties.map((p) => [p.name, String(p.sequentialId)]));
  const out: Record<string, string> = {};
  for (const [slug, name] of Object.entries(DE_PARTY_SLUG_TO_NAME)) {
    const seqId = byName.get(name);
    if (seqId) out[slug] = seqId;
  }
  return out;
}

/**
 * Generate DE state party org entries from Zweitstimmen estimates. Creates
 * an entry per (region × party-with-non-zero-share) for parties that exist
 * in the DB under the active preset.
 *
 * `preset` selects the polling table: `1953-default` uses
 * `DE_LAND_VOTE_SHARES_1953`; `1991-default` uses `DE_LAND_VOTE_SHARES_1990`;
 * anything else (including the default `2019-default`) uses the 2021 dataset.
 */
export async function calculateDEStatePartyOrgs(
  db: Db,
  preset: string
): Promise<Omit<StatePartyOrg, "createdAt" | "updatedAt">[]> {
  const orgs: Omit<StatePartyOrg, "createdAt" | "updatedAt">[] = [];
  const slugToSeqId = await buildDEPartySlugToSeqId(db);
  const voteShares =
    preset === "1953-default"
      ? DE_LAND_VOTE_SHARES_1953
      : preset === "1991-default"
        ? DE_LAND_VOTE_SHARES_1990
        : DE_LAND_VOTE_SHARES_2021;

  for (const [landId, partyVotes] of Object.entries(voteShares)) {
    for (const [partySlug, voteShare] of Object.entries(partyVotes)) {
      const partySeqId = slugToSeqId[partySlug];
      if (!partySeqId) continue; // party not in DB under this preset
      const org = calculateDEPartyOrg(voteShare);

      orgs.push({
        _id: `${landId}_${partySeqId}`,
        countryId: "DE",
        stateId: landId,
        partyId: partySeqId,
        organization: org,
        chairId: null,
        viceChairId: null,
        treasurerId: null,
        treasury: 0,
        stateTaxRate: 5,
        politicalStrength: 0,
        hasPresence: true,
        consecutiveLosses: 0,
      });
    }
  }

  return orgs;
}

export default calculateDEStatePartyOrgs;
