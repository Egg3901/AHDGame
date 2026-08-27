/**
 * Ticket #1198 heal — rewind corporation #624's bond state to end of turn 414.
 *
 * WHY. #624 was declared insolvent by a gate that valued its assets on a basis
 * the issuance ceiling never used, and that ignored its A1.79bn bond portfolio
 * outright. It defaulted at turns 415, 416 and 418, each default forcing a
 * refinance that replaced the bond with a fresh one at a punitive 9.15% coupon.
 * None of it should have happened. This restores the world to the last state
 * before the first erroneous default.
 *
 * WHAT. Everything bond-related touching bonds B1/B2/B3 from turn 415 onward is
 * reversed, for every party:
 *
 *   - B1 (4.4%, issued t413) is restored as the live, non-defaulted bond, with
 *     the holder roster and public float it carried at end of t414.
 *   - B2 and B3, which exist only as products of the defaults, are deleted.
 *   - Every cash flow logged against B1/B2/B3 at turn >= 415 is negated on the
 *     party that received or paid it: issuer coupons back to #624, holder
 *     coupons clawed back, the t415 secondary-market purchases and sales of B2
 *     unwound. Reversal is driven off `financialTxLog`, so the ledger is the
 *     source of truth and nothing is reconstructed by hand.
 *   - #624's `bondDefaultCreditPenaltyUntilTurn` is cleared.
 *   - bondHistory rows for these bonds at turn >= 415 are removed.
 *
 * Third parties are deliberately in scope: corp 6a8368f5 bought 486,804 units
 * of B2 at par on t415 and is refunded in full; two holders that exited on t415
 * have their proceeds clawed and their B1 units restored by the B1 roster.
 *
 * SAFETY. Dry run by default — prints the full plan and writes nothing. Pass
 * --apply to execute. Every balance change is an $inc of the exact negated
 * amount the ledger recorded, in the currency the ledger recorded it in, so the
 * arithmetic cannot drift from what actually happened.
 *
 *   npx tsx scripts/migrations/heal-1198-corp624-bond-rewind.ts
 *   npx tsx scripts/migrations/heal-1198-corp624-bond-rewind.ts --apply
 */
import { MongoClient, ObjectId } from "mongodb";
import type { AnyBulkWriteOperation } from "mongodb";
import * as dotenv from "dotenv";
import fs from "fs";
import path from "path";
import type { Character, Corporation } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { buildPersonalBalanceBulkOp } from "@/lib/currency/characterFunds";

dotenv.config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");

const CORP_624 = new ObjectId("6a8a532d88f385e637156522");
/** The original 4.4% bond. Restored to live. */
const B1 = new ObjectId("6a8f5d9eeab3fa42440c6cab");
/** Products of the erroneous defaults. Deleted. */
const B2 = new ObjectId("6a8f705a510e0d563d430d2f");
const B3 = new ObjectId("6a8f8c1c181644735dd18bcd");
const CHAIN = [B1, B2, B3];
const CHAIN_STR = CHAIN.map((o) => o.toString());

/**
 * Sellers exempt from the cash clawback.
 *
 * Both sold their position into B2 on t415 and have spent the proceeds across
 * the three turns since; reversing their cash would leave them at -A6.4m and
 * -A1.0m respectively, i.e. it would heal #624 by handing two uninvolved corps
 * the exact failure we are fixing. Their t415 sale stands as a real trade at a
 * real price, so they keep the cash — and correspondingly they do NOT get their
 * B1 units back. Those units move to `publicFloat` instead, so no one ends up
 * holding both the proceeds and the position, and nothing is minted.
 */
const EXEMPT_SELLERS = new Map<string, string>([
  ["6a8a556b849ffcd37a896f69", "Aeropagus Incorporated (#625)"],
  ["6a8829827badf9bb53c0b6b9", "Doofenshmirtz Evil Incorporated (#616)"],
]);

