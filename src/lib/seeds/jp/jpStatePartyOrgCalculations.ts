import type { Db } from "mongodb";
import type { StatePartyOrg, PoliticalParty } from "@/lib/db/types";
import { JP_REGION_VOTE_SHARES_1990 } from "./jpRegionVoteShares1990";

/**
 * Calculate JP state party organization levels from estimated vote shares.
 * Picks the per-preset polling table:
 *   - `2019-default` (default) - 2021 Shugiin PR-bloc results
 *     (LDP/CDP/Komeito/JCP/Ishin/DPFP).
 *   - `2027-default` - Oct 2024 Shugiin PR national shares regionalised
 *     (LDP/CDP/Komeito/JCP/Ishin/DPFP), directionally confirmed by the
 *     July 2025 Sangiin result (ruling coalition short of a majority;
 *     DPFP and Sanseito gains).
 *   - `1991-default` - 1990 Shugiin estimates by region
 *     (LDP/JSP/Komeito/JCP/DSP; no Ishin/CDP/DPFP).
 *   - `1953-default` - 1953 Shugiin estimates by region
 *     (Liberal Party / Japan Democratic Party / JSP / JCP).
 *
 * Before the 1953 table existed, `1953-default` fell through to the 2021 table,
 * of whose slugs only `jcp` resolves under the 1953 roster - so every JP region
 * seeded Communist-only party presence (the JCP polled 1.9% in 1953) and the
 * 1955 Shugiin race would have had a one-party field.
 *
 * Organizations scale from vote share:
 * - 0% vote → 5 org (minimal presence)
 * - 50% vote → 70 org (dominant party)
 *
 * Slug → sequentialId is resolved at runtime against the live
 * `politicalParties` collection so preset-filtered seeds (JSP/DSP under
 * 1991-only; CDP/Ishin/DPFP under 2019-only) are picked up correctly
 * without hardcoded ordering assumptions.
 */

const MIN_ORG = 5;
const MAX_ORG = 70;

// JP party slug → DB name. Used by `buildJPPartySlugToSeqId` to look up
// live sequentialIds. Slugs match the polling tables in
// `jpRegionVoteShares1990.ts` and the inlined 2021 and 2027 tables below.
const JP_PARTY_SLUG_TO_NAME: Record<string, string> = {
  ldp: "Liberal Democratic Party",
  cdp: "Constitutional Democratic Party",
  komeito: "Komeito",
  jcp: "Japanese Communist Party",
  ishin: "Nippon Ishin no Kai",
  dpfp: "Democratic Party for the People",
  jsp: "Japan Socialist Party",
  dsp: "Democratic Socialist Party",
  // 1953-only: Yoshida's Jiyūtō and the reformist bloc the preset seeds as the
  // Japan Democratic Party (the era's Kaishintō / Progressive successor line).
  jiyuto: "Liberal Party",
  jdp: "Japan Democratic Party",
};

/**
 * Estimated vote share by region and party (%).
 * Based on 2021 Shugiin PR bloc results, simplified to game regions.
 */
const JP_REGION_VOTE_SHARES_2021: Record<string, Record<string, number>> = {
  HOK: { ldp: 35, cdp: 25, komeito: 10, jcp: 8, ishin: 6, dpfp: 6 },
  TOH: { ldp: 42, cdp: 22, komeito: 9, jcp: 6, ishin: 5, dpfp: 5 },
  KAN: { ldp: 33, cdp: 20, komeito: 10, jcp: 8, ishin: 8, dpfp: 8 },
  CHU: { ldp: 38, cdp: 18, komeito: 10, jcp: 6, ishin: 7, dpfp: 7 },
  KNS: { ldp: 28, cdp: 15, komeito: 10, jcp: 7, ishin: 28, dpfp: 5 },
  CGK: { ldp: 40, cdp: 20, komeito: 9, jcp: 7, ishin: 6, dpfp: 5 },
  SHI: { ldp: 44, cdp: 18, komeito: 10, jcp: 6, ishin: 5, dpfp: 5 },
  KYU: { ldp: 40, cdp: 18, komeito: 10, jcp: 7, ishin: 6, dpfp: 6 },
};

