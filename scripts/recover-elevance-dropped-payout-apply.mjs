/**
 * APPLY script for bug #0540 (corp dissolution payout) — Elevance Health
 * compensation.
 *
 * Mirrors `recover-elevance-dropped-payout-dryrun.mjs` exactly, but performs
 * the writes. Run with `--confirm` to actually mutate; without `--confirm`
 * it prints what it WOULD do and exits.
 *
 *   node scripts/recover-elevance-dropped-payout-apply.mjs           # dry print
 *   node scripts/recover-elevance-dropped-payout-apply.mjs --confirm # mutate
 *
 * Writes performed (per beneficiary):
 *   1. corporations.updateOne({_id}, {$inc: {liquidCapital: payoutLocal}})
 *   2. financialTxLog insertOne — corp_dissolution_distribution row tagged
 *      with meta.bugFixCompensation = "0540" so admin reconcile queries can
 *      identify the back-pay.
 *
 * FX rate semantics: each currency's rate is taken from
 * `exchangeRates.rateHistory` AT the snapshot turn (877). This is the
 * "what was owed at the time" framing chosen during scoping.
 */

import fs from "node:fs";
import path from "node:path";
import { MongoClient, ObjectId } from "mongodb";

const CORP_ID = "6a0237c3996f80915281c64d"; // Elevance Health
const ENV_PATH = path.join(process.cwd(), ".env.local");
const CONFIRM = process.argv.includes("--confirm");

