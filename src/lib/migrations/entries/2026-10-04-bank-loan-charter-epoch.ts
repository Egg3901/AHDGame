import type { BankCharterHistoryEntry, BankLoan } from "@/lib/db/types/bank";
import type { Corporation } from "@/lib/db/types";
import type { Migration } from "../types";

type EpochRange = { charteredTurn: number; nextCharteredTurn?: number };

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
        .project<Pick<BankCharterHistoryEntry, "corporationId" | "charter">>({
          corporationId: 1,
          charter: 1,
        })
        .toArray(),
      db
        .collection<Corporation>("corporations")
        .find({ "bankCharter.charteredTurn": { $exists: true } })
        .project<Pick<Corporation, "_id" | "bankCharter">>({ bankCharter: 1 })
        .toArray(),
    ]);

    const turnsByBank = new Map<string, Set<number>>();
    const addEpoch = (bankId: string, charteredTurn: number) => {
      const turns = turnsByBank.get(bankId) ?? new Set<number>();
      turns.add(charteredTurn);
      turnsByBank.set(bankId, turns);
    };
    for (const entry of history) {
      addEpoch(entry.corporationId.toString(), entry.charter.charteredTurn);
    }
    for (const corporation of corporations) {
      const charter = corporation.bankCharter;
      if (!charter) continue;
      addEpoch(corporation._id.toString(), charter.charteredTurn);
    }

    const rangesByBank = new Map<string, EpochRange[]>();
    for (const [bankId, turnSet] of turnsByBank) {
      const turns = [...turnSet].sort((a, b) => a - b);
      rangesByBank.set(
        bankId,
        turns.map((charteredTurn, index) => {
          const nextCharteredTurn = turns[index + 1];
          return nextCharteredTurn === undefined
            ? { charteredTurn }
            : { charteredTurn, nextCharteredTurn };
        })
      );
    }

    const operations = [];
    let unmatchedLoans = 0;
    for (const loan of loans) {
      if (!Number.isFinite(loan.originatedTurn)) {
        unmatchedLoans += 1;
        continue;
      }
      const ranges = rangesByBank.get(loan.bankCorporationId.toString()) ?? [];
      const matching = ranges.find(
        (range) =>
          range.charteredTurn <= loan.originatedTurn &&
          (range.nextCharteredTurn === undefined || loan.originatedTurn < range.nextCharteredTurn)
      );
      if (!matching) {
        unmatchedLoans += 1;
        continue;
      }
      operations.push({
        updateOne: {
          filter: { _id: loan._id, charteredTurn: { $exists: false } },
          update: { $set: { charteredTurn: matching.charteredTurn } },
        },
      });
    }

    if (!ctx.dryRun && operations.length > 0) {
      await db.collection<BankLoan>("bankLoans").bulkWrite(operations, { ordered: false });
    }
    return {
      documentsScanned: loans.length,
      documentsUpdated: ctx.dryRun ? 0 : operations.length,
      notes: [
        ctx.dryRun
          ? `Would tag ${operations.length} existing loans using archived and current charter epochs`
          : `Tagged ${operations.length} existing loans using archived and current charter epochs`,
        `${unmatchedLoans} loans had no trustworthy charter match and remain untagged`,
      ],
    };
  },
};
