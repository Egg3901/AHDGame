import { ObjectId, type Db } from "mongodb";
import { getContestRoundsCollection } from "@/lib/contests/collection";

/** Durable enacted laws only. Drafts, failed bills and staff overrides earn no credit. */
export async function loadCareerLegislation(
  db: Db,
  characterIds?: readonly ObjectId[]
): Promise<Map<string, number>> {
  const [national, state] = await Promise.all([
    db
      .collection("bills")
      .aggregate<{ _id: string; count: number }>([
        {
          $match: {
            status: "signed",
            enactedAt: { $exists: true },
            sponsorId: characterIds ? { $in: characterIds } : { $ne: null },
            adminProposed: { $ne: true },
          },
        },
        { $group: { _id: { $toString: "$sponsorId" }, count: { $sum: 1 } } },
      ])
      .toArray(),
    db
      .collection("stateBills")
      .aggregate<{ _id: string; count: number }>([
        {
          $match: {
            enactedAt: { $exists: true },
            sponsorId: characterIds ? { $in: characterIds } : { $ne: null },
            adminProposed: { $ne: true },
          },
        },
        { $group: { _id: { $toString: "$sponsorId" }, count: { $sum: 1 } } },
      ])
      .toArray(),
  ]);
  const counts = new Map<string, number>();
  for (const row of [...national, ...state])
    if (row._id) counts.set(row._id, (counts.get(row._id) ?? 0) + row.count);
  return counts;
}

export async function loadCareerContests(
  db: Db
): Promise<Map<string, { wins: number; podiums: number }>> {
  const results = await getContestRoundsCollection(db)
    .aggregate<{ _id: string; wins: number; podiums: number }>([
      { $match: { status: "settled" } },
      { $unwind: "$winners" },
      { $match: { "winners.score": { $gt: 0 } } },
      // A character with several winning corporations still earns one credit per round.
      {
        $group: {
          _id: { round: "$_id", character: "$winners.characterId" },
          rank: { $min: { $ifNull: ["$winners.rank", 1] } },
        },
      },
      {
        $group: {
          _id: "$_id.character",
          wins: { $sum: { $cond: [{ $eq: ["$rank", 1] }, 1, 0] } },
          podiums: { $sum: 1 },
        },
      },
    ])
    .toArray();
  return new Map(results.map((r) => [r._id, { wins: r.wins, podiums: r.podiums }]));
}

/** Include laws enacted after their sponsor retired, before the reset removes those laws. */
export async function archiveRetiredCareerLegislation(
  db: Db,
  counts: ReadonlyMap<string, number>
): Promise<void> {
  const ids = [...counts.keys()].filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  if (ids.length === 0) return;
  const retired = await db
    .collection("retiredCharacters")
    .find(
      { characterId: { $in: ids } },
      { projection: { characterId: 1, "snapshot.stats.enactedBills": 1 } }
    )
    .toArray();
  const updates = retired.flatMap((r) => {
    const count = counts.get(r.characterId.toString()) ?? 0;
    return count > (r.snapshot?.stats?.enactedBills ?? 0)
      ? [
          {
            updateOne: {
              filter: { _id: r._id },
              update: { $max: { "snapshot.stats.enactedBills": count } },
            },
          },
        ]
      : [];
  });
  if (updates.length) await db.collection("retiredCharacters").bulkWrite(updates);
}

export async function loadCareerLoans(db: Db, characterIds?: readonly ObjectId[]) {
  return db
    .collection<import("@/lib/db/types/bank").BankLoan>("bankLoans")
    .find(
      {
        borrowerType: "character",
        status: { $in: ["current", "arrears", "defaulted"] },
        ...(characterIds ? { borrowerId: { $in: characterIds } } : {}),
      },
      { projection: { borrowerId: 1, currency: 1, outstanding: 1 } }
    )
    .toArray();
}
