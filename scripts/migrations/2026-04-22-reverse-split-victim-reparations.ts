/**
 * One-shot reparations for victims of the reverse-split shareholder-wipe bug
 * (see `fix/reverse-split-shares-bug` branch + CHANGELOG entry).
 *
 * What this does — verified against live DB before writing:
 *
 *   1. Corp 217 "Harris Industries"
 *        AURORA Group (corp seq 16) currently holds 100,000 shares at
 *        avgCostPerShare = $7.4246. They keep the shares; we refund them
 *        `100,000 × $7.4246 = $742,456.42` USD into AURORA's liquidCapital.
 *        Records a shareTradeHistory `correction` row for the audit trail.
 *
 *   2. Corp 221 "British Chemical Company"
 *        Character seq 152 (Nicolas Maduro) is credited with enough personal
 *        GBP to buy 60 % of the company at the current share price
 *        (`0.60 × 1,146,632 × £70.1670 = £48,273,453.64`). They can use this
 *        to privately repurchase a stake later. Records an admin-mail entry
 *        with the rationale so the player knows where the money came from.
 *
 * Usage
 * -----
 *   npx tsx scripts/migrations/2026-04-22-reverse-split-victim-reparations.ts            # dry-run
 *   npx tsx scripts/migrations/2026-04-22-reverse-split-victim-reparations.ts --apply    # commit
 */
import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const uri = process.env.MONGODB_URI_LIVE;
if (!uri) throw new Error("MONGODB_URI_LIVE must be set in .env.local");
const APPLY = process.argv.includes("--apply");

