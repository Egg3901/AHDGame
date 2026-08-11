import type { Db } from "mongodb";
import type { StatePartyOrg, PoliticalParty } from "@/lib/db/types";
import {
  IE_REGION_VOTE_SHARES_2024,
  IE_REGION_VOTE_SHARES_1989,
  IE_REGION_VOTE_SHARES_1953,
} from "./ieRegionVoteShares";

/**
 * Calculate IE state party organization levels from estimated regional vote
 * shares. Picks the per-preset polling table:
 *   - `2019-default` (default) — 2024 General Election regional estimates
 *     (FF/FG/SF/Lab/Green).
 *   - `1991-default` — 1989 General Election regional estimates
 *     (FF/FG/Lab/WP/PD; SF abstentionist + no Dáil seats, Greens not yet
 *     significant).
 *   - `1953-default` — 1954 General Election regional estimates (FF/FG/Lab —
 *     the entire seeded 1953 IE roster).
 *
 * Before the 1953 table existed, `1953-default` fell through to the 2024
 * dataset (#3780). All three 1953 parties resolve by name there, so IE was
 * never presence-blocked the way DE was — but a 1954 world was calibrated to a
 * fragmented 2024 field (FF 19-26, FG 18-23) instead of FF ~43 / FG ~32.
 *
 * Organizations scale from vote share, matching the JP / DE / CN pattern:
 * - 0% vote → 5 org (minimal presence)
 * - 50% vote → 70 org (dominant party)
 *
 * Slug → sequentialId is resolved at runtime against the live
 * `politicalParties` collection so preset-filtered seeds (SF / Greens under
 * 2019-only; WP / PD under 1991-only) are picked up correctly without
 * hardcoded ordering assumptions.
 */

const MIN_ORG = 5;
const MAX_ORG = 70;

const IE_PARTY_SLUG_TO_NAME: Record<string, string> = {
  ff: "Fianna Fáil",
  fg: "Fine Gael",
  sf: "Sinn Féin",
  lab: "Labour",
  green: "Green Party",
  wp: "Workers' Party",
  pd: "Progressive Democrats",
};

function calculateIEPartyOrg(voteShare: number): number {
  const scaled = MIN_ORG + (voteShare / 50) * (MAX_ORG - MIN_ORG);
  return Math.min(Math.max(Math.round(scaled), MIN_ORG), MAX_ORG);
}

/**
 * Resolve each IE party slug to the matching `sequentialId` in the DB.
 * Robust to preset filtering — only returns mappings for parties that
 * actually exist under the active preset.
 */
export async function buildIEPartySlugToSeqId(db: Db): Promise<Record<string, string>> {
  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId: "IE" })
    .project<{ name: string; sequentialId: number }>({ name: 1, sequentialId: 1 })
    .toArray();
  const byName = new Map(parties.map((p) => [p.name, String(p.sequentialId)]));
  const out: Record<string, string> = {};
  for (const [slug, name] of Object.entries(IE_PARTY_SLUG_TO_NAME)) {
    const seqId = byName.get(name);
    if (seqId) out[slug] = seqId;
  }
  return out;
}

/**
 * Generate all IE state party org entries from vote-share estimates.
 * `preset` selects the polling table: `1953-default` uses the 1954 dataset;
 * `1991-default` uses the 1989 dataset; anything else (including the default
 * `2019-default`) uses the 2024 dataset.
 */
export async function calculateIEStatePartyOrgs(
  db: Db,
  preset: string
): Promise<Omit<StatePartyOrg, "createdAt" | "updatedAt">[]> {
  const orgs: Omit<StatePartyOrg, "createdAt" | "updatedAt">[] = [];
  const slugToSeqId = await buildIEPartySlugToSeqId(db);
  const voteShares =
    preset === "1953-default"
      ? IE_REGION_VOTE_SHARES_1953
      : preset === "1991-default"
        ? IE_REGION_VOTE_SHARES_1989
        : IE_REGION_VOTE_SHARES_2024;

  for (const [regionId, partyVotes] of Object.entries(voteShares)) {
    for (const [partySlug, voteShare] of Object.entries(partyVotes)) {
      const partySeqId = slugToSeqId[partySlug];
      if (!partySeqId) continue;
      const org = calculateIEPartyOrg(voteShare);

      orgs.push({
        _id: `${regionId}_${partySeqId}`,
        countryId: "IE",
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

export default calculateIEStatePartyOrgs;
