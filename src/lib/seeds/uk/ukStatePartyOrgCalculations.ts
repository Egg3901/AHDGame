import type { Db } from "mongodb";
import { UK_REGION_POLLING_2020 } from "./ukRegionPolling2020";
import { UK_REGION_POLLING_1992 } from "./ukRegionPolling1992";
import { UK_REGION_POLLING_1951 } from "./ukRegionPolling1951";
import type { StatePartyOrg, PoliticalParty } from "@/lib/db/types";
import { canPartyContestState } from "@/lib/parties/regionalContest";

/**
 * Calculate UK state party organization levels from era polling data
 * (1951 / 1992 / 2020 general-election tables, selected by preset).
 *
 * Unlike the US two-party system which uses political lean (-5 to +5),
 * the UK multi-party system uses absolute vote share percentages.
 *
 * Organizations scale from vote share:
 * - 0% vote → 5 org (minimal presence)
 * - 50% vote → 70 org (dominant party)
 */

const MIN_ORG = 5;
const MAX_ORG = 70;

/**
 * UK party slug → display name. Used to resolve a party slug to its
 * `politicalParties.name` for runtime sequentialId lookup. Slugs match
 * the ids used in ukRegionPolling2020.ts and getMajorPartiesForRegion.
 */
const UK_PARTY_SLUG_TO_NAME: Record<string, string> = {
  uk_labour: "Labour Party",
  uk_conservative: "Conservative Party",
  uk_libdem: "Liberal Democrats",
  uk_liberal: "Liberal Party", // historic Liberals — 1953-only default seed
  uk_snp: "Scottish National Party",
  uk_plaid: "Plaid Cymru",
  uk_green: "Green Party",
  uk_reform: "Reform UK",
  uk_dup: "Democratic Unionist Party",
  uk_sf: "Sinn Féin",
  uk_uup: "Ulster Unionist Party",
};

function isPartyHomeRegion(partySlug: string, regionId: string): boolean {
  return canPartyContestState({ countryId: "UK", slug: partySlug, stateId: regionId });
}

/**
 * Calculate initial organization level from vote share.
 * @param voteShare - Party's vote share in region (0-100%)
 * @returns Organization level (5-70)
 */
function calculateUKPartyOrg(voteShare: number): number {
  // Scale linearly: 0% → MIN_ORG, 50% → MAX_ORG
  const scaled = MIN_ORG + (voteShare / 50) * (MAX_ORG - MIN_ORG);
  return Math.min(Math.max(Math.round(scaled), MIN_ORG), MAX_ORG);
}

/**
 * Build a runtime slug → sequentialId map by reading politicalParties from
 * the DB. Resolves to whatever sequentialId each party actually has rather
 * than assuming insertion order — robust to preset filtering and
 * insert/delete cycles (e.g. UUP/Reform UK being added or removed across
 * preset switches).
 */
export async function buildUKPartySlugToSeqId(db: Db): Promise<Record<string, string>> {
  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId: "UK" })
    .project<{ name: string; sequentialId: number }>({ name: 1, sequentialId: 1 })
    .toArray();

  const byName = new Map(parties.map((p) => [p.name, String(p.sequentialId)]));
  const out: Record<string, string> = {};
  for (const [slug, name] of Object.entries(UK_PARTY_SLUG_TO_NAME)) {
    const seqId = byName.get(name);
    if (seqId) out[slug] = seqId;
  }
  return out;
}

/**
 * Generate all UK state party org entries from polling data.
 * Creates entries for each region × party combination present in the polling
 * data AND in the DB. Async — accepts a Db so slug → sequentialId can be
 * resolved from the live `politicalParties` collection (parties filtered out
 * by `validForPresets` for the active preset are skipped automatically).
 *
 * `preset` selects the polling table: `1953-default` uses
 * `UK_REGION_POLLING_1951` (Con/Lab duopoly, historic Liberals, no SNP);
 * `1991-default` and `1979-default` use `UK_REGION_POLLING_1992` (UUP dominant
 * in NIR, no Reform UK, lower SF share — for 1979 the 1992 table is the
 * closest authored election until a dedicated 1979 table exists); anything
 * else (including the default `2019-default`) uses `UK_REGION_POLLING_2020`.
 */
export async function calculateUKStatePartyOrgs(
  db: Db,
  preset: string
): Promise<Omit<StatePartyOrg, "createdAt" | "updatedAt">[]> {
  const orgs: Omit<StatePartyOrg, "createdAt" | "updatedAt">[] = [];
  const slugToSeqId = await buildUKPartySlugToSeqId(db);
  const polling =
    preset === "1953-default"
      ? UK_REGION_POLLING_1951
      : preset === "1991-default" || preset === "1979-default"
        ? UK_REGION_POLLING_1992
        : UK_REGION_POLLING_2020;

  for (const [regionId, partyVotes] of Object.entries(polling)) {
    for (const [partySlug, voteShare] of Object.entries(partyVotes)) {
      const partySeqId = slugToSeqId[partySlug];
      if (!partySeqId) continue; // party not in DB (e.g. UUP under 2019 preset)
      // Skip regional parties outside their home region — SNP doesn't have
      // org in NIR, DUP doesn't have org in London, etc.
      if (!isPartyHomeRegion(partySlug, regionId)) continue;
      const org = calculateUKPartyOrg(voteShare);

      orgs.push({
        _id: `${regionId}_${partySeqId}`,
        countryId: "UK",
        stateId: regionId,
        partyId: partySeqId,
        organization: org,
        // Era polling share doubles as the seeded partisan baseline:
        //  - `registration` feeds the existing Reg lanes (regResistance +
        //    transferable/peel curves) exactly like the US lane values do.
        //    For the 2019 preset the curated UK lanes in registrationLanes.ts
        //    overwrite this afterwards; for era presets without UK lanes
        //    (1953/1979/1991) the polling share IS the registration seed.
        //  - `registrationShare` feeds `regBaselineMultiplier` (concave
        //    share^0.5 vote-weight scalar) so a 2.5%-polling party lands in
        //    single-digit vote share instead of the twenties. Never written
        //    by any other seed path — worlds without it are byte-identical.
        registration: voteShare,
        registrationShare: voteShare,
        chairId: null,
        viceChairId: null,
        treasurerId: null,
        treasury: 0,
        stateTaxRate: 5,
        politicalStrength: 0,
        hasPresence: true, // Major UK parties have presence in all regions
        consecutiveLosses: 0,
      });
    }
  }

  return orgs;
}

export default calculateUKStatePartyOrgs;
