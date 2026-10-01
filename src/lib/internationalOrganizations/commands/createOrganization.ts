import { ObjectId, type Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import {
  CUSTOM_ORG_DEFAULT_LEADERSHIP_TERM_TURNS,
  isValidCustomOrganizationSlug,
} from "@/lib/constants/internationalOrganizations";
import type { OrganizationCategory } from "@/lib/constants/orgCategory";
import { BLOC_DESIGNATED_ORG_IDS } from "@/lib/constants/orgCategory";
import {
  customAlignmentPoleId,
  isCustomAlignmentPoleToken,
  type CustomAlignmentPoleToken,
} from "@/lib/constants/alignmentEras";
import {
  getCountryAlignmentsCollection,
  getCustomInternationalOrganizationsCollection,
  getOrganizationLeadershipCollection,
  getOrganizationMembershipsCollection,
} from "@/lib/db/collections";
import { recordOrgHistoryEvent } from "@/lib/internationalOrganizations/service";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { resolveGameYear } from "@/lib/era/era";
import type { GameState } from "@/lib/db/types";
import { loadAlignmentTopology } from "@/lib/alignment/topology";
import type { AlignmentTopology } from "@/lib/alignment/rules/customBlocs";
import { foundCustomBlocPole } from "@/lib/alignment/rules/customBlocs";
import { applyEraCrossing } from "@/lib/alignment/crossing";

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
    alignmentAccentToken?: CustomAlignmentPoleToken;
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

  if (
    input.category === "bloc" &&
    (!input.alignmentAccentToken || !isCustomAlignmentPoleToken(input.alignmentAccentToken))
  ) {
    return {
      ok: false as const,
      status: 400,
      error: "Bloc organizations must choose an alignment color.",
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
  let topology: AlignmentTopology | null = null;
  const memberships = await getOrganizationMembershipsCollection(db);
  if (input.category === "bloc") {
    const gameState = await db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { currentYear: 1, startingYear: 1 } });
    const year = (gameState ? resolveGameYear(gameState) : null) ?? new Date().getFullYear();
    topology = await loadAlignmentTopology(db, year);
    const rivalIds = [
      ...BLOC_DESIGNATED_ORG_IDS,
      ...topology.channels
        .filter((channel) => channel.alignmentAccession)
        .map((channel) => channel.organizationId),
    ];
    const rival = await memberships.findOne({
      countryId,
      organizationId: { $in: [...new Set(rivalIds)] },
    });
    if (rival) {
      return {
        ok: false as const,
        status: 409,
        error: `Leave ${rival.organizationId} before founding a new Bloc.`,
      };
    }
  }
  const now = new Date();
  const organizationId = new ObjectId();
  const membershipId = new ObjectId();
  const leadershipId = new ObjectId();
  const poleId = customAlignmentPoleId(slug);
  const organizationDocument = {
    _id: organizationId,
    id: slug,
    name: input.name.trim(),
    shortName: input.shortName.trim(),
    description: input.description.trim(),
    charter: input.charter.trim(),
    category: input.category,
    ...(input.category === "bloc"
      ? {
          alignment: {
            poleId,
            accentToken: input.alignmentAccentToken!,
          },
        }
      : {}),
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
  const leadership = await getOrganizationLeadershipCollection(db);
  const alignments = input.category === "bloc" ? await getCountryAlignmentsCollection(db) : null;
  const priorAlignment = alignments ? await alignments.findOne({ entityId: countryId }) : null;
  let alignmentWritten = false;
  let alignmentConflict = false;

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

    if (topology && alignments) {
      const current = priorAlignment
        ? applyEraCrossing({
            shares: { shares: priorAlignment.shares, nonAligned: priorAlignment.nonAligned },
            storedEraKey: priorAlignment.eraKey,
            year: topology.era.fromYear,
            poles: topology.poles,
          }).shares
        : { shares: {}, nonAligned: 100 };
      const next = foundCustomBlocPole({
        current,
        currentPoles: topology.poles,
        poleId,
      });
      // Mark before awaiting: an acknowledged response can be lost after Mongo
      // applied the write, and rollback must still restore the prior ledger.
      alignmentWritten = true;
      const write = await alignments.updateOne(
        priorAlignment
          ? { _id: priorAlignment._id, updatedAt: priorAlignment.updatedAt }
          : { entityId: countryId },
        {
          $set: {
            eraKey: topology.era.key,
            shares: next.shares,
            nonAligned: next.nonAligned,
            previous: null,
            // Founding reduces every older pole to at most 40, so no prior
            // accession clock can still be valid.
            joinReadySince: { [poleId]: currentTurn },
            turn: currentTurn,
            updatedAt: now,
          },
          $setOnInsert: {
            _id: new ObjectId(),
            entityId: countryId,
          },
        },
        { upsert: !priorAlignment }
      );
      if (priorAlignment && write.matchedCount === 0) {
        alignmentWritten = false;
        alignmentConflict = true;
        throw new Error("Alignment changed during Bloc founding");
      }
    }
  } catch (error) {
    const rollbacks: Promise<unknown>[] = [
      customOrganizations.deleteOne({ _id: organizationId }),
      memberships.deleteOne({ _id: membershipId }),
      leadership.deleteOne({ _id: leadershipId }),
    ];
    if (alignmentWritten && alignments) {
      rollbacks.push(
        priorAlignment
          ? alignments.replaceOne({ _id: priorAlignment._id, updatedAt: now }, priorAlignment)
          : alignments.deleteOne({ entityId: countryId, updatedAt: now })
      );
    }
    await Promise.allSettled(rollbacks);
    if (alignmentConflict) {
      return {
        ok: false as const,
        status: 409,
        error: "Alignment changed during Bloc founding. Please try again.",
      };
    }
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
