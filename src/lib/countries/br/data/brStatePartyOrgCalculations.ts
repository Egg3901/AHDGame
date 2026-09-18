import type { Db } from "mongodb";
import type { StatePartyOrg, PoliticalParty } from "@/lib/db/types";

/**
 * Calculate BR state party organization levels from estimated regional vote shares.
 *
 * Three preset rosters:
 *   - `2019-default` — PT / PL / MDB / UNIÃO / PSD
 *   - `1991-default` — PMDB / PFL / PDT / PDS / PTB / PRN / PSB / PCdoB + PT / PSD
 *   - `1953-default` — PSD (Vargas-era) / UDN / PTB
 *
 * Before the 1953 table existed, `1953-default` fell through to the 2019 table,
 * whose slugs (pt / pl / mdb / uniao / psd-modern) resolve to NO party under the
 * 1953 roster — so BR seeded ZERO statePartyOrg rows and its 1954 Câmara races
 * had no party presence to field candidates through (`canPartyFieldInState`).
 *
 * Organizations scale from vote share:
 * - 0% vote → 5 org (minimal presence)
 * - 50% vote → 70 org (dominant party)
 *
 * Slug → sequentialId is resolved at runtime against the live
 * `politicalParties` collection so preset-filtered seeds are picked up
 * correctly without hardcoded ordering assumptions.
 */

const MIN_ORG = 5;
const MAX_ORG = 70;

// BR party slug → DB name. Used by `buildBRPartySlugToSeqId` to look up
// live sequentialIds. Slugs match the polling tables below.
const BR_PARTY_SLUG_TO_NAME: Record<string, string> = {
  pt: "Partido dos Trabalhadores",
  pl: "Partido Liberal",
  mdb: "MDB",
  uniao: "União Brasil",
  psd: "PSD",
  pmdb: "Partido do Movimento Democrático Brasileiro",
  pfl: "Partido da Frente Liberal",
  pdt: "Partido Democrático Trabalhista",
  pds: "Partido Democrático Social",
  ptb: "Partido Trabalhista Brasileiro",
  prn: "Partido da Reconstrução Nacional",
  psb: "Partido Socialista Brasileiro",
  pcob: "Partido Comunista do Brasil",
  // 1953 Second Republic. `ptb` above already resolves the Vargas-era PTB —
  // the 1991 and 1953 entries share the name "Partido Trabalhista Brasileiro"
  // and only one is preset-valid at a time. The Vargas-era PSD is a DIFFERENT
  // party from the modern `psd` (founded 2011), so it needs its own slug.
  psd1945: "Partido Social Democrático",
  udn: "União Democrática Nacional",
};

/**
 * Estimated 2018 presidential first-round vote share by macro-region and party (%).
 * Simplified from actual regional patterns. PT dominant in NE, PL strong in S/CO.
 */
const BR_REGION_VOTE_SHARES_2019: Record<string, Record<string, number>> = {
  NORTE: { pt: 28, pl: 22, mdb: 12, uniao: 10, psd: 8 },
  NORDESTE: { pt: 42, pl: 18, mdb: 10, uniao: 8, psd: 6 },
  CENTRO_OESTE: { pt: 22, pl: 28, mdb: 15, uniao: 12, psd: 10 },
  SUDESTE: { pt: 25, pl: 30, mdb: 12, uniao: 10, psd: 10 },
  SUL: { pt: 18, pl: 35, mdb: 10, uniao: 12, psd: 10 },
};

/**
 * Estimated 1990 Câmara composition by macro-region and party (%).
 * PMDB was the dominant catch-all; PFL strong in NE; PT rising but still
 * regionalised to the industrial SE/S.
 */
const BR_REGION_VOTE_SHARES_1991: Record<string, Record<string, number>> = {
  NORTE: { pmdb: 28, pfl: 18, pdt: 8, pds: 10, ptb: 8, prn: 6, psb: 4, pcob: 2, pt: 8, psd: 8 },
  NORDESTE: { pmdb: 30, pfl: 25, pdt: 10, pds: 8, ptb: 6, prn: 4, psb: 3, pcob: 2, pt: 6, psd: 6 },
  CENTRO_OESTE: {
    pmdb: 32,
    pfl: 15,
    pdt: 8,
    pds: 12,
    ptb: 10,
    prn: 6,
    psb: 3,
    pcob: 2,
    pt: 6,
    psd: 6,
  },
  SUDESTE: { pmdb: 25, pfl: 12, pdt: 10, pds: 10, ptb: 8, prn: 8, psb: 6, pcob: 3, pt: 12, psd: 6 },
  SUL: { pmdb: 28, pfl: 14, pdt: 8, pds: 14, ptb: 10, prn: 6, psb: 4, pcob: 2, pt: 8, psd: 6 },
};

