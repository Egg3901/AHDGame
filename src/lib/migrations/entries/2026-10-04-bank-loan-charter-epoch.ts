import type { BankCharterHistoryEntry, BankLoan } from "@/lib/db/types/bank";
import type { Corporation } from "@/lib/db/types";
import type { Migration } from "../types";

type EpochRange = { charteredTurn: number; archivedTurn?: number };

/** Backfill loan ownership metadata without changing balances or loan status. */
export const migration: Migration = {
  id: "2026-10-04-bank-loan-charter-epoch",
  description: "Tag bank loans with the charter epoch that originated them.",
  idempotent: true,
  execute: async (db, ctx) => {
    const [loans, history, corporations] = await Promise.all([
      db
        .collection<BankLoan>("bankLoans")
        .find({ charteredTurn: { $exists: false } })
        .project<Pick<BankLoan, "_id" | "bankCorporationId" | "originatedTurn">>({
          bankCorporationId: 1,
          originatedTurn: 1,
        })
        .toArray(),
      db
        .collection<BankCharterHistoryEntry>("bankCharterHistory")
        .find({})
        .project<Pick<BankCharterHistoryEntry, "corporationId" | "charter" | "archivedTurn">>({
          corporationId: 1,
          charter: 1,
          archivedTurn: 1,
        })
        .toArray(),
      db
        .collection<Corporation>("corporations")
        .find({ "bankCharter.charteredTurn": { $exists: true } })
        .project<Pick<Corporation, "_id" | "bankCharter">>({ bankCharter: 1 })
        .toArray(),
    ]);

    const rangesByBank = new Map<string, EpochRange[]>();
    for (const entry of history) {
      const key = entry.corporationId.toString();
      const ranges = rangesByBank.get(key) ?? [];
      ranges.push({
        charteredTurn: entry.charter.charteredTurn,
        archivedTurn: entry.archivedTurn,
      });
      rangesByBank.set(key, ranges);
    }
    for (const corporation of corporations) {
      const charter = corporation.bankCharter;
      if (!charter) continue;
      const key = corporation._id.toString();
      const ranges = rangesByBank.get(key) ?? [];
      ranges.push({ charteredTurn: charter.charteredTurn });
      rangesByBank.set(key, ranges);
    }

    const operations = loans.map((loan) => {
      const ranges = rangesByBank.get(loan.bankCorporationId.toString()) ?? [];
      const originatedTurn = Number.isFinite(loan.originatedTurn) ? loan.originatedTurn : 0;
      const matching = ranges
        .filter(
          (range) =>
            range.charteredTurn <= originatedTurn &&
            (range.archivedTurn === undefined || originatedTurn < range.archivedTurn)
        )
        .sort((a, b) => b.charteredTurn - a.charteredTurn)[0];
      const epoch = matching?.charteredTurn ?? originatedTurn;
      return {
        updateOne: {
          filter: { _id: loan._id, charteredTurn: { $exists: false } },
          update: { $set: { charteredTurn: epoch } },
        },
      };
    });

    if (!ctx.dryRun && operations.length > 0) {
      await db.collection<BankLoan>("bankLoans").bulkWrite(operations, { ordered: false });
    }
    return {
      documentsScanned: loans.length,
      documentsUpdated: ctx.dryRun ? 0 : operations.length,
      notes: [
        ctx.dryRun
          ? "Would tag existing loans using archived and current charter epochs"
          : "Tagged existing loans using archived and current charter epochs",
        "Loans without a matching charter record keep their originated turn as the compatibility epoch",
      ],
    };
  },
};
