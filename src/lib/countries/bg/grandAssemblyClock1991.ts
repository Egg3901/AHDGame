/**
 * Founding Bulgarian deputies retain the original Grand Assembly term after
 * the founding calendar unpins. Only native mandate dates change; financial
 * owners and legacy officeholders keep their existing records.
 */
import type { Db } from "mongodb";
import type { ElectedOfficial } from "@/lib/db/types";
import type { CycleAnchorContext } from "@/lib/elections/cycleAnchorContext";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { BG_FOUNDING_COUNTS_COLLECTION, type BgFoundingAssemblyRecord } from "./foundingCount1990";
import {
  bgGrandAssemblyRegularAnchor,
  bgFoundingMandateTermAnchor,
} from "./rules/assemblyClock1991";

export async function loadBgGrandAssemblyClock(
  db: Db,
  ctx: CycleAnchorContext,
  turn: number,
  now: Date
): Promise<number | undefined> {
  if (ctx.preset !== "1991-default" || ctx.preIterationActive) return undefined;
  const journal = db.collection<BgFoundingAssemblyRecord>(BG_FOUNDING_COUNTS_COLLECTION);
  const filter = { _id: "BG:founding1990:0", seatedAtTurn: { $exists: true } };
  const options = { projection: { seatedAtTurn: 1, grandTermEndTurn: 1 } };
  const receipt = await journal.findOne(filter, options);
  if (!receipt) return undefined;
  const historicalEndTurn = bgGrandAssemblyRegularAnchor(ctx);
  if (receipt.grandTermEndTurn != null)
    return bgGrandAssemblyRegularAnchor({ ...ctx, nativeAnchorTurn: receipt.grandTermEndTurn });
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid Bulgarian mandate clock time");
  return runRequiredTransaction(
    async (session) => {
      const current = await journal.findOne(filter, { ...options, session });
      if (!current) throw new Error("Bulgarian founding receipt changed during clock alignment");
      if (current.grandTermEndTurn != null)
        return bgGrandAssemblyRegularAnchor({ ...ctx, nativeAnchorTurn: current.grandTermEndTurn });
      const endTurn = bgFoundingMandateTermAnchor(historicalEndTurn, current.seatedAtTurn!);
      await db.collection<ElectedOfficial>("electedOfficials").updateMany(
        {
          countryId: "BG",
          officeType: "assemblyDeputy",
          "bulgarianFoundingMandate.receiptId": current._id,
        },
        {
          $set: {
            termEnds: new Date(now.getTime() + (endTurn - turn) * MS_PER_TURN),
            updatedAt: now,
          },
        },
        { session }
      );
      const marked = await journal.updateOne(
        { ...filter, grandTermEndTurn: { $exists: false } },
        { $set: { grandTermEndTurn: endTurn } },
        { session }
      );
      if (marked.modifiedCount !== 1)
        throw new Error("Bulgarian founding clock changed concurrently");
      return endTurn;
    },
    { client: db.client }
  );
}
