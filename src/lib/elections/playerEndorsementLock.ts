import { ObjectId, type Db } from "mongodb";

interface PlayerEndorsementLock {
  _id: string;
  token: ObjectId;
  expiresAt: Date;
}

// Requests can reverse several prior endorsement bumps before writing the new
// row. Keep the lease comfortably above the API timeout so it cannot expire
// mid-request under normal load; token-scoped release still clears it early.
const ENDORSEMENT_LOCK_TTL_MS = 5 * 60_000;

export async function claimPlayerEndorsementLock(
  db: Db,
  characterId: ObjectId,
  electionId: ObjectId,
  now = new Date()
): Promise<(() => Promise<void>) | null> {
  const lockId = `${characterId.toString()}:${electionId.toString()}`;
  const token = new ObjectId();
  try {
    const claimed = await db.collection<PlayerEndorsementLock>("playerEndorsementLocks").updateOne(
      {
        _id: lockId,
        $or: [{ expiresAt: { $lte: now } }, { expiresAt: { $exists: false } }],
      },
      {
        $set: {
          token,
          expiresAt: new Date(now.getTime() + ENDORSEMENT_LOCK_TTL_MS),
        },
      },
      { upsert: true }
    );
    if (claimed.matchedCount === 0 && claimed.upsertedCount === 0) return null;
  } catch (error) {
    if ((error as { code?: number } | undefined)?.code === 11000) return null;
    throw error;
  }

  return async () => {
    await db
      .collection<PlayerEndorsementLock>("playerEndorsementLocks")
      .deleteOne({ _id: lockId, token });
  };
}
