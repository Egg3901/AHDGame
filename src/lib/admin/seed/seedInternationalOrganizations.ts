import { ObjectId, type Db } from "mongodb";
import {
  INTERNATIONAL_ORGANIZATIONS,
  INTERNATIONAL_ORGANIZATION_ORDER,
} from "@/lib/constants/internationalOrganizations";
import type {
  OrganizationMembership,
  OrganizationLeadership,
} from "@/lib/db/types/internationalOrganization";
import {
  loadWithdrawnMemberKeys,
  withdrawalKey,
} from "@/lib/internationalOrganizations/withdrawalTombstone";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";
import {
  isOrganizationFounded,
  resolveSeedRoster,
} from "@/lib/internationalOrganizations/founding";

/**
 * Composite key for the membership existence set. NUL-separated because neither
 * an organization id nor a country id can contain it, so no pair of distinct
 * (org, country) pairs can collide on a shared separator character.
 */
const memberKey = (organizationId: string, countryId: string): string =>
  `${organizationId}\u0000${countryId}`;

/**
 * Idempotent seed for international-organization founding members and vacant
 * leadership rows. Re-runnable: only inserts missing rows; never overwrites.
 *
 * `preset` selects the correct era's member list via `foundingMembersByEra`
 * (falling back to `foundingMembers`), and gates existence: orgs founded
 * after the preset's starting year are not seeded at all.
 */
export async function seedInternationalOrganizations(
  db: Db,
  log: (msg: string) => void = console.log,
  preset: string
): Promise<{ membershipsInserted: number; leadershipInserted: number }> {
  const membershipsCol = db.collection<OrganizationMembership>("organizationMemberships");
  const leadershipCol = db.collection<OrganizationLeadership>("organizationLeadership");
  const now = new Date();

  let membershipsInserted = 0;
  let leadershipInserted = 0;

  // Founders that deliberately withdrew must NOT be re-added by the reseed.
  const withdrawn = await loadWithdrawnMemberKeys(db);

  // Both existence sets are read up front, once, instead of probing per member
  // and per org inside the loop. `seen` is then advanced as rows are STAGED, so
  // a roster that names the same country twice still inserts it once — that is
  // what the old per-member findOne gave us, since it saw its own insert.
  const seenMembers = new Set<string>(
    (
      await membershipsCol.find({}, { projection: { organizationId: 1, countryId: 1 } }).toArray()
    ).map((m) => memberKey(m.organizationId, m.countryId))
  );
  const seenLeadership = new Set<string>(
    (await leadershipCol.find({}, { projection: { organizationId: 1 } }).toArray()).map(
      (l) => l.organizationId
    )
  );
  const membershipDocs: OrganizationMembership[] = [];
  const leadershipDocs: OrganizationLeadership[] = [];

  const startingYear = getStartingYearForPreset(preset);
  for (const orgId of INTERNATIONAL_ORGANIZATION_ORDER) {
    const org = INTERNATIONAL_ORGANIZATIONS[orgId];
    // Founding-year gate: an org founded after this preset's starting year is
    // not seeded AT ALL (no memberships, no leadership row). It auto-founds
    // empty mid-game via foundDueOrganizations when the live year arrives.
    if (!isOrganizationFounded({ def: org, liveYear: startingYear, hasMembers: false })) {
      continue;
    }
    const members = resolveSeedRoster(org, preset);

    for (const countryId of members) {
      if (withdrawn.has(withdrawalKey(orgId, countryId))) continue;
      const key = memberKey(orgId, countryId);
      if (seenMembers.has(key)) continue;
      seenMembers.add(key);
      membershipDocs.push({
        _id: new ObjectId(),
        organizationId: orgId,
        countryId,
        status: "founding",
        joinedAt: now,
        joinedTurn: 0,
      });
      membershipsInserted++;
    }

    if (!seenLeadership.has(orgId)) {
      seenLeadership.add(orgId);
      leadershipDocs.push({
        _id: new ObjectId(),
        organizationId: orgId,
        holderCharacterId: null,
        holderCharacterName: null,
        holderCountryId: null,
        electedAt: null,
        electedOnTurn: null,
        termEndsOnTurn: null,
        updatedAt: now,
      });
      leadershipInserted++;
    }
  }

  if (membershipDocs.length > 0) await membershipsCol.insertMany(membershipDocs);
  if (leadershipDocs.length > 0) await leadershipCol.insertMany(leadershipDocs);

  log(
    `International organizations seeded: ${membershipsInserted} new memberships, ${leadershipInserted} new leadership rows`
  );
  return { membershipsInserted, leadershipInserted };
}
