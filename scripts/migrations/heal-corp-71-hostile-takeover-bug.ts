/**
 * Heal Corp 71 (Her Majesty's Arsenal) after the hostile-takeover cash-transfer bug.
 *
 * Background
 * ----------
 * At the turn-261 / turn-262 boundary (2026-04-21 ~22:00–23:00 UTC), the CEO of
 * Corp 71 bought Bank of America (BoA, corpId `69db946d25d20abe759e73cd`) and then
 * absorbed it via /api/corporations/[id]/hostile-takeover. BoA had
 * `liquidCapital = -851,074,764 USD` at the time of the merger. The takeover
 * route's "target cash → parent cash" transfer has no clamp for negative target
 * cash, so the $inc applied a negative delta to Corp 71's liquidCapital
 * (`cashToParentLocal = target.liquidCapital / USD_FX × JPY_FX`, ≈ -113B JPY), on
 * top of whatever Corp 71 paid for BoA shares.
 *
 * Observed impact
 *   - Corp 71 liquidCapital jumped from +78,009,228,690 JPY (turn 261 snapshot)
 *     to -63,572,099,323 JPY at the start of turn 262.
 *   - Exact bug delta: -141,581,328,013 JPY. This bundles:
 *       (a) the negative cash-transfer from the insolvent target,
 *       (b) the BoA share purchase Corp 71 made right before,
 *       (c) any other user activity in that hour (should be none).
 *   - Three Corp 71-issued bonds tripped into default at turn 262 bondTurn
 *     Phase 3 because liquidCapital < 0. These are collateral damage.
 *
 * Heal actions (performed atomically per-doc; no transaction)
 *   1. Corp 71: $inc liquidCapital by +141,581,328,013 JPY, and $unset
 *      bondDefaultCreditPenaltyUntilTurn.
 *   2. Three defaulted bonds: reset `defaulted=false, defaultedAtTurn=null,
 *      marketPrice=<pre-default value from turn 261 bondHistory>`.
 *   3. Bond history: delete the turn ≥ 262 rows for those bonds (they carry the
 *      marketPrice=0.1 snapshots and would mislead charts). The next bondTurn
 *      will re-populate correctly.
 *   4. Wire event "DEBT WATCH: Her Majesty's Arsenal now rated BBB (was AAA)" —
 *      delete; the downgrade was a direct consequence of the invalid state.
 *
 * Safety guards — abort if any invariant drifts from the captured evidence.
 *
 * Run:
 *   npx tsx scripts/migrations/heal-corp-71-hostile-takeover-bug.ts           # dry run
 *   npx tsx scripts/migrations/heal-corp-71-hostile-takeover-bug.ts --execute # apply
 */
import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const uri = process.env.MONGODB_URI_LIVE;
if (!uri) {
  console.error("MONGODB_URI_LIVE not set");
  process.exit(1);
}

// Evidence captured during investigation (2026-04-21 ~23:10 UTC, turn 262+)
const CORP_71_OID = "69dc09d2b8a6552ea0317cac";
const BOA_OID = "69db946d25d20abe759e73cd"; // already deleted by takeover
const EXPECTED_CORP_SEQUENTIAL_ID = 71;
const EXPECTED_CORP_NAME = "Her Majesty's Arsenal";
const EXPECTED_CORP_COUNTRY = "JP";
const EXPECTED_CORP_LIQUID_CURRENCY = "JPY";

/**
 * Corp 71 liquidCapital at end-of-turn-261 snapshot (before the exploit):
 *   +78,009,228,690 JPY
 * Start-of-turn-262 DB value (after exploit):
 *   -63,572,099,323 JPY
 * Delta to restore = 141,581,328,013 JPY.
 *
 * This heal applies the delta as an $inc to the *current* liquidCapital, so
 * post-heal the corp sits at (current + delta) ≈ turn-261-snapshot + any
 * legitimate income that landed in turns 262-263. Intended outcome.
 */
const HEAL_LIQUID_CAPITAL_DELTA_JPY = 141_581_328_013;

/** Expected current liquidCapital bounds — abort if outside this window. */
const EXPECTED_CURRENT_LIQ_MIN = -65_000_000_000;
const EXPECTED_CURRENT_LIQ_MAX = -63_000_000_000;

/** Pre-default bond states from turn-261 bondHistory. */
const BOND_RESTORES: Array<{ bondId: string; marketPrice: number; totalIssued: number }> = [
  { bondId: "69de4a9c70dcc18e49da784c", marketPrice: 0.9255, totalIssued: 340_000 },
  { bondId: "69e21d897ad2994fdf3a2b02", marketPrice: 0.8047, totalIssued: 4_427_000 },
  { bondId: "69e4c50fc79f3a93f1634f38", marketPrice: 0.788, totalIssued: 110_000 },
];

const EXPECTED_DEFAULT_TURN = 262;
const WIRE_EVENT_IDS_TO_DELETE = [
  // DEBT WATCH: Her Majesty's Arsenal now rated BBB (was AAA)
  "69e8018c6414c9c0f9bb2522",
];

