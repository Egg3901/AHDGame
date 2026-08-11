import { ObjectId, type Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import {
  CUSTOM_ORG_DEFAULT_LEADERSHIP_TERM_TURNS,
  isValidCustomOrganizationSlug,
} from "@/lib/constants/internationalOrganizations";
import type { OrganizationCategory } from "@/lib/constants/orgCategory";
import {
  getCustomInternationalOrganizationsCollection,
  getOrganizationLeadershipCollection,
  getOrganizationMembershipsCollection,
} from "@/lib/db/collections";
import { recordOrgHistoryEvent } from "@/lib/internationalOrganizations/service";
import { getCurrentTurn } from "@/lib/turn/currentTurn";

export async function createInternationalOrganization(params: {
  db: Db;
  countryId: CountryId;
  actor: {
    characterId: ObjectId;
    characterName: string;
  };
  input: {
    id: string;
    name: string;
    shortName: string;
    description: string;
    charter: string;
    leadershipTitle: string;
    category: OrganizationCategory;
    logoPath?: string | null;
  };
}) {
  const { db, countryId, actor, input } = params;
  const slug = input.id.trim().toLowerCase();
  if (!isValidCustomOrganizationSlug(slug)) {
    return {
      ok: false as const,
      status: 400,
      error:
        "Organization id must be 2-32 lowercase letters, digits, or hyphens, and not collide with a built-in id.",
    };
  }

  const customOrganizations = await getCustomInternationalOrganizationsCollection(db);
  const existing = await customOrganizations.findOne({ id: slug });
  if (existing) {
    return {
      ok: false as const,
      status: 400,
      error: `An organization with id "${slug}" already exists.`,
    };
  }

  const currentTurn = await getCurrentTurn(db);
  const now = new Date();
  const organizationId = new ObjectId();
  const membershipId = new ObjectId();
  const leadershipId = new ObjectId();
  const organizationDocument = {
    _id: organizationId,
    id: slug,
    name: input.name.trim(),
    shortName: input.shortName.trim(),
    description: input.description.trim(),
    charter: input.charter.trim(),
    category: input.category,
    logoPath: input.logoPath?.trim() || null,
    foundingMembers: [countryId],
    leadership: {
      title: input.leadershipTitle.trim(),
      termTurns: CUSTOM_ORG_DEFAULT_LEADERSHIP_TERM_TURNS,
    },
    creatorCharacterId: actor.characterId,
    creatorCharacterName: actor.characterName,
    creatorCountryId: countryId,
    createdAt: now,
    createdOnTurn: currentTurn,
  };
  const memberships = await getOrganizationMembershipsCollection(db);
  const leadership = await getOrganizationLeadershipCollection(db);

  try {
    await customOrganizations.insertOne(organizationDocument);

    await memberships.insertOne({
      _id: membershipId,
      organizationId: slug,
      countryId,
      status: "founding",
      joinedAt: now,
      joinedTurn: currentTurn,
    });

    await leadership.insertOne({
      _id: leadershipId,
      organizationId: slug,
      holderCharacterId: null,
      holderCharacterName: null,
      holderCountryId: null,
      electedAt: null,
      electedOnTurn: null,
      termEndsOnTurn: null,
      updatedAt: now,
    });
  } catch (error) {
    await Promise.allSettled([
      customOrganizations.deleteOne({ _id: organizationId }),
      memberships.deleteOne({ _id: membershipId }),
      leadership.deleteOne({ _id: leadershipId }),
    ]);
    throw error;
  }

  await recordOrgHistoryEvent(
    db,
    countryId,
    currentTurn,
    `${COUNTRY_CONFIGS[countryId].name} founded ${organizationDocument.name} (${organizationDocument.shortName}).`,
    { organizationId: slug }
  );

  return { ok: true as const, organizationId: slug };
}
