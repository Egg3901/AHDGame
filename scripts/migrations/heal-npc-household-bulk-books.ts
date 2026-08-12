/**
 * Incident repair: remove the unfunded GDP-anchored NPC bulk loan books.
 *
 * The faulty implementation gave every retail bank a separate fraction of
 * national GDP, irrespective of that bank's deposits or reserve requirement.
 * This script retires those synthetic loans and recomputes each bank's cached
 * loan total from its still-live named loans. It also restores failed charters
 * from the archive captured at failure, with clean books and no failure state.
 * The corrected turn code then restarts household deposits and loans gradually
 * from zero.
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
 * It prefers `MONGODB_URI` and accepts the production incident variable
 * `MONGODB_URI_LIVE` when no ordinary URI is present.
 */
import type { ObjectId } from "mongodb";
import type { BankCharter, BankCharterHistoryEntry } from "@/lib/db/types/bank";
import { NPC_BANK_CAPITAL_BUFFER_MULTIPLIER } from "@/lib/banking/npcBanks";
import { connectDb, closeDb } from "../utils/db";

type LoanRow = {
  _id: ObjectId;
  bankCorporationId: ObjectId;
  borrowerType: "corporation" | "character" | "npcBulk";
  outstanding?: number;
  status: "current" | "arrears" | "defaulted" | "repaid";
};

type BankRow = {
  _id: ObjectId;
  name?: string;
  ceoType?: string;
  liquidCapital?: number;
  bankCharter?: BankCharter;
};

type GameState = {
  isProcessing?: boolean;
  currentTurn?: number;
};

const APPLY = process.argv.includes("--apply");

function configureRepairDbUri(): void {
  if (!process.env.MONGODB_URI && process.env.MONGODB_URI_LIVE) {
    process.env.MONGODB_URI = process.env.MONGODB_URI_LIVE;
  }
}

function nonNegative(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Build a clean active charter from the archive captured immediately before failure. */
export function buildReactivatedCharter(
  archived: BankCharter,
  liquidCapital: number,
  namedLoanOutstanding = 0
): BankCharter {
  const {
    failedTurn: _failedTurn,
    depositorsResolvedTurn: _depositorsResolvedTurn,
    capitalStanding: _capitalStanding,
    capitalRatio: _capitalRatio,
    stressedCapitalRatio: _stressedCapitalRatio,
    undercapitalizedSinceTurn: _undercapitalizedSinceTurn,
    lastSupervisionTurn: _lastSupervisionTurn,
    lastSolvencyTurn: _lastSolvencyTurn,
    lastBankingTurn: _lastBankingTurn,
    propBook: _propBook,
    propBookMarkValue: _propBookMarkValue,
    interbankDebt: _interbankDebt,
    cbMarginDebt: _cbMarginDebt,
    cbMarginArrears: _cbMarginArrears,
    lastCbMarginTurn: _lastCbMarginTurn,
    discountWindowDebt: _discountWindowDebt,
    discountWindowArrears: _discountWindowArrears,
    lastDiscountWindowTurn: _lastDiscountWindowTurn,
    ...terms
  } = archived;

  return {
    ...terms,
    status: "active",
    totalDeposits: 0,
    totalLoans: nonNegative(namedLoanOutstanding),
    npcDeposits: 0,
    reserves: nonNegative(liquidCapital),
    confidence: 1,
    warningBand: "green",
    panicTurns: 0,
    propBook: [],
    propBookMarkValue: 0,
    interbankDebt: 0,
    cbMarginDebt: 0,
    cbMarginArrears: 0,
    discountWindowDebt: 0,
    discountWindowArrears: 0,
  };
}

function restorationLiquidCapital(bank: BankRow, archived: BankCharter): number {
  // NPP banks were seeded with 1x charter capital posted and 2x as the working
  // cash buffer. Failure destroyed both. Restore the documented buffer, not
  // the untraceable phantom interest earned from the corrupt loan book.
  if (bank.ceoType !== "npp") return 0;
  return nonNegative(archived.postedCapital) * (NPC_BANK_CAPITAL_BUFFER_MULTIPLIER - 1);
}

async function main(): Promise<void> {
  configureRepairDbUri();
  const db = await connectDb();
  try {
    const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    if (APPLY && gameState?.isProcessing) {
      throw new Error("Refusing to repair while a turn is processing. Pause turns and retry.");
    }

    const [activeBanks, failedBanks] = await Promise.all([
      db
        .collection<BankRow>("corporations")
        .find({
          "bankCharter.status": "active",
          "bankCharter.type": { $in: ["retail", "universal"] },
        })
        .project({ _id: 1, name: 1, ceoType: 1, liquidCapital: 1, bankCharter: 1 })
        .toArray(),
      db
        .collection<BankRow>("corporations")
        .find({
          "bankCharter.status": "failed",
          "bankCharter.type": { $in: ["retail", "universal"] },
        })
        .project({ _id: 1, name: 1, ceoType: 1, liquidCapital: 1, bankCharter: 1 })
        .toArray(),
    ]);
    const allBanks = [...activeBanks, ...failedBanks];
    const allBankIds = allBanks.map((bank) => bank._id);
    const failedBankIds = failedBanks.map((bank) => bank._id);
    const archives =
      failedBankIds.length === 0
        ? []
        : await db
            .collection<BankCharterHistoryEntry>("bankCharterHistory")
            .find({ corporationId: { $in: failedBankIds }, reason: "failed" })
            .sort({ archivedTurn: -1 })
            .toArray();
    const latestFailureArchive = new Map<string, BankCharterHistoryEntry>();
    for (const archive of archives) {
      const id = archive.corporationId.toHexString();
      if (!latestFailureArchive.has(id)) latestFailureArchive.set(id, archive);
    }
    const unarchivedFailures = failedBanks.filter(
      (bank) => !latestFailureArchive.has(bank._id.toHexString())
    );
    const loans =
      allBankIds.length === 0
        ? []
        : await db
            .collection<LoanRow>("bankLoans")
            .find({ bankCorporationId: { $in: allBankIds } })
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
    console.log(`Failed deposit-taking banks to reactivate: ${failedBanks.length}`);
    console.log(`NPC bulk loans to retire: ${bulkLoans.length}`);
    console.log(`NPC bulk outstanding to remove: ${phantomOutstanding.toLocaleString()}`);
    if (unarchivedFailures.length > 0) {
      console.log(
        `Failed banks missing a failure archive: ${unarchivedFailures.map((bank) => bank.name ?? bank._id.toHexString()).join(", ")}`
      );
    }

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
    if (unarchivedFailures.length > 0) {
      throw new Error(
        "Refusing a partial recovery: one or more failed charters have no failure archive."
      );
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

    for (const bank of failedBanks) {
      const archive = latestFailureArchive.get(bank._id.toHexString());
      if (!archive) continue;
      const namedOutstanding = namedOutstandingByBank.get(bank._id.toHexString()) ?? 0;
      const restoredCash = restorationLiquidCapital(bank, archive.charter);
      const restoredCharter = buildReactivatedCharter(
        archive.charter,
        restoredCash,
        namedOutstanding
      );
      await db.collection<BankRow>("corporations").updateOne(
        { _id: bank._id, "bankCharter.status": "failed" },
        {
          $set: {
            liquidCapital: restoredCash,
            bankCharter: restoredCharter,
            updatedAt: now,
          },
        }
      );
      console.log(
        `Reactivated ${bank.name ?? bank._id.toHexString()}: posted capital ${restoredCharter.postedCapital.toLocaleString()}, working cash ${restoredCash.toLocaleString()}`
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
