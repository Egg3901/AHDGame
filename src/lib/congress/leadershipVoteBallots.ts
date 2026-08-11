import { ObjectId, type Db } from "mongodb";

type BallotCollectionName =
  "speakerLeadershipBallots" | "houseLeadershipBallots" | "senateLeadershipBallots";

type NominationCollectionName =
  "speakerNominations" | "houseLeadershipNominations" | "senateLeadershipNominations";

interface LeadershipVoteBallot {
  _id: ObjectId;
  role?: string;
  voterCharacterId: ObjectId;
  nominationId: ObjectId;
  ballotToken: string;
  createdAt: Date;
  updatedAt: Date;
}

const ACTIVE_STATUSES = ["open", "voting"] as const;

export async function castLeadershipVoteBallot(
  db: Db,
  {
    ballotCollectionName,
    nominationCollectionName,
    nominationId,
    voterCharacterId,
    role,
    now,
    ballotToken: providedBallotToken,
  }: {
    ballotCollectionName: BallotCollectionName;
    nominationCollectionName: NominationCollectionName;
    nominationId: ObjectId;
    voterCharacterId: ObjectId;
    role?: string;
    now: Date;
    ballotToken?: string;
  }
): Promise<{ previousNominationId: ObjectId | null }> {
  const ballotCollection = db.collection<LeadershipVoteBallot>(ballotCollectionName);
  const nominationCollection = db.collection(nominationCollectionName);
  const ballotToken = providedBallotToken ?? new ObjectId().toString();
  const voteField = `votes.${voterCharacterId.toString()}`;
  const ballotFilter = role ? { role, voterCharacterId } : { voterCharacterId };
  const nominationScope = role ? { role } : {};

  const previousBallot = await ballotCollection.findOneAndUpdate(
    ballotFilter,
    {
      $set: {
        nominationId,
        ballotToken,
        updatedAt: now,
      },
      $setOnInsert: {
        voterCharacterId,
        ...(role ? { role } : {}),
        createdAt: now,
      },
    },
    { upsert: true, returnDocument: "before" }
  );

  const previousNominationId = previousBallot?.nominationId ?? null;
  if (previousNominationId && !previousNominationId.equals(nominationId)) {
    await nominationCollection.updateOne(
      {
        _id: previousNominationId,
        ...nominationScope,
        status: { $in: [...ACTIVE_STATUSES] },
        [voteField]: { $exists: true },
      },
      {
        $unset: { [voteField]: "" },
        $inc: { votesFor: -1 },
        $set: { updatedAt: now },
      }
    );
  }

  const currentBallot = await ballotCollection.findOne(ballotFilter, {
    projection: { ballotToken: 1, nominationId: 1 },
  });
  if (
    !currentBallot ||
    currentBallot.ballotToken !== ballotToken ||
    !currentBallot.nominationId.equals(nominationId)
  ) {
    return { previousNominationId };
  }

  await nominationCollection.updateOne(
    {
      _id: nominationId,
      ...nominationScope,
      status: { $in: [...ACTIVE_STATUSES] },
      [voteField]: { $exists: false },
    },
    {
      $set: {
        [voteField]: "for",
        status: "voting",
        updatedAt: now,
      },
      $inc: { votesFor: 1 },
    }
  );

  return { previousNominationId };
}