/**
 * Estimated vote share by region and party (%) for the 2027-default preset,
 * anchored to the Oct 27 2024 Shugiin proportional-representation national
 * result and regionalised on known strongholds.
 *
 * National PR anchor (MIC): LDP 26.73, CDP 21.20, DPFP 11.32, Komeito 10.93,
 * Ishin 9.36, Reiwa 6.98, JCP 6.16, Sanseito 3.43, CPJ 2.10; turnout 53.8.
 * Seats: LDP 191, CDP 148, Ishin 38, DPFP 28, Komeito 24 (of 465).
 * Results portal: https://www.soumu.go.jp/senkyo/
 *
 * Only the six seeded continuing parties carry shares here; Reiwa, Sanseito,
 * and CPJ (about 12 points combined) are unseeded and left out of the org
 * denominator rather than smeared across seeded parties. Rows sum near 90,
 * matching the 2021 table convention.
 *
 * Directional check: the July 20 2025 Sangiin election left the LDP-Komeito
 * bloc at 122 of 248 (47 of 125 contested, short of a majority) while the
 * DPFP rose to 22 seats and Sanseito to 15. That confirms the table shape:
 * LDP down everywhere from 2021, CDP up, DPFP roughly doubled, JCP flat to
 * soft, Ishin flat outside a softer Kansai.
 *
 * Movement from the 2021 table: LDP minus 4 to 7 everywhere; CDP plus 2 to
 * 4 with Hokkaido and Kanto strongest; DPFP 11 to 13 (from 5 to 8) on its
 * 2024 PR breakthrough; Komeito flat; Ishin flat except Kansai 28 to 25;
 * JCP minus 1 in most regions.
 */
export const JP_REGION_VOTE_SHARES_2027: Record<string, Record<string, number>> = {
  HOK: { ldp: 30, cdp: 28, komeito: 10, jcp: 7, ishin: 5, dpfp: 11 },
  TOH: { ldp: 36, cdp: 24, komeito: 9, jcp: 5, ishin: 5, dpfp: 11 },
  KAN: { ldp: 28, cdp: 24, komeito: 11, jcp: 7, ishin: 9, dpfp: 12 },
  CHU: { ldp: 32, cdp: 21, komeito: 10, jcp: 5, ishin: 8, dpfp: 13 },
  KNS: { ldp: 24, cdp: 17, komeito: 11, jcp: 6, ishin: 25, dpfp: 9 },
  CGK: { ldp: 34, cdp: 23, komeito: 9, jcp: 6, ishin: 6, dpfp: 11 },
  SHI: { ldp: 37, cdp: 21, komeito: 10, jcp: 5, ishin: 5, dpfp: 11 },
  KYU: { ldp: 34, cdp: 21, komeito: 10, jcp: 6, ishin: 6, dpfp: 12 },
};

/**
 * Estimated vote share by region and party (%) for the April 1953 Shugiin
 * general election, simplified to game regions. National result: Yoshida's
 * Liberals ~39% plus the Hatoyama Liberal splinter ~9% (modeled together as
 * `jiyuto` since the preset seeds one Liberal Party), Kaishintō/Progressives
 * ~18% (modeled as the preset's Japan Democratic Party), the Right + Left
 * Socialists ~26% combined (modeled as the single seeded JSP), and the JCP
 * ~1.9%. Regionalised on the era pattern: Liberals dominant in the rural
 * west (Chugoku/Shikoku/Kyushu) and Tohoku, Socialists strongest in the
 * industrial Kanto/Kansai belt and Hokkaido, JCP marginal everywhere.
 *
 * Hokkaido (#3873): the Left Socialists' single strongest regional base in
 * this era was Hokkaido's tenant-farmer cooperatives and coal-mining unions -
 * the prefecture returned more JSP-aligned Diet members per seat than any
 * other region in the early-to-mid 1950s. HOK is seeded as the one region
 * where the Socialists' combined organisation actually leads the Liberals,
 * rather than merely narrowing the gap - every other region keeps `jiyuto`
 * on top, so the national aggregate stays Liberal-led as it was historically.
 */
