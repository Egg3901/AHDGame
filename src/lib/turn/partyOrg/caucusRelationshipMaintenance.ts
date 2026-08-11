import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Caucus, CaucusMembership, NPP, NPPRelationship } from "@/lib/db/types";
import {
  CAUCUS_NPP_RETENTION_MIN_RELATIONSHIP,
  NPP_RELATIONSHIP_DECAY_PER_TURN,
} from "@/lib/constants/partyOrg";

interface CaucusRelationshipMaintenanceResult {
  relationshipsDecayed: number;
  caucusMembershipsRemoved: number;
}

function roundRelationshipScore(value: number): number {
  return Math.round(value * 10) / 10;
}

function decayRelationshipScore(score: number): number {
  if (score > 0)
    return roundRelationshipScore(Math.max(0, score - NPP_RELATIONSHIP_DECAY_PER_TURN));
  if (score < 0)
    return roundRelationshipScore(Math.min(0, score + NPP_RELATIONSHIP_DECAY_PER_TURN));
  return 0;
}

/**
 * Relationship upkeep has two jobs:
 *
 * 1) Drift every stored NPP↔character relationship back toward neutral so
 *    one-time interactions do not grant permanent caucus/slate access.
 * 2) Apply a lower caucus-retention threshold after that drift so caucus
 *    membership is harder to earn than it is to keep, but still dissolves
 *    when the chair lets the relationship decay too far.
 */
export async function processCaucusRelationshipMaintenance(
  gameNow: Date
): Promise<CaucusRelationshipMaintenanceResult> {
  const db = await getDb();
  const relationshipsCol = db.collection<NPPRelationship>("nppRelationships");
  const membershipsCol = db.collection<CaucusMembership>("caucusMemberships");
  const caucusesCol = db.collection<Caucus>("caucuses");
  const nppsCol = db.collection<NPP>("npps");

  const relationships = await relationshipsCol
    .find({})
    .project<Pick<NPPRelationship, "_id" | "relationshipScore">>({ _id: 1, relationshipScore: 1 })
    .toArray();
  const relationshipUpdates = relationships
    .map((relationship) => {
      const nextScore = decayRelationshipScore(relationship.relationshipScore);
      if (nextScore === relationship.relationshipScore) return null;
      return {
        updateOne: {
          filter: { _id: relationship._id },
          update: {
            $set: {
              relationshipScore: nextScore,
              updatedAt: gameNow,
            },
          },
        },
      };
    })
    .filter((update): update is NonNullable<typeof update> => update !== null);

  if (relationshipUpdates.length > 0) {
    await relationshipsCol.bulkWrite(
      relationshipUpdates.map((update) => ({
        ...update,
        updateOne: {
          ...update.updateOne,
          filter: update.updateOne.filter as { _id: string },
        },
      }))
    );
  }

  const relationshipScoreByKey = new Map(
    relationships.map((relationship) => [
      relationship._id,
      decayRelationshipScore(relationship.relationshipScore),
    ])
  );

  const activeNppMemberships = await membershipsCol
    .find({ memberType: "npp", status: "active" })
    .toArray();
  if (activeNppMemberships.length === 0) {
    return {
      relationshipsDecayed: relationshipUpdates.length,
      caucusMembershipsRemoved: 0,
    };
  }

  const caucusIds = Array.from(
    new Set(activeNppMemberships.map((membership) => membership.caucusId.toString()))
  ).map((id) => new ObjectId(id));
  const caucuses = await caucusesCol.find({ _id: { $in: caucusIds } }).toArray();
  const caucusById = new Map(caucuses.map((caucus) => [caucus._id.toString(), caucus]));

  const membershipUpdates: Array<{
    updateOne: {
      filter: { _id: ObjectId };
      update: { $set: Partial<CaucusMembership> };
    };
  }> = [];
  const nppUpdates: Array<{
    updateOne: {
      filter: { _id: ObjectId; factionId: ObjectId };
      update: { $set: { factionId: null; updatedAt: Date } };
    };
  }> = [];

  for (const membership of activeNppMemberships) {
    const caucus = caucusById.get(membership.caucusId.toString());
    if (!caucus?.chairId) continue;

    const relationshipKey = `${caucus.chairId.toString()}_${membership.memberId.toString()}`;
    const relationshipScore = relationshipScoreByKey.get(relationshipKey) ?? 0;

    // A missing relationship doc is treated as neutral/unknown (0), which is
    // below the retention floor and lets neglected caucus links dissolve.
    if (relationshipScore >= CAUCUS_NPP_RETENTION_MIN_RELATIONSHIP) continue;

    membershipUpdates.push({
      updateOne: {
        filter: { _id: membership._id },
        update: {
          $set: {
            status: "left",
            leftAt: gameNow,
            updatedAt: gameNow,
          },
        },
      },
    });
    nppUpdates.push({
      updateOne: {
        filter: { _id: membership.memberId, factionId: membership.caucusId },
        update: {
          $set: {
            factionId: null,
            updatedAt: gameNow,
          },
        },
      },
    });
  }

  if (membershipUpdates.length > 0) {
    await membershipsCol.bulkWrite(membershipUpdates);
  }
  if (nppUpdates.length > 0) {
    await nppsCol.bulkWrite(nppUpdates);
  }

  return {
    relationshipsDecayed: relationshipUpdates.length,
    caucusMembershipsRemoved: membershipUpdates.length,
  };
}