const env = fs.readFileSync(ENV_PATH, "utf8");
const uriMatch = env.match(/MONGODB_URI=(.+)/);
if (!uriMatch) {
  console.error("MONGODB_URI not found in .env.local");
  process.exit(1);
}
const uri = uriMatch[1].trim().replace(/^["']|["']$/g, "");
const client = new MongoClient(uri);

async function main() {
  console.log(CONFIRM ? "MODE: APPLY (will mutate)" : "MODE: DRY RUN (no writes)");
  await client.connect();
  const db = client.db("a-house-divided");
  const corpId = new ObjectId(CORP_ID);

  // Idempotency: refuse to re-apply if any compensation row already exists.
  const existingComp = await db.collection("financialTxLog").findOne({
    "meta.bugFixCompensation": "0540",
  });
  if (existingComp && CONFIRM) {
    console.error(
      "ABORT: a row tagged meta.bugFixCompensation='0540' already exists. Compensation already applied; refusing to double-pay."
    );
    console.error(
      "  existing txId:",
      existingComp._id.toString(),
      "createdAt:",
      existingComp.createdAt
    );
    await client.close();
    process.exit(1);
  }

  // 1. Source of truth: dissolution tx.
  const bondDefaultTx = await db.collection("financialTxLog").findOne({
    type: "bond_default",
    subjectId: corpId,
  });
  if (!bondDefaultTx) {
    console.error("No bond_default tx found for", CORP_ID);
    process.exit(1);
  }
  const shareholderPoolAnchor = bondDefaultTx.meta?.shareholderPoolAnchor;
  if (typeof shareholderPoolAnchor !== "number") {
    console.error("bond_default tx missing meta.shareholderPoolAnchor");
    process.exit(1);
  }

  // 2. Cap table at dissolution.
  const [snap] = await db
    .collection("corporationHistory")
    .find({ corporationId: corpId })
    .sort({ turn: -1 })
    .limit(1)
    .toArray();
  if (!snap) {
    console.error("No corporationHistory snapshot for", CORP_ID);
    process.exit(1);
  }
  const totalShares = snap.totalShares;
  const snapshotTurn = snap.turn;

  // 3. Dissolution-time FX from rateHistory.
  const fxDocs = await db.collection("exchangeRates").find({}).toArray();
  const fxByCurrency = new Map();
  for (const f of fxDocs) {
    if (!f.currencyCode) continue;
    const hist = Array.isArray(f.rateHistory) ? f.rateHistory : [];
    const candidatesAtOrBefore = hist.filter((h) => h.turn <= snapshotTurn);
    const chosen =
      candidatesAtOrBefore.length > 0
        ? candidatesAtOrBefore[candidatesAtOrBefore.length - 1]
        : hist.length > 0
          ? hist[0]
          : null;
    fxByCurrency.set(f.currencyCode, chosen?.rate ?? f.rate ?? 1);
  }

  // 4. Reproduce allocation.
  const corporationRows = [];
  for (const sh of snap.shareholders ?? []) {
    if (!sh.corporationId || sh.shares <= 0) continue;
    const payoutAnchor = Math.floor((shareholderPoolAnchor * sh.shares) / totalShares);
    corporationRows.push({
      id: sh.corporationId.toString(),
      shares: sh.shares,
      payoutAnchor,
    });
  }

  // 5. Lookup beneficiaries.
  const corpIds = corporationRows.map((r) => new ObjectId(r.id));
  const beneficiaryCorps =
    corpIds.length > 0
      ? await db
          .collection("corporations")
          .find({ _id: { $in: corpIds } })
          .project({
            _id: 1,
            name: 1,
            sequentialId: 1,
            countryId: 1,
            liquidCurrencyCode: 1,
            liquidCapital: 1,
          })
          .toArray()
      : [];
  const corpById = new Map(beneficiaryCorps.map((c) => [c._id.toString(), c]));

  // 6. Get current game turn for the compensation tx rows.
  const gameState = await db.collection("gameState").findOne({ _id: "current" });
  const currentTurn = gameState?.currentTurn ?? snapshotTurn;
  const now = new Date();

  // 7. Apply or print.
  console.log("\n──────────── COMPENSATION PLAN ────────────");
  console.log(`  snapshotTurn=${snapshotTurn}  currentTurn=${currentTurn}`);
  let appliedCount = 0;
  for (const row of corporationRows) {
    const corp = corpById.get(row.id);
    if (!corp) {
      console.log(`  [SKIP] corp ${row.id} not found in corporations collection`);
      continue;
    }
    const currency = corp.liquidCurrencyCode ?? "USD";
    const rate = fxByCurrency.get(currency) ?? 1;
    const payoutLocal = row.payoutAnchor * rate;
    const payoutLocalRounded = Math.round(payoutLocal * 100) / 100;

    console.log(`\n  ${corp.name} (seq ${corp.sequentialId}, ${corp.countryId}/${currency})`);
    console.log(`    shares:            ${row.shares.toLocaleString()}`);
    console.log(`    anchor payout:     ${row.payoutAnchor.toLocaleString()}`);
    console.log(
      `    local payout:      ${payoutLocalRounded.toLocaleString()} ${currency}  (rate ${rate.toFixed(4)})`
    );
    console.log(`    current LC:        ${corp.liquidCapital.toLocaleString()} ${currency}`);
    console.log(
      `    post-comp LC:      ${(corp.liquidCapital + payoutLocal).toLocaleString()} ${currency}`
    );

    if (!CONFIRM) continue;

    // $inc liquidCapital
    await db
      .collection("corporations")
      .updateOne(
        { _id: corp._id },
        { $inc: { liquidCapital: payoutLocalRounded }, $set: { updatedAt: now } }
      );

    // Ledger row — tagged for forensic identification.
    await db.collection("financialTxLog").insertOne({
      _id: new ObjectId(),
      type: "corp_dissolution_distribution",
      turn: currentTurn,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
      subjectType: "corporation",
      subjectId: corp._id,
      subjectName: corp.name,
      amount: payoutLocalRounded,
      currencyCode: currency,
      counterpartyType: "corporation",
      counterpartyId: corpId,
      counterpartyName: "Elevance Health (dissolved)",
      meta: {
        side: "shareholder",
        finalDissolution: true,
        sharePayAnchor: row.payoutAnchor,
        bugFixCompensation: "0540",
        originalDissolutionTxId: bondDefaultTx._id.toString(),
        snapshotTurn,
        fxRateUsed: rate,
        fxRateSourceTurn: snapshotTurn,
      },
    });

    appliedCount += 1;
    console.log(`    ✓ written`);
  }

  if (!CONFIRM) {
    console.log("\n──────────── DRY RUN — NO WRITES ────────────");
    console.log("  Re-run with --confirm to apply.");
  } else {
    console.log(`\n──────────── APPLY COMPLETE — ${appliedCount} corp(s) credited ────────────`);
  }

  await client.close();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await client.close();
  } catch {}
  process.exit(1);
});