const NOTE_PREFIX =
  "Reverse-split allocator bug reparations (2026-04-22). See CHANGELOG / fix/reverse-split-shares-bug.";

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  try {
    const db = client.db("a-house-divided");
    const now = new Date();

    // ---- Current turn for audit rows ----
    const gs = (await db
      .collection("gameState")
      .findOne({ _id: "current" as unknown as ObjectId })) as { currentTurn?: number } | null;
    const currentTurn = gs?.currentTurn ?? 0;

    // ---- Corp 217 refund to AURORA ----
    const corp217 = (await db
      .collection("corporations")
      .findOne(
        { sequentialId: 217 },
        { projection: { _id: 1, name: 1, shareholders: 1, sharePrice: 1, liquidCurrencyCode: 1 } }
      )) as {
      _id: ObjectId;
      name: string;
      shareholders: Array<{ corporationId?: ObjectId; shares: number; avgCostPerShare?: number }>;
      sharePrice: number;
      liquidCurrencyCode?: string;
    } | null;
    if (!corp217) throw new Error("Corp 217 not found");

    const auroraHolding = corp217.shareholders.find(
      (h) => h.corporationId?.toString() === "69dac17ee2f9bde884696bbe"
    );
    if (!auroraHolding || !auroraHolding.corporationId) {
      throw new Error("AURORA Group not found in corp 217's shareholders");
    }
    if (auroraHolding.avgCostPerShare == null) {
      throw new Error("AURORA holding missing avgCostPerShare — cannot infer refund amount");
    }
    const refundAmountUsd =
      Math.round(auroraHolding.shares * auroraHolding.avgCostPerShare * 100) / 100;
    console.log(
      `[Corp 217] AURORA holds ${auroraHolding.shares.toLocaleString()} shares @ $${auroraHolding.avgCostPerShare.toFixed(4)} → refund $${refundAmountUsd.toLocaleString()} USD`
    );

    // ---- Corp 221 payout to Nicolas Maduro ----
    const corp221 = (await db.collection("corporations").findOne(
      { sequentialId: 221 },
      {
        projection: {
          _id: 1,
          name: 1,
          totalShares: 1,
          sharePrice: 1,
          liquidCurrencyCode: 1,
        },
      }
    )) as {
      _id: ObjectId;
      name: string;
      totalShares: number;
      sharePrice: number;
      liquidCurrencyCode?: string;
    } | null;
    if (!corp221) throw new Error("Corp 221 not found");
    if (corp221.liquidCurrencyCode !== "GBP") {
      console.warn(
        `WARNING: corp 221 currency is ${corp221.liquidCurrencyCode ?? "?"}, not GBP — continuing as requested anyway.`
      );
    }
    const payoutGbp = Math.round(0.6 * corp221.totalShares * corp221.sharePrice * 100) / 100;
    const maduro = (await db
      .collection("characters")
      .findOne(
        { sequentialId: 152 },
        { projection: { _id: 1, name: 1, userId: 1, sequentialId: 1, currencyBalances: 1 } }
      )) as {
      _id: ObjectId;
      name: string;
      userId: ObjectId;
      sequentialId: number;
      currencyBalances?: { personal?: Record<string, number> };
    } | null;
    if (!maduro) throw new Error("Character seq 152 not found");
    console.log(
      `[Corp 221] ${maduro.name} gets £${payoutGbp.toLocaleString()} GBP (60% of ${corp221.totalShares.toLocaleString()} × £${corp221.sharePrice.toFixed(2)})`
    );
    console.log(`    Maduro current personal.GBP = ${maduro.currencyBalances?.personal?.GBP ?? 0}`);

    if (!APPLY) {
      console.log("\n(dry-run) rerun with --apply to commit changes.");
      return;
    }

    // Idempotency guard: scan for the audit rows / mail we'd emit — if present,
    // the script was already applied and re-running would double-credit.
    const existingAurora = await db.collection("shareTradeHistory").findOne({
      corporationId: corp217._id,
      kind: "correction",
      note: { $regex: NOTE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") },
    });
    const existingMail = await db.collection("playerMail").findOne({
      toCharacterId: maduro._id,
      subject: "Admin reparations: British Chemical Company reverse-split bug",
    });
    if (existingAurora || existingMail) {
      console.error(
        "ABORT — this script appears to have already been applied (found prior audit row or mail). Refusing to double-credit."
      );
      process.exit(2);
    }

    console.log("\n=== Applying ===");

    // --- 1a. Credit AURORA liquidCapital ---
    await db
      .collection("corporations")
      .updateOne(
        { _id: new ObjectId("69dac17ee2f9bde884696bbe") },
        { $inc: { liquidCapital: refundAmountUsd }, $set: { updatedAt: now } }
      );
    console.log(`  + credited AURORA Group liquidCapital +$${refundAmountUsd.toLocaleString()}`);

    // --- 1b. shareTradeHistory audit row for the refund ---
    await db.collection("shareTradeHistory").insertOne({
      corporationId: corp217._id,
      kind: "correction",
      turn: currentTurn,
      createdAt: now,
      shares: 0,
      pricePerShareAnchor: 0,
      totalAnchor: 0,
      from: null,
      to: {
        corporationId: auroraHolding.corporationId,
        name: "AURORA Group",
      },
      note: `${NOTE_PREFIX} Refunded $${refundAmountUsd.toLocaleString()} USD to AURORA Group's liquidCapital; they keep their 100,000 shares in Harris Industries.`,
    });
    console.log("  + inserted shareTradeHistory correction row for corp 217");

    // --- 2a. Credit Maduro GBP personal balance ---
    await db.collection("characters").updateOne(
      { _id: maduro._id },
      {
        $inc: { "currencyBalances.personal.GBP": payoutGbp },
        $set: { updatedAt: now },
      }
    );
    console.log(`  + credited ${maduro.name} personal.GBP +£${payoutGbp.toLocaleString()}`);

    // --- 2b. System-generated player mail to Maduro ---
    await db.collection("playerMail").insertOne({
      fromCharacterName: "Admin",
      toUserId: maduro.userId,
      toCharacterId: maduro._id,
      toCharacterName: maduro.name,
      toCharacterSequentialId: maduro.sequentialId,
      subject: "Admin reparations: British Chemical Company reverse-split bug",
      body:
        `A bug in the stock-split allocator erased corporate and imperial shareholders ` +
        `when CEOs ran splits or reverse splits in corporations. British Chemical Company ` +
        `(corp 221) performed a reverse split while the bug was live. As reparations, your ` +
        `personal GBP balance has been credited with £${payoutGbp.toLocaleString()} — enough ` +
        `to privately repurchase 60% of the company at the current share price (£${corp221.sharePrice.toFixed(2)}). ` +
        `Arrange a private sale with the CEO at your convenience.\n\n` +
        `— Admin`,
      read: false,
      deletedByRecipient: false,
      deletedBySender: false,
      createdAt: now,
    });
    console.log("  + mailed Maduro with context");

    console.log("\nDone.");
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
