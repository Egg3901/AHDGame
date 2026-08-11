import type { Db } from "mongodb";
import type { StatePartyOrg, PoliticalParty } from "@/lib/db/types";

/**
 * Calculate NG state party organization levels from estimated zonal vote shares.
 *
 * Preset rosters:
 *   - `1953-default` — NCNC / AG / NPC (late-colonial regional triad)
 *   - `2019-default` — APC / PDP / LP / NNPP / APGA
 *   - `1991-default` — SDP / NRC (aborted Third Republic two-party system)
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

// NG party slug → DB name. Used by `buildNGPartySlugToSeqId` to look up
// live sequentialIds. Slugs match the polling tables below.
const NG_PARTY_SLUG_TO_NAME: Record<string, string> = {
  apc: "All Progressives Congress",
  pdp: "Peoples Democratic Party",
  lp: "Labour Party",
  nnpp: "New Nigeria Peoples Party",
  apga: "All Progressives Grand Alliance",
  sdp: "Social Democratic Party",
  nrc: "National Republican Convention",
  ncnc: "National Council of Nigeria and the Cameroons",
  ag: "Action Group",
  npc: "Northern People's Congress",
};

// Zonal vote-share tables live in ngRegionVoteShares.ts (shared with the NG
// election engine). Era tables are re-exported for back-compat with existing
// importers (seedReadiness audit, etc.).
export {
  NG_REGION_VOTE_SHARES_1953,
  NG_REGION_VOTE_SHARES_1991,
  NG_REGION_VOTE_SHARES_2019,
} from "./ngRegionVoteShares";
import {
  NG_REGION_VOTE_SHARES_1953,
  NG_REGION_VOTE_SHARES_1991,
  NG_REGION_VOTE_SHARES_2019,
} from "./ngRegionVoteShares";

function calculateNGPartyOrg(voteShare: number): number {
  const scaled = MIN_ORG + (voteShare / 50) * (MAX_ORG - MIN_ORG);
  return Math.min(Math.max(Math.round(scaled), MIN_ORG), MAX_ORG);
}

/**
 * Resolve each NG party slug to the matching `sequentialId` in the DB.
 * Robust to preset filtering — only returns mappings for parties that
 * actually exist under the active preset.
 */
export async function buildNGPartySlugToSeqId(db: Db): Promise<Record<string, string>> {
  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId: "NG" })
    .project<{ name: string; sequentialId: number }>({ name: 1, sequentialId: 1 })
    .toArray();
  const byName = new Map(parties.map((p) => [p.name, String(p.sequentialId)]));
  const out: Record<string, string> = {};
  for (const [slug, name] of Object.entries(NG_PARTY_SLUG_TO_NAME)) {
    const seqId = byName.get(name);
    if (seqId) out[slug] = seqId;
  }
  return out;
}

/**
 * Generate all NG state party org entries from vote share estimates.
 * `preset` selects the polling table: `1953-default` → NCNC/AG/NPC;
 * `1991-default` → SDP/NRC; all other values use the 2019 dataset.
 */
export async function calculateNGStatePartyOrgs(
  db: Db,
  preset: string
): Promise<Omit<StatePartyOrg, "createdAt" | "updatedAt">[]> {
  const orgs: Omit<StatePartyOrg, "createdAt" | "updatedAt">[] = [];
  const slugToSeqId = await buildNGPartySlugToSeqId(db);
  const voteShares =
    preset === "1953-default"
      ? NG_REGION_VOTE_SHARES_1953
      : preset === "1991-default"
        ? NG_REGION_VOTE_SHARES_1991
        : NG_REGION_VOTE_SHARES_2019;

  for (const [regionId, partyVotes] of Object.entries(voteShares)) {
    for (const [partySlug, voteShare] of Object.entries(partyVotes)) {
      const partySeqId = slugToSeqId[partySlug];
      if (!partySeqId) continue; // party not in DB under this preset
      const org = calculateNGPartyOrg(voteShare);

      orgs.push({
        _id: `${regionId}_${partySeqId}`,
        countryId: "NG",
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

export default calculateNGStatePartyOrgs;
