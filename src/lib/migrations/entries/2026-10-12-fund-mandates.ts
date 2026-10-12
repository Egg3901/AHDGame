import type { IndexFund } from "@/lib/db/types/indexFund";
import { resolveFundMandate } from "@/lib/indexFunds/mandate";
import type { Migration } from "../types";

export const migration: Migration = {
  id: "2026-10-12-fund-mandates",
  description: "Persist compatible index mandates and legacy sponsor seed contracts.",
  idempotent: true,
  async execute(db, ctx) {
    const funds = await db
      .collection<IndexFund>("indexFunds")
      .find(
        {
          $or: [
            { mandate: { $exists: false } },
            {
              sponsorCorporationId: { $exists: true },
              seedAccounting: { $exists: false },
            },
          ],
        },
        { projection: { floatSettlementPlan: 0 } }
      )
      .toArray();
    const operations = funds.map((fund) => ({
      updateOne: {
        filter: { _id: fund._id },
        update: {
          $set: {
            ...(!fund.mandate ? { mandate: resolveFundMandate(fund) } : {}),
            ...(fund.sponsorCorporationId && !fund.seedAccounting
              ? { seedAccounting: "legacy_residual" as const }
              : {}),
          },
        },
      },
    }));
    const result =
      !ctx.dryRun && operations.length
        ? await db.collection<IndexFund>("indexFunds").bulkWrite(operations)
        : null;
    return {
      documentsScanned: funds.length,
      documentsUpdated: result?.modifiedCount ?? 0,
      notes: ["Cash, units, positions, queued claims and existing fee terms are unchanged."],
    };
  },
};
