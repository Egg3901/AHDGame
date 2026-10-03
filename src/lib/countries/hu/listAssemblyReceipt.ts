/**
 * Hungarian party-list replacements use the current Assembly's frozen slate.
 * Earlier386-seat and authorized199-seat receipts share the same vacancy
 * contract; completed legacy modern settlements never reuse an older slate.
 */
import type { ClientSession, Collection, Db } from "mongodb";
import type { GameState } from "@/lib/db/types";
import { HU_1991_COUNTS_COLLECTION, type Hu1991AssemblyRecord } from "./assemblyCount1991";
import { HU_2011_COUNTS_COLLECTION } from "./assemblyCount2011";
import type { HuListNominations } from "./rules/listVacancies1991";
export type HuListAssemblyReceipt = Pick<
  Hu1991AssemblyRecord,
  | "_id"
  | "cycle"
  | "settled"
  | "nominees"
  | "seatedAt"
  | "seatedAtTurn"
  | "listReplacementGeneration"
> & { nominations: HuListNominations };

export function huListParentCollection(
  db: Db,
  receiptId: string
): Collection<HuListAssemblyReceipt> {
  if (receiptId.startsWith("HU:mixed2011:"))
    return db.collection<HuListAssemblyReceipt>(HU_2011_COUNTS_COLLECTION);
  if (receiptId.startsWith("HU:mixed1989:"))
    return db.collection<HuListAssemblyReceipt>(HU_1991_COUNTS_COLLECTION);
  throw new Error("Unknown Hungarian list parent receipt");
}
export async function readHuListAssemblyReceipt(db: Db, session?: ClientSession) {
  const game = await db.collection<GameState>("gameState").findOne(
    { _id: "current" },
    {
      session,
      projection: { preset: 1, huAssemblyReformedAtYear: 1 },
    }
  );
  if (game?.preset !== "1991-default") return null;
  const collection =
    game.huAssemblyReformedAtYear != null ? HU_2011_COUNTS_COLLECTION : HU_1991_COUNTS_COLLECTION;
  const parent = await db.collection<HuListAssemblyReceipt>(collection).findOne(
    { seatedAtTurn: { $exists: true } },
    {
      session,
      sort: { seatedAtTurn: -1 },
      projection: {
        nominations: 1,
        settled: 1,
        nominees: 1,
        seatedAt: 1,
        seatedAtTurn: 1,
        cycle: 1,
        listReplacementGeneration: 1,
      },
    }
  );
  if (parent?._id.startsWith("HU:mixed2011:") && !Array.isArray(parent.nominations.national)) {
    // Earlier modern receipts already froze the full original person slate.
    // Reading its stored order adds no nominee and does not rewrite certification.
    const parties = new Set(
      parent.settled?.mandates.filter((row) => row.tier === "national").map((row) => row.partyId)
    );
    parent.nominations = {
      people: parent.nominations.people,
      territorial: [],
      national: [...parties].map((partyId) => ({
        partyId,
        candidateIds: parent.nominations.people
          .filter((row) => row.partyId === partyId)
          .map((row) => row.id),
      })),
    };
  }
  return parent;
}