async function main() {
  const execute = process.argv.includes("--execute");
  const client = new MongoClient(uri!);
  await client.connect();
  const db = client.db("a-house-divided");

  const corpOid = new ObjectId(CORP_71_OID);

  // ─── Step 0: Safety guards ────────────────────────────────────────────────

  const corp = await db.collection("corporations").findOne({ _id: corpOid });
  if (!corp) {
    console.error(`Corp 71 (_id=${CORP_71_OID}) not found — aborting`);
    await client.close();
    process.exit(1);
  }
  if (corp.sequentialId !== EXPECTED_CORP_SEQUENTIAL_ID) {
    console.error(
      `sequentialId drift: expected ${EXPECTED_CORP_SEQUENTIAL_ID}, got ${corp.sequentialId} — aborting`
    );
    await client.close();
    process.exit(1);
  }
  if (corp.name !== EXPECTED_CORP_NAME) {
    console.error(`name drift: expected "${EXPECTED_CORP_NAME}", got "${corp.name}" — aborting`);
    await client.close();
    process.exit(1);
  }
  if (corp.countryId !== EXPECTED_CORP_COUNTRY) {
    console.error(
      `countryId drift: expected ${EXPECTED_CORP_COUNTRY}, got ${corp.countryId} — aborting`
    );
    await client.close();
    process.exit(1);
  }
  if (corp.liquidCurrencyCode !== EXPECTED_CORP_LIQUID_CURRENCY) {
    console.error(
      `liquidCurrencyCode drift: expected ${EXPECTED_CORP_LIQUID_CURRENCY}, got ${corp.liquidCurrencyCode} — aborting`
    );
    await client.close();
    process.exit(1);
  }
  const currentLiq = corp.liquidCapital ?? 0;
  if (currentLiq >= 0) {
    console.error(
      `Corp 71 liquidCapital is already non-negative (${currentLiq}). Heal already applied or state drifted — aborting.`
    );
    await client.close();
    process.exit(1);
  }
  if (currentLiq < EXPECTED_CURRENT_LIQ_MIN || currentLiq > EXPECTED_CURRENT_LIQ_MAX) {
    console.error(
      `Corp 71 liquidCapital ${currentLiq} outside expected window [${EXPECTED_CURRENT_LIQ_MIN}, ${EXPECTED_CURRENT_LIQ_MAX}] — aborting (state drifted, re-investigate before healing)`
    );
    await client.close();
    process.exit(1);
  }

  // Confirm BoA is deleted (sanity)
  const boa = await db.collection("corporations").findOne({ _id: new ObjectId(BOA_OID) });
  if (boa) {
    console.error(
      `Unexpected: BoA (_id=${BOA_OID}) still exists — state is inconsistent with our investigation, aborting`
    );
    await client.close();
    process.exit(1);
  }

  // Confirm bonds are in the expected defaulted state
  const bondDocs = await db
    .collection("bonds")
    .find({ _id: { $in: BOND_RESTORES.map((b) => new ObjectId(b.bondId)) } })
    .toArray();
  if (bondDocs.length !== BOND_RESTORES.length) {
    console.error(`Expected ${BOND_RESTORES.length} bonds, found ${bondDocs.length} — aborting`);
    await client.close();
    process.exit(1);
  }
  for (const bond of bondDocs) {
    if (!bond.corporationId?.equals(corpOid)) {
      console.error(
        `Bond ${bond._id} issuer drift (corporationId=${bond.corporationId}), aborting`
      );
      await client.close();
      process.exit(1);
    }
    if (bond.defaulted !== true) {
      console.error(
        `Bond ${bond._id} is not marked defaulted — aborting (state drifted or already healed)`
      );
      await client.close();
      process.exit(1);
    }
    if (bond.defaultedAtTurn !== EXPECTED_DEFAULT_TURN) {
      console.error(
        `Bond ${bond._id} defaultedAtTurn=${bond.defaultedAtTurn}, expected ${EXPECTED_DEFAULT_TURN} — aborting`
      );
      await client.close();
      process.exit(1);
    }
  }

  // ─── Step 1: Print intended operations ────────────────────────────────────

  console.log("=== BEFORE ===");
  console.log(`Corp 71  #${corp.sequentialId} ${corp.name}`);
  console.log(`  liquidCapital: ${currentLiq}  JPY`);
  console.log(`  bondDefaultCreditPenaltyUntilTurn: ${corp.bondDefaultCreditPenaltyUntilTurn}`);
  console.log(`  sharePrice: ${corp.sharePrice}`);
  console.log(
    `  (post-heal liquidCapital will be ≈ ${currentLiq + HEAL_LIQUID_CAPITAL_DELTA_JPY} JPY)`
  );

  console.log("\n--- defaulted bonds ---");
  for (const b of bondDocs) {
    const restore = BOND_RESTORES.find((r) => r.bondId === b._id.toString())!;
    console.log(
      `  bond ${b._id}: defaulted=${b.defaulted} marketPrice=${b.marketPrice} → defaulted=false marketPrice=${restore.marketPrice}`
    );
  }

  const bondIds = BOND_RESTORES.map((b) => new ObjectId(b.bondId));
  const postBondHistoryCount = await db
    .collection("bondHistory")
    .countDocuments({ bondId: { $in: bondIds }, turn: { $gte: EXPECTED_DEFAULT_TURN } });
  console.log(
    `\nbondHistory rows turn >= ${EXPECTED_DEFAULT_TURN} for 3 bonds (will delete): ${postBondHistoryCount}`
  );

  const wireCountBefore = await db
    .collection("wireEvents")
    .countDocuments({ _id: { $in: WIRE_EVENT_IDS_TO_DELETE.map((id) => new ObjectId(id)) } });
  console.log(
    `wireEvents to delete (DEBT WATCH / other consequences): ${wireCountBefore} of ${WIRE_EVENT_IDS_TO_DELETE.length} listed`
  );

  if (!execute) {
    console.log("\nDRY RUN — pass --execute to apply.");
    await client.close();
    return;
  }

  // ─── Step 2: Execute heal ─────────────────────────────────────────────────

  const now = new Date();

  // 2a. Corp 71: $inc liquidCapital and $unset penalty.
  const corpResult = await db.collection("corporations").updateOne(
    {
      _id: corpOid,
      sequentialId: EXPECTED_CORP_SEQUENTIAL_ID,
      // Guard against a concurrent update that moves liquidCapital away from
      // the negative window — the heal should only apply when the corp is
      // still in the compromised state we measured.
      liquidCapital: { $gte: EXPECTED_CURRENT_LIQ_MIN, $lte: EXPECTED_CURRENT_LIQ_MAX },
    },
    {
      $inc: { liquidCapital: HEAL_LIQUID_CAPITAL_DELTA_JPY },
      $unset: { bondDefaultCreditPenaltyUntilTurn: "" },
      $set: { updatedAt: now },
    }
  );
  if (corpResult.modifiedCount !== 1) {
    console.error(
      `Corp 71 update failed: matchedCount=${corpResult.matchedCount} modifiedCount=${corpResult.modifiedCount} — state drifted during run, aborting`
    );
    await client.close();
    process.exit(1);
  }

  // 2b. Restore the three defaulted bonds.
  const bondOps = BOND_RESTORES.map((r) => ({
    updateOne: {
      filter: {
        _id: new ObjectId(r.bondId),
        defaulted: true,
        defaultedAtTurn: EXPECTED_DEFAULT_TURN,
      },
      update: {
        $set: { defaulted: false, marketPrice: r.marketPrice, updatedAt: now },
        $unset: { defaultedAtTurn: "" },
      },
    },
  }));
  const bondResult = await db.collection("bonds").bulkWrite(bondOps);
  if (bondResult.modifiedCount !== BOND_RESTORES.length) {
    console.error(
      `Bond restore only modified ${bondResult.modifiedCount}/${BOND_RESTORES.length} — investigate, may need manual cleanup`
    );
  }

  // 2c. Purge contaminated post-default bondHistory. Next turn will repopulate.
  const histDelete = await db
    .collection("bondHistory")
    .deleteMany({ bondId: { $in: bondIds }, turn: { $gte: EXPECTED_DEFAULT_TURN } });

  // 2d. Delete the erroneous DEBT WATCH wire event.
  const wireDelete = await db
    .collection("wireEvents")
    .deleteMany({ _id: { $in: WIRE_EVENT_IDS_TO_DELETE.map((id) => new ObjectId(id)) } });

  // ─── Step 3: Report ───────────────────────────────────────────────────────

  const after = await db.collection("corporations").findOne({ _id: corpOid });
  console.log("\n=== AFTER ===");
  console.log(`Corp 71 liquidCapital: ${after?.liquidCapital} JPY`);
  console.log(
    `Corp 71 bondDefaultCreditPenaltyUntilTurn: ${after?.bondDefaultCreditPenaltyUntilTurn ?? "(unset)"}`
  );
  console.log(`Bond restore: modified ${bondResult.modifiedCount}/${BOND_RESTORES.length}`);
  console.log(`bondHistory rows deleted: ${histDelete.deletedCount}`);
  console.log(`wireEvents rows deleted: ${wireDelete.deletedCount}`);

  const healedBonds = await db
    .collection("bonds")
    .find({ _id: { $in: bondIds } })
    .toArray();
  console.log("\n--- bonds post-heal ---");
  for (const b of healedBonds) {
    console.log(
      `  bondId=${b._id} defaulted=${b.defaulted} defaultedAtTurn=${b.defaultedAtTurn ?? "(unset)"} marketPrice=${b.marketPrice}`
    );
  }

  console.log(
    "\nHeal complete. Monitor next turn (≥264): bondTurn should NOT re-default these bonds now that liquidCapital > 0."
  );

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