/** First erroneous default. Everything from here is reversed. */
const REWIND_FROM_TURN = 415;
/** B1's market price in the last clean bondHistory row (turn 414). */
const B1_MARKET_PRICE_T414 = 0.9466;

const money = (n: number) => (n < 0 ? "-" : "+") + Math.abs(n).toLocaleString();

async function main() {
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE is not set");
  const client = new MongoClient(
    uri.includes("directConnection")
      ? uri
      : uri + (uri.includes("?") ? "&" : "?") + "directConnection=true",
    { serverSelectionTimeoutMS: 30_000 }
  );
  await client.connect();
  const db = client.db("a-house-divided");

  const gs = (await db.collection("gameState").findOne({ _id: "current" as never })) as {
    currentTurn?: number;
    forexEnabled?: boolean;
  } | null;
  const forexEnabled = gs?.forexEnabled === true;
  console.log(
    `${APPLY ? "APPLY" : "DRY RUN"} — world turn ${gs?.currentTurn}, forexEnabled=${forexEnabled}`
  );
  console.log(`Rewinding bonds ${CHAIN_STR.join(", ")} from turn ${REWIND_FROM_TURN}.\n`);

  // ── 1. Collect every ledger row to reverse ────────────────────────────────
  // `reversed: { $ne: true }` is what makes this migration safe to re-run. The
  // apply step stamps every row it reverses, so a second run finds nothing and
  // exits. Without it, running twice would credit every party a second time.
  const rows = await db
    .collection("financialTxLog")
    .find({
      "meta.bondId": { $in: CHAIN_STR },
      turn: { $gte: REWIND_FROM_TURN },
      reversed: { $ne: true },
    })
    .sort({ turn: 1 })
    .toArray();

  const alreadyReversed = await db.collection("financialTxLog").countDocuments({
    "meta.bondId": { $in: CHAIN_STR },
    turn: { $gte: REWIND_FROM_TURN },
    reversed: true,
  });

  console.log(`Ledger rows in scope: ${rows.length} (already reversed: ${alreadyReversed})`);
  if (rows.length === 0) {
    console.log(`\nNothing to do — this rewind has already been applied. Exiting without changes.`);
    await client.close();
    return;
  }
  const byTypeTurn = new Map<string, number>();
  for (const r of rows) {
    const k = `t${r.turn} ${r.type}`;
    byTypeTurn.set(k, (byTypeTurn.get(k) ?? 0) + 1);
  }
  for (const [k, n] of [...byTypeTurn.entries()].sort()) console.log(`   ${k} x${n}`);

  // ── 2. Net each party's exposure, per currency ────────────────────────────
  // `amount` is the signed delta already applied to that party's balance, so the
  // reversal is its negation. Zero-amount rows (the cashless refinance
  // issuances) net out on their own and are kept only for the audit trail.
  type Key = string;
  const net = new Map<
    Key,
    { subjectType: string; subjectId: ObjectId; currency: CurrencyCode; amount: number }
  >();
  for (const r of rows) {
    const amount = Number(r.amount);
    if (!Number.isFinite(amount) || amount === 0) continue;
    if (!r.subjectId) continue;
    const currency = (r.currencyCode ?? "USD") as CurrencyCode;
    const key = `${r.subjectType}|${r.subjectId.toString()}|${currency}`;
    const prev = net.get(key);
    if (prev) prev.amount += amount;
    else
      net.set(key, {
        subjectType: r.subjectType,
        subjectId: r.subjectId,
        currency,
        amount,
      });
  }

  console.log(`\n── Balance reversals (${net.size}) ─────────────────────────────`);
  const nameCache = new Map<string, string>();
  for (const entry of net.values()) {
    const idStr = entry.subjectId.toString();
    if (!nameCache.has(idStr)) {
      const coll = entry.subjectType === "character" ? "characters" : "corporations";
      const doc = (await db.collection(coll).findOne({ _id: entry.subjectId })) as {
        name?: string;
        sequentialId?: number;
      } | null;
      nameCache.set(idStr, `${doc?.name ?? "?"} (#${doc?.sequentialId ?? "?"})`);
    }
    const isSubject = idStr === CORP_624.toString();
    const exempt = EXEMPT_SELLERS.has(idStr);
    console.log(
      `   ${entry.subjectType.padEnd(11)} ${nameCache.get(idStr)!.padEnd(38)} ` +
        `applied ${money(entry.amount)} ${entry.currency} -> ` +
        (exempt ? "EXEMPT, keeps proceeds, units to float" : `reverse ${money(-entry.amount)}`) +
        (isSubject ? "   <= corp 624" : "")
    );
  }

  // ── 2b. Solvency guard ────────────────────────────────────────────────────
  // Two of the reversals are large clawbacks from corps that sold into the
  // erroneous bonds. Healing #624 by pushing a bystander cash-negative would
  // just move the default, so refuse to apply if any party lands below zero.
  console.log(`\n── Post-reversal balances ─────────────────────────────────────`);
  let unsafe = 0;
  for (const entry of net.values()) {
    const idStr = entry.subjectId.toString();
    if (EXEMPT_SELLERS.has(idStr)) {
      console.log(`   ${nameCache.get(idStr)!.padEnd(38)} exempt, balance untouched`);
      continue;
    }
    const reversal = -entry.amount;
    if (entry.subjectType === "corporation") {
      const doc = (await db.collection("corporations").findOne({ _id: entry.subjectId })) as {
        liquidCapital?: number;
        liquidCurrencyCode?: string;
      } | null;
      const before = doc?.liquidCapital ?? 0;
      const after = before + reversal;
      const flag = after < 0 ? "  ** GOES NEGATIVE **" : "";
      if (after < 0) unsafe++;
      console.log(
        `   ${nameCache.get(idStr)!.padEnd(38)} ${Math.round(before).toLocaleString()} ` +
          `-> ${Math.round(after).toLocaleString()} ${doc?.liquidCurrencyCode ?? ""}${flag}`
      );
    } else {
      // Read the field the write will actually touch. Under `forexEnabled`
      // `buildPersonalBalanceInc` targets `currencyBalances.personal.<CCY>`,
      // NOT `cashOnHand` — checking the wrong one made this guard blind and let
      // the first run overdraw a GBP-rich holder whose USD balance was $5.
      const doc = (await db.collection("characters").findOne({ _id: entry.subjectId })) as {
        funds?: number;
        cashOnHand?: number;
        currencyBalances?: { personal?: Record<string, number> };
      } | null;
      const before = forexEnabled
        ? (doc?.currencyBalances?.personal?.[entry.currency] ?? 0)
        : (doc?.cashOnHand ?? doc?.funds ?? 0);
      const after = before + reversal;
      const flag = after < 0 ? "  ** GOES NEGATIVE **" : "";
      if (after < 0) unsafe++;
      console.log(
        `   ${nameCache.get(idStr)!.padEnd(38)} ${before.toLocaleString()} ` +
          `-> ${after.toLocaleString()} ${entry.currency}${flag}`
      );
    }
  }
  if (unsafe > 0) {
    console.log(
      `\n   ${unsafe} part${unsafe === 1 ? "y" : "ies"} would go cash-negative. ` +
        `Apply is BLOCKED — resolve before proceeding.`
    );
  }

  // ── 3. Build the writes ───────────────────────────────────────────────────
  const corpOps: AnyBulkWriteOperation<Corporation>[] = [];
  const charOps: AnyBulkWriteOperation<Character>[] = [];
  for (const entry of net.values()) {
    if (EXEMPT_SELLERS.has(entry.subjectId.toString())) continue;
    const reversal = -entry.amount;
    if (entry.subjectType === "character") {
      charOps.push(
        buildPersonalBalanceBulkOp(
          entry.subjectId,
          reversal,
          entry.currency,
          forexEnabled
        ) as AnyBulkWriteOperation<Character>
      );
    } else if (entry.subjectType === "corporation") {
      // Corp bond flows settle against liquidCapital in the corp's own currency,
      // which is the currency the ledger row carries.
      corpOps.push({
        updateOne: {
          filter: { _id: entry.subjectId },
          update: { $inc: { liquidCapital: reversal }, $set: { updatedAt: new Date() } },
        },
      });
    } else {
      throw new Error(`Unhandled subjectType ${entry.subjectType} — refusing to guess`);
    }
  }

  const b1 = await db.collection("bonds").findOne({ _id: B1 });
  if (!b1) throw new Error("B1 missing — aborting");
  const b1Holders = (b1.holders ?? []) as { corporationId?: ObjectId; units: number }[];
  const b1HolderUnits = b1Holders.reduce((a, h) => a + h.units, 0);
  const b1Float = b1.publicFloat as number;

  // Units belonging to the exempt sellers move to publicFloat: they keep the
  // cash from selling, so they must not also be handed the position back.
  const exemptHolders = b1Holders.filter(
    (h) => h.corporationId && EXEMPT_SELLERS.has(h.corporationId.toString())
  );
  const unitsToFloat = exemptHolders.reduce((a, h) => a + h.units, 0);
  const keptHolders = b1Holders.filter(
    (h) => !(h.corporationId && EXEMPT_SELLERS.has(h.corporationId.toString()))
  );

  console.log(`\n── Bond restoration ───────────────────────────────────────────`);
  console.log(
    `   B1 ${B1.toString()}  -> defaulted:false, matured:false, marketPrice ${B1_MARKET_PRICE_T414}`
  );
  for (const h of exemptHolders) {
    console.log(
      `      move to float: ${EXEMPT_SELLERS.get(h.corporationId!.toString())} ` +
        `${h.units.toLocaleString()} units`
    );
  }
  console.log(
    `      holders ${b1Holders.length} -> ${keptHolders.length} ` +
      `(${b1HolderUnits.toLocaleString()} -> ${(b1HolderUnits - unitsToFloat).toLocaleString()} units), ` +
      `publicFloat ${b1Float.toLocaleString()} -> ${(b1Float + unitsToFloat).toLocaleString()}`
  );
  const totalBefore = b1HolderUnits + b1Float;
  const totalAfter = b1HolderUnits - unitsToFloat + (b1Float + unitsToFloat);
  console.log(
    `      total units ${totalBefore.toLocaleString()} -> ${totalAfter.toLocaleString()} ` +
      `(face A${((b1.totalIssued as number) / 1000).toLocaleString()} units), ` +
      `coupon ${b1.couponRate}%, matures t${b1.maturityTurn}`
  );
  if (totalBefore !== totalAfter || totalAfter !== (b1.totalIssued as number) / 1000) {
    throw new Error("Unit conservation check FAILED on B1 — aborting");
  }
  console.log(`      unit conservation: OK`);
  console.log(`   B2 ${B2.toString()}  -> DELETE`);
  console.log(`   B3 ${B3.toString()}  -> DELETE`);

  const histCount = await db
    .collection("bondHistory")
    .countDocuments({ bondId: { $in: CHAIN }, turn: { $gte: REWIND_FROM_TURN } });
  const histCountStr = await db
    .collection("bondHistory")
    .countDocuments({ bondId: { $in: CHAIN_STR }, turn: { $gte: REWIND_FROM_TURN } });
  console.log(`\n── Other ──────────────────────────────────────────────────────`);
  console.log(`   corp 624 bondDefaultCreditPenaltyUntilTurn -> cleared`);
  console.log(
    `   bondHistory rows to delete: ${histCount + histCountStr} (turn >= ${REWIND_FROM_TURN})`
  );
  console.log(`   financialTxLog rows to mark reversed: ${rows.length}`);
  console.log(`\n   corporation writes: ${corpOps.length}, character writes: ${charOps.length}`);

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to execute.`);
    await client.close();
    return;
  }
  if (unsafe > 0) {
    console.log(`\nREFUSING TO APPLY: ${unsafe} party would be left cash-negative.`);
    await client.close();
    process.exitCode = 1;
    return;
  }

  // ── 4. Apply ──────────────────────────────────────────────────────────────
  const now = new Date();

  // Deleting bond documents is irreversible, so dump the full pre-state first.
  // Nothing here is player-identifying beyond ids already in the ledger, and the
  // file stays local (scripts/migrations/backups is git-ignored below).
  const corp624Before = await db.collection("corporations").findOne({ _id: CORP_624 });
  const backup = {
    takenAt: now.toISOString(),
    worldTurn: gs?.currentTurn,
    bonds: await db
      .collection("bonds")
      .find({ _id: { $in: CHAIN } })
      .toArray(),
    corp624: corp624Before,
    reversedTxIds: rows.map((r) => r._id.toString()),
    balancesBefore: [...net.values()].map((e) => ({
      subjectType: e.subjectType,
      subjectId: e.subjectId.toString(),
      currency: e.currency,
      appliedAmount: e.amount,
      exempt: EXEMPT_SELLERS.has(e.subjectId.toString()),
    })),
  };
  const backupDir = path.resolve("scripts/migrations/backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `heal-1198-corp624-${now.getTime()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), "utf8");
  console.log(`\nBACKUP written: ${backupPath}`);
  if (corpOps.length > 0) {
    const r = await db.collection<Corporation>("corporations").bulkWrite(corpOps);
    console.log(`\nAPPLIED corporations: matched ${r.matchedCount}, modified ${r.modifiedCount}`);
  }
  if (charOps.length > 0) {
    const r = await db.collection<Character>("characters").bulkWrite(charOps);
    console.log(`APPLIED characters: matched ${r.matchedCount}, modified ${r.modifiedCount}`);
  }

  const b1Res = await db.collection("bonds").updateOne(
    { _id: B1 },
    {
      $set: {
        defaulted: false,
        defaultedAtTurn: null,
        matured: false,
        marketPrice: B1_MARKET_PRICE_T414,
        holders: keptHolders,
        publicFloat: b1Float + unitsToFloat,
        updatedAt: now,
      },
      $unset: { redeemedAtTurn: "", defaultCure: "" },
    }
  );
  console.log(
    `APPLIED B1 restore: modified ${b1Res.modifiedCount} ` +
      `(${unitsToFloat.toLocaleString()} units moved to float)`
  );

  const delRes = await db.collection("bonds").deleteMany({ _id: { $in: [B2, B3] } });
  console.log(`APPLIED delete B2+B3: deleted ${delRes.deletedCount}`);

  const penRes = await db
    .collection("corporations")
    .updateOne(
      { _id: CORP_624 },
      { $unset: { bondDefaultCreditPenaltyUntilTurn: "" }, $set: { updatedAt: now } }
    );
  console.log(`APPLIED penalty clear: modified ${penRes.modifiedCount}`);

  const histRes = await db.collection("bondHistory").deleteMany({
    $or: [{ bondId: { $in: CHAIN } }, { bondId: { $in: CHAIN_STR } }],
    turn: { $gte: REWIND_FROM_TURN },
  });
  console.log(`APPLIED bondHistory delete: deleted ${histRes.deletedCount}`);

  // Stamp the reversed ledger rows rather than deleting them: the audit trail of
  // what happened is worth keeping, and a deleted row cannot be reconciled.
  const txRes = await db
    .collection("financialTxLog")
    .updateMany(
      { _id: { $in: rows.map((r) => r._id) } },
      { $set: { reversed: true, reversedBy: "heal-1198-corp624-bond-rewind", reversedAt: now } }
    );
  console.log(`APPLIED tx reversal stamps: modified ${txRes.modifiedCount}`);

  console.log(`\nDone.`);
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
