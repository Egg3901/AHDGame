import { ObjectId, type Db } from "mongodb";

type LeadershipNominationCollection =
  "speakerNominations" | "houseLeadershipNominations" | "senateLeadershipNominations";

interface ActiveLeadershipNomination {
  _id: ObjectId;
  role?: string;
}

interface LeadershipConflict {
  collectionName: LeadershipNominationCollection;
  nominationId: ObjectId;
  role?: string;
}

const ACTIVE_STATUSES = ["open", "voting"] as const;

async function findActiveLeadershipNomination(
  db: Db,
  collectionName: LeadershipNominationCollection,
  nomineeId: ObjectId
): Promise<ActiveLeadershipNomination | null> {
  return db.collection<ActiveLeadershipNomination>(collectionName).findOne(
    {
      nomineeId,
      status: { $in: [...ACTIVE_STATUSES] },
    },
    { projection: { _id: 1, role: 1 } }
  );
}

export async function failNominationIfLeadershipConflict(
  db: Db,
  {
    collectionName,
    nominationId,
    nomineeId,
    now,
  }: {
    collectionName: LeadershipNominationCollection;
    nominationId: ObjectId;
    nomineeId: ObjectId;
    now: Date;
  }
): Promise<LeadershipConflict | null> {
  const checks: LeadershipNominationCollection[] = [
    "speakerNominations",
    "houseLeadershipNominations",
    "senateLeadershipNominations",
  ];

  const active = await Promise.all(
    checks.map(async (name) => {
      const nomination = await findActiveLeadershipNomination(db, name, nomineeId);
      return nomination
        ? { collectionName: name, nominationId: nomination._id, role: nomination.role }
        : null;
    })
  );

  const conflicts: LeadershipConflict[] = active.filter((entry) => {
    return (
      entry !== null &&
      !(entry.collectionName === collectionName && entry.nominationId.equals(nominationId))
    );
  }) as LeadershipConflict[];
  if (conflicts.length === 0) {
    return null;
  }

  await db.collection(collectionName).updateOne(
    {
      _id: nominationId,
      status: { $in: [...ACTIVE_STATUSES] },
    },
    { $set: { status: "failed", updatedAt: now } }
  );

  return conflicts[0] ?? null;
}

export function describeLeadershipConflict(conflict: LeadershipConflict | null): string {
  if (!conflict) {
    return "You can only run for one leadership position at a time. Withdraw from the other race first.";
  }

  if (conflict.collectionName === "speakerNominations") {
    return "You can only run for one leadership position at a time. Withdraw from Speaker first.";
  }
  if (conflict.collectionName === "houseLeadershipNominations") {
    return "You can only run for one leadership position at a time. Withdraw from the House race first.";
  }
  return "You can only run for one leadership position at a time. Withdraw from the Senate race first.";
}