/**
 * Estimated 1950 Câmara dos Deputados vote share by macro-region and party (%).
 * The 1950 general election seated the legislature sitting in 1953 (PSD 112 /
 * UDN 81 / PTB 51 of 304 seats; national shares ≈ PSD 22 / UDN 20 / PTB 17).
 * Regionalised on the well-known Second-Republic pattern: PSD is the dominant
 * interior/machine party everywhere, UDN is strongest in the Nordeste (Bahia,
 * Pernambuco) and the urban middle class, and PTB is concentrated in Vargas's
 * Rio Grande do Sul base (SUL) and the industrial Rio/São Paulo belt (SUDESTE).
 * Parties outside the seeded 1953 roster (PSP, PR, PDC, PTN) are not modeled.
 */
export const BR_REGION_VOTE_SHARES_1953: Record<string, Record<string, number>> = {
  NORTE: { psd1945: 30, udn: 22, ptb: 14 },
  NORDESTE: { psd1945: 28, udn: 26, ptb: 10 },
  CENTRO_OESTE: { psd1945: 32, udn: 22, ptb: 12 },
  SUDESTE: { psd1945: 26, udn: 18, ptb: 22 },
  SUL: { psd1945: 22, udn: 16, ptb: 32 },
};

function calculateBRPartyOrg(voteShare: number): number {
  const scaled = MIN_ORG + (voteShare / 50) * (MAX_ORG - MIN_ORG);
  return Math.min(Math.max(Math.round(scaled), MIN_ORG), MAX_ORG);
}

/**
 * Resolve each BR party slug to the matching `sequentialId` in the DB.
 * Robust to preset filtering — only returns mappings for parties that
 * actually exist under the active preset.
 */
export async function buildBRPartySlugToSeqId(db: Db): Promise<Record<string, string>> {
  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId: "BR" })
    .project<{ name: string; sequentialId: number }>({ name: 1, sequentialId: 1 })
    .toArray();
  const byName = new Map(parties.map((p) => [p.name, String(p.sequentialId)]));
  const out: Record<string, string> = {};
  for (const [slug, name] of Object.entries(BR_PARTY_SLUG_TO_NAME)) {
    const seqId = byName.get(name);
    if (seqId) out[slug] = seqId;
  }
  return out;
}

/**
 * Generate all BR state party org entries from vote share estimates.
 * `preset` selects the polling table: `1953-default` uses
 * `BR_REGION_VOTE_SHARES_1953`; `1991-default` uses
 * `BR_REGION_VOTE_SHARES_1991`; anything else (including the default
 * `2019-default`) uses the 2019 dataset.
 */
export async function calculateBRStatePartyOrgs(
  db: Db,
  preset: string
): Promise<Omit<StatePartyOrg, "createdAt" | "updatedAt">[]> {
  const orgs: Omit<StatePartyOrg, "createdAt" | "updatedAt">[] = [];
  const slugToSeqId = await buildBRPartySlugToSeqId(db);
  const voteShares =
    preset === "1953-default"
      ? BR_REGION_VOTE_SHARES_1953
      : preset === "1991-default"
        ? BR_REGION_VOTE_SHARES_1991
        : BR_REGION_VOTE_SHARES_2019;

  for (const [regionId, partyVotes] of Object.entries(voteShares)) {
    for (const [partySlug, voteShare] of Object.entries(partyVotes)) {
      const partySeqId = slugToSeqId[partySlug];
      if (!partySeqId) continue; // party not in DB under this preset
      const org = calculateBRPartyOrg(voteShare);

      orgs.push({
        _id: `${regionId}_${partySeqId}`,
        countryId: "BR",
        stateId: regionId,
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

export default calculateBRStatePartyOrgs;
