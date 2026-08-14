/**
 * Backfill `bankCharter.cashReserves` for ACTIVE banks chartered before the
 * ring-fence.
 *
 * ## What moves and why
 *
 * Until now a chartered bank kept its money in `corporation.liquidCapital`,
 * the same field the corporation spends. Every banking cash flow wrote there:
 * deposit interest out, loan interest in, insurance premiums out, discount
 * window draws in, prop trades both ways. So for an existing bank, the cash in
 * `liquidCapital` IS the bank's cash — not because we are deciding it should
 * be, but because that is where the engine has been putting it all along.
 *
 * This migration therefore moves the whole balance across and leaves the
 * holding company at zero. That reads alarming and is not: corporate revenue
 * still credits `liquidCapital` every turn from `sectorTurn`, so the holdco
 * refills from operations, and any bank holding more than its reserve
 * requirement can upstream the surplus immediately (`bankCash.upstreamBankCash`).
 *
 * ## What it does NOT do
 *
 * It does not invent reserves. Several live banks hold far less cash than 20%
 * of their deposit base, because deposits in this engine never arrived as cash
 * in the first place (`bankingTurn` phase (b) debits the central bank's
 * `externalBroadMoney` and writes a number on the charter). Those banks come
 * out of this migration visibly under-reserved, which is a true statement about
 * them. The consequence is supervisory — no upstreaming until they build the
 * reserve — and deliberately not a freeze on the corporation.
 *
 * Idempotent: a charter that already has a `cashReserves` field is skipped, so
 * a re-run after a partial failure resumes rather than double-moving.
 *
 * DRY RUN by default. Pass --apply to write.
 */

import { ObjectId, type Db } from "mongodb";
import { connectDb, closeDb } from "../utils/db";

const APPLY = process.argv.includes("--apply");

function configureRepairDbUri(): void {
  if (!process.env.MONGODB_URI && process.env.MONGODB_URI_LIVE) {
    process.env.MONGODB_URI = process.env.MONGODB_URI_LIVE;
  }
}

type CharterRow = {
  status?: string;
  postedCapital?: number;
  totalDeposits?: number;
  cashReserves?: number;
};

type BankRow = {
  _id: ObjectId;
  name?: string;
  liquidCapital?: number;
  bankCharter?: CharterRow;
};

/** Era default when no central bank has set one. Mirrors `reserveBounds.ts`. */
const RESERVE_REQUIREMENT_HISTORICAL_DEFAULT = 0.2;
const RESERVE_REQUIREMENT_MODERN_DEFAULT = 0.1;

function nonNegative(n: number | undefined): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

async function main(): Promise<void> {
  configureRepairDbUri();
  const db: Db = await connectDb();
  try {
    const gameState = await db
      .collection<{ _id: string; isProcessing?: boolean; eraUnitScale?: number }>("gameState")
      .findOne({ _id: "current" });
    if (APPLY && gameState?.isProcessing) {
      throw new Error("Refusing to migrate while a turn is processing. Pause turns and retry.");
    }
    const reserveRatio =
      (gameState?.eraUnitScale ?? 1) > 1
        ? RESERVE_REQUIREMENT_HISTORICAL_DEFAULT
        : RESERVE_REQUIREMENT_MODERN_DEFAULT;

    const banks = await db
      .collection<BankRow>("corporations")
      // ACTIVE charters only. A failed bank has already been through
      // resolution: its deposits and posted capital are zeroed and its
      // corporation is often carrying a NEGATIVE liquidCapital, which is the
      // corporation's own debt and not bank money. Copying that across would
      // book negative reserves, and zeroing the corporation's balance would
      // quietly forgive the debt. Failed charters keep an absent `cashReserves`,
      // which reads as zero, which is the truth about what they hold.
      .find({ "bankCharter.status": "active" })
      .project<BankRow>({ _id: 1, name: 1, liquidCapital: 1, bankCharter: 1 })
      .toArray();

    let moved = 0;
    let skipped = 0;
    let shortOfReserve = 0;

    for (const bank of banks) {
      const charter = bank.bankCharter;
      if (!charter) continue;
      if (typeof charter.cashReserves === "number") {
        skipped += 1;
        continue;
      }

      const cash = nonNegative(bank.liquidCapital);
      const required = nonNegative(charter.totalDeposits) * reserveRatio;
      const short = cash < required;
      if (short) shortOfReserve += 1;

      console.log(
        [
          short ? "SHORT " : "      ",
          (bank.name ?? String(bank._id)).padEnd(28),
          `cash ${Math.round(cash).toLocaleString().padStart(16)}`,
          `required ${Math.round(required).toLocaleString().padStart(16)}`,
          `posted ${Math.round(nonNegative(charter.postedCapital)).toLocaleString().padStart(12)}`,
        ].join(" ")
      );

      if (APPLY) {
        await db.collection<BankRow>("corporations").updateOne(
          { _id: bank._id, "bankCharter.cashReserves": { $exists: false } },
          {
            $set: { "bankCharter.cashReserves": cash, liquidCapital: 0, updatedAt: new Date() },
          }
        );
      }
      moved += 1;
    }

    console.log("");
    console.log(`banks:            ${banks.length}`);
    console.log(`migrated:         ${moved}`);
    console.log(`already done:     ${skipped}`);
    console.log(`under-reserved:   ${shortOfReserve} (expected; supervisory, not a freeze)`);
    console.log(APPLY ? "APPLIED" : "DRY RUN — pass --apply to write");
  } finally {
    await closeDb();
  }
}

void main();