export const JP_REGION_VOTE_SHARES_1953: Record<string, Record<string, number>> = {
  HOK: { jiyuto: 28, jdp: 15, jsp: 45, jcp: 3 },
  TOH: { jiyuto: 50, jdp: 20, jsp: 22, jcp: 1 },
  KAN: { jiyuto: 43, jdp: 17, jsp: 30, jcp: 3 },
  CHU: { jiyuto: 47, jdp: 19, jsp: 25, jcp: 2 },
  KNS: { jiyuto: 44, jdp: 16, jsp: 30, jcp: 3 },
  CGK: { jiyuto: 52, jdp: 18, jsp: 22, jcp: 1 },
  SHI: { jiyuto: 54, jdp: 17, jsp: 20, jcp: 1 },
  KYU: { jiyuto: 48, jdp: 19, jsp: 25, jcp: 2 },
};

function calculateJPPartyOrg(voteShare: number): number {
  const scaled = MIN_ORG + (voteShare / 50) * (MAX_ORG - MIN_ORG);
  return Math.min(Math.max(Math.round(scaled), MIN_ORG), MAX_ORG);
}

/**
 * Resolve each JP party slug to the matching `sequentialId` in the DB.
 * Robust to preset filtering - only returns mappings for parties that
 * actually exist under the active preset (e.g. `jsp` / `dsp` under
 * 1991, `cdp` / `ishin` / `dpfp` under 2019).
 */
export async function buildJPPartySlugToSeqId(db: Db): Promise<Record<string, string>> {
  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId: "JP" })
    .project<{ name: string; sequentialId: number }>({ name: 1, sequentialId: 1 })
    .toArray();
  const byName = new Map(parties.map((p) => [p.name, String(p.sequentialId)]));
  const out: Record<string, string> = {};
  for (const [slug, name] of Object.entries(JP_PARTY_SLUG_TO_NAME)) {
    const seqId = byName.get(name);
    if (seqId) out[slug] = seqId;
  }
  return out;
}

/**
 * Generate all JP state party org entries from vote share estimates.
 * `preset` selects the polling table: `1953-default` uses
 * `JP_REGION_VOTE_SHARES_1953`; `1991-default` uses
 * `JP_REGION_VOTE_SHARES_1990`; `2027-default` uses
 * `JP_REGION_VOTE_SHARES_2027`; anything else (including the default
 * `2019-default`) uses the 2021 dataset.
 */
export async function calculateJPStatePartyOrgs(
  db: Db,
  preset: string
): Promise<Omit<StatePartyOrg, "createdAt" | "updatedAt">[]> {
  const orgs: Omit<StatePartyOrg, "createdAt" | "updatedAt">[] = [];
  const slugToSeqId = await buildJPPartySlugToSeqId(db);
  const voteShares =
    preset === "1953-default"
      ? JP_REGION_VOTE_SHARES_1953
      : preset === "1991-default"
        ? JP_REGION_VOTE_SHARES_1990
        : preset === "2027-default"
          ? JP_REGION_VOTE_SHARES_2027
          : JP_REGION_VOTE_SHARES_2021;

  for (const [regionId, partyVotes] of Object.entries(voteShares)) {
    for (const [partySlug, voteShare] of Object.entries(partyVotes)) {
      const partySeqId = slugToSeqId[partySlug];
      if (!partySeqId) continue; // party not in DB under this preset
      const org = calculateJPPartyOrg(voteShare);

      orgs.push({
        _id: `${regionId}_${partySeqId}`,
        countryId: "JP",
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

export default calculateJPStatePartyOrgs;
