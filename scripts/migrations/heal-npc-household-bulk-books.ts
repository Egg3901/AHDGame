/**
 * Incident repair: remove the unfunded GDP-anchored NPC bulk loan books.
 *
 * The faulty implementation gave every retail bank a separate fraction of
 * national GDP, irrespective of that bank's deposits or reserve requirement.
 * This script retires those synthetic loans and recomputes each ACTIVE bank's
 * cached loan total from its still-live named loans. The corrected turn code
 * then restarts household deposits and loans gradually from zero.
 *
 * This does not touch failed charters. Their failure path may already have
 * resolved deposits, zeroed capital, and caused contagion. Restoring them is a
 * separate player-facing decision requiring a reviewed recovery plan.
 *
 * Historical NPC interest was not ledgered before this repair, so there is no
 * trustworthy per-bank amount to claw back. Do not infer one from present cash:
 * that can include player revenue, capital injections, and other valid flows.
 *
 * Usage:
 *   npx tsx scripts/migrations/heal-npc-household-bulk-books.ts
 *   npx tsx scripts/migrations/heal-npc-household-bulk-books.ts --apply
 *
 * Default is a read-only report. `--apply` refuses to run while a turn is in
 * flight and is idempotent: subsequent runs find no active NPC bulk assets.
 */
import type { ObjectId } from "mongodb";
import { connectDb, closeDb } from "../utils/db";

type LoanRow = {
  _id: ObjectId;
  bankCorporationId: ObjectId;
  borrowerType: "corporation" | "character" | "npcBulk";
  outstanding?: number;
  status: "current" | "arrears" | "defaulted" | "repaid";
};

type ActiveBankRow = {
  _id: ObjectId;
  name?: string;
  liquidCapital?: number;
  bankCharter?: {
    status?: string;
    totalLoans?: number;
  };
};

type GameState = {
  isProcessing?: boolean;
  currentTurn?: number;
};

const APPLY = process.argv.includes("--apply");

function nonNegative(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

async function main(): Promise<void> {
  const db = await connectDb();
  try {
    const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    if (APPLY && gameState?.isProcessing) {
      throw new Error("Refusing to repair while a turn is processing. Pause turns and retry.");
    }

    const [activeBanks, failedCount] = await Promise.all([
      db
        .collection<ActiveBankRow>("corporations")
        .find({
          "bankCharter.status": "active",
          "bankCharter.type": { $in: ["retail", "universal"] },
        })
        .project({ _id: 1, name: 1, liquidCapital: 1, bankCharter: 1 })
        .toArray(),
      db.collection("corporations").countDocuments({ "bankCharter.status": "failed" }),
    ]);
    const activeBankIds = activeBanks.map((bank) => bank._id);
    const loans =
      activeBankIds.length === 0
        ? []
        : await db
            .collection<LoanRow>("bankLoans")
            .find({ bankCorporationId: { $in: activeBankIds } })
            .project({ _id: 1, bankCorporationId: 1, borrowerType: 1, outstanding: 1, status: 1 })
            .toArray();

    const bulkLoans = loans.filter(
      (loan) =>
        loan.borrowerType === "npcBulk" && (loan.status === "current" || loan.status === "arrears")
    );
    const namedOutstandingByBank = new Map<string, number>();
    for (const loan of loans) {
      if (loan.borrowerType === "npcBulk") continue;
      if (loan.status !== "current" && loan.status !== "arrears") continue;
      const key = loan.bankCorporationId.toHexString();
      namedOutstandingByBank.set(
        key,
        (namedOutstandingByBank.get(key) ?? 0) + nonNegative(loan.outstanding)
      );
    }

    const phantomOutstanding = bulkLoans.reduce(
      (sum, loan) => sum + nonNegative(loan.outstanding),
      0
    );
    const affectedBankIds = new Set(bulkLoans.map((loan) => loan.bankCorporationId.toHexString()));
    console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
    console.log(`Active deposit-taking banks: ${activeBanks.length}`);
    console.log(`NPC bulk loans to retire: ${bulkLoans.length}`);
    console.log(`NPC bulk outstanding to remove: ${phantomOutstanding.toLocaleString()}`);
    console.log(`Failed charters left untouched: ${failedCount}`);

    for (const bank of activeBanks) {
      const namedOutstanding = namedOutstandingByBank.get(bank._id.toHexString()) ?? 0;
      const cached = nonNegative(bank.bankCharter?.totalLoans);
      if (
        cached === namedOutstanding &&
        !bulkLoans.some((loan) => loan.bankCorporationId.equals(bank._id))
      ) {
        continue;
      }
      affectedBankIds.add(bank._id.toHexString());
      console.log(
        `${bank.name ?? bank._id.toHexString()}: totalLoans ${cached.toLocaleString()} -> ${namedOutstanding.toLocaleString()}`
      );
    }

    if (!APPLY) {
      console.log("Dry run only. Pass --apply after pausing turns and reviewing this report.");
      return;
    }

    const now = new Date();
    if (bulkLoans.length > 0) {
      await db.collection<LoanRow>("bankLoans").updateMany(
        { _id: { $in: bulkLoans.map((loan) => loan._id) } },
        {
          $set: {
            outstanding: 0,
            principal: 0,
            status: "repaid",
            lastProcessedTurn: gameState?.currentTurn,
          },
        }
      );
    }

    for (const bank of activeBanks) {
      if (!affectedBankIds.has(bank._id.toHexString())) continue;
      await db.collection<ActiveBankRow>("corporations").updateOne(
        { _id: bank._id, "bankCharter.status": "active" },
        {
          $set: {
            "bankCharter.totalLoans": namedOutstandingByBank.get(bank._id.toHexString()) ?? 0,
            "bankCharter.reserves": nonNegative(bank.liquidCapital),
            updatedAt: now,
          },
          $unset: {
            "bankCharter.undercapitalizedSinceTurn": "",
            "bankCharter.capitalStanding": "",
            "bankCharter.capitalRatio": "",
            "bankCharter.stressedCapitalRatio": "",
          },
        }
      );
    }

    console.log("Repair applied. Run a banking turn only after the corrected code is deployed.");
  } finally {
    await closeDb();
  }
}

if (process.argv[1]?.includes("heal-npc-household-bulk-books")) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
