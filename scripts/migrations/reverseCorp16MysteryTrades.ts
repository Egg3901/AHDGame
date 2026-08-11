/**
 * One-shot correction for Corp 16 (AURORA Group):
 *   1. Refund every non-CEO shareholder in their home currency at 1.25× the
 *      share's ₳ notional (₳-stored avgCostPerShare, with Melania's legacy
 *      entry priced at the current sharePrice per operator direction).
 *   2. Pull all 7 non-CEO shareholder entries.
 *   3. Return all 93 shares to the CEO (KIMI ANTONELLI).
 *   4. Clear `lastShareIssuance` so the 24h cooldown doesn't block a fresh
 *      future issuance.
 *
 * Per operator direction (2026-04-21): Share History starts empty; no
 * backfill, and this migration must not emit `shareTradeHistory` rows for
 * the reversal itself. Only the wallet/capital credits and shareholder
 * array mutations are written.
 *
 * Invariants verified before any write:
 *   - Corp has sequentialId 16 and _id matches the known fingerprint.
 *   - `ceoId` matches KIMI (fingerprinted).
 *   - `totalShares` === 1,000,000, `publicFloat` === 0.
 *   - `shareholders.length` === 8, with the exact 7 non-CEO ids we plan to pull.
 *   - Sum of non-CEO shares === 93.
 *
 * If any invariant fails, the script aborts without writing.
 *
 * Target DB: MONGODB_URI_LIVE in .env.local.
 *
 * Usage:
 *   npx tsx scripts/migrations/reverseCorp16MysteryTrades.ts             # dry-run
 *   npx tsx scripts/migrations/reverseCorp16MysteryTrades.ts --apply     # writes
 */

import { MongoClient, Db, ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type { Corporation, Character, GameState, ExchangeRate } from "../../src/lib/db/types";
import { buildPersonalBalanceInc, getHomeCurrency } from "../../src/lib/currency/characterFunds";
import {
  anchorToCorpLiquidCapital,
  resolveCorpLiquidCurrencyCode,
} from "../../src/lib/currency/corporationCapital";
import type { CurrencyCode } from "../../src/lib/constants/currencies";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const apply = process.argv.includes("--apply");
const uri = process.env.MONGODB_URI_LIVE;
if (!uri) {
  console.error("MONGODB_URI_LIVE missing — set it in .env.local");
  process.exit(1);
}

// ── Fingerprint / expected state ─────────────────────────────────────────
const CORP_SEQUENTIAL_ID = 16;
const EXPECTED_CORP_ID = "69dac17ee2f9bde884696bbe";
const EXPECTED_CEO_ID = "69d9cf8dca8502934e6d5726"; // KIMI ANTONELLI
const EXPECTED_TOTAL_SHARES = 1_000_000;
const EXPECTED_PUBLIC_FLOAT = 0;
const EXPECTED_NON_CEO_SHARE_SUM = 93;
const BONUS_MULTIPLIER = 1.25; // 25% goodwill bonus per operator direction

// Refund targets. `priceOverrideAnchor` is used when a shareholder entry has
// no recorded avgCostPerShare (Melania's legacy pre-tracking entry): per
// operator direction, price her 33 shares at the current corp.sharePrice.
interface RefundPlan {
  kind: "character" | "corporation";
  id: string;
  expectedShares: number;
  priceOverrideAnchor?: number; // current sharePrice for Melania; others use stored avgCost
  label: string;
}

// Share-count expectations anchor the fingerprint check. Prices for 6 of 7
// are read live from the shareholder entries so we refund exactly what they
// paid. Melania's legacy entry has no stored price — use current sharePrice.
const REFUND_PLAN: RefundPlan[] = [
  { kind: "character", id: "69e10b514e156f6ed03dd881", expectedShares: 33, label: "Melania Trump" },
  { kind: "character", id: "69de7ba2400bb2fc8fc9c59d", expectedShares: 10, label: "Kristi Noem" },
  { kind: "character", id: "69e01a8e2fb933942fe95664", expectedShares: 10, label: "Pam Bondi" },
  {
    kind: "character",
    id: "69e10d036a06b9ff6794a2a1",
    expectedShares: 10,
    label: "Marjorie Taylor Greene",
  },
  {
    kind: "corporation",
    id: "69e10c3c96360b02ac890270",
    expectedShares: 10,
    label: "The Trump Organization",
  },
  {
    kind: "corporation",
    id: "69e10f996a06b9ff6794a31b",
    expectedShares: 10,
    label: "Noem Harvesting",
  },
  {
    kind: "corporation",
    id: "69e112096a06b9ff6794a335",
    expectedShares: 10,
    label: "Anti-Woke Corporation",
  },
];

function fmt(n: number, digits = 2): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  const db: Db = client.db("a-house-divided");
  console.log(`Connected. Mode = ${apply ? "APPLY (writes)" : "DRY-RUN"}`);

  // 1. Load corp and fingerprint-check.
  const corp = await db
    .collection<Corporation>("corporations")
    .findOne({ sequentialId: CORP_SEQUENTIAL_ID });
  if (!corp) {
    console.error(`No corporation found with sequentialId ${CORP_SEQUENTIAL_ID}`);
    process.exit(1);
  }

  const failures: string[] = [];
  if (corp._id.toString() !== EXPECTED_CORP_ID) {
    failures.push(`corp._id mismatch: got ${corp._id.toString()}, expected ${EXPECTED_CORP_ID}`);
  }
  if (corp.ceoId?.toString() !== EXPECTED_CEO_ID) {
    failures.push(`ceoId mismatch: got ${corp.ceoId?.toString()}, expected ${EXPECTED_CEO_ID}`);
  }
  if (corp.totalShares !== EXPECTED_TOTAL_SHARES) {
    failures.push(
      `totalShares mismatch: got ${corp.totalShares}, expected ${EXPECTED_TOTAL_SHARES}`
    );
  }
  if ((corp.publicFloat ?? 0) !== EXPECTED_PUBLIC_FLOAT) {
    failures.push(
      `publicFloat mismatch: got ${corp.publicFloat}, expected ${EXPECTED_PUBLIC_FLOAT}`
    );
  }
  const shareholders = corp.shareholders ?? [];
  if (shareholders.length !== REFUND_PLAN.length + 1) {
    failures.push(
      `shareholders.length mismatch: got ${shareholders.length}, expected ${REFUND_PLAN.length + 1} (CEO + ${REFUND_PLAN.length} others)`
    );
  }

  // Match each plan entry to an actual shareholder and verify expectedShares.
  const planWithLiveData: (RefundPlan & {
    liveShares: number;
    liveAvgCostAnchor: number | null;
  })[] = [];
  for (const plan of REFUND_PLAN) {
    const targetId = plan.id;
    const entry = shareholders.find((sh) => {
      if (plan.kind === "character") return sh.characterId?.toString() === targetId;
      return sh.corporationId?.toString() === targetId;
    });
    if (!entry) {
      failures.push(`shareholder entry missing for ${plan.label} (${targetId})`);
      continue;
    }
    if (entry.shares !== plan.expectedShares) {
      failures.push(
        `share count mismatch for ${plan.label}: got ${entry.shares}, expected ${plan.expectedShares}`
      );
    }
    planWithLiveData.push({
      ...plan,
      liveShares: entry.shares,
      liveAvgCostAnchor: entry.avgCostPerShare ?? null,
    });
  }

  const nonCeoSum = shareholders
    .filter((sh) => sh.characterId?.toString() !== EXPECTED_CEO_ID)
    .reduce((s, sh) => s + (sh.shares ?? 0), 0);
  if (nonCeoSum !== EXPECTED_NON_CEO_SHARE_SUM) {
    failures.push(
      `non-CEO share sum mismatch: got ${nonCeoSum}, expected ${EXPECTED_NON_CEO_SHARE_SUM}`
    );
  }

  if (failures.length > 0) {
    console.error("\nFingerprint check FAILED — aborting without writes.");
    for (const f of failures) console.error(`  - ${f}`);
    await client.close();
    process.exit(1);
  }
  console.log("\nFingerprint check PASSED.");
  console.log(
    `  corp=${corp.name} (seq=${corp.sequentialId}) totalShares=${corp.totalShares} publicFloat=${corp.publicFloat ?? 0}`
  );
  console.log(`  CEO retains ${shareholders.length - REFUND_PLAN.length} entry × 999,907 shares`);

  // 2. Load game state + USD exchange rate.
  const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  const currentTurn = gameState?.currentTurn ?? 0;
  const forexEnabled = gameState?.forexEnabled === true;

  // 3. Compute refunds.
  const sharePriceNow = corp.sharePrice ?? 0;
  const corpLiquidCurrencyCode = resolveCorpLiquidCurrencyCode(corp) as CurrencyCode | undefined;

  // Collect currencies we need rates for.
  const neededCurrencies = new Set<CurrencyCode>();
  neededCurrencies.add("USD"); // always — Corp 16 is US

  // Pre-fetch character/corp docs for currency resolution + printing.
  const charIds = planWithLiveData
    .filter((p) => p.kind === "character")
    .map((p) => new ObjectId(p.id));
  const corpIds = planWithLiveData
    .filter((p) => p.kind === "corporation")
    .map((p) => new ObjectId(p.id));
  const [charDocs, corpDocs] = await Promise.all([
    charIds.length > 0
      ? db
          .collection<Character>("characters")
          .find({ _id: { $in: charIds } })
          .toArray()
      : Promise.resolve([] as Character[]),
    corpIds.length > 0
      ? db
          .collection<Corporation>("corporations")
          .find({ _id: { $in: corpIds } })
          .toArray()
      : Promise.resolve([] as Corporation[]),
  ]);
  const charById = new Map(charDocs.map((c) => [c._id.toString(), c]));
  const corpById = new Map(corpDocs.map((c) => [c._id.toString(), c]));

  for (const p of planWithLiveData) {
    if (p.kind === "character") {
      const ch = charById.get(p.id);
      if (ch) neededCurrencies.add(getHomeCurrency(ch));
    } else {
      const c = corpById.get(p.id);
      const code = c ? (resolveCorpLiquidCurrencyCode(c) as CurrencyCode | undefined) : undefined;
      if (code) neededCurrencies.add(code);
    }
  }

  const fxByCurrency = new Map<CurrencyCode, number>();
  for (const ccy of neededCurrencies) {
    const doc = await db.collection<ExchangeRate>("exchangeRates").findOne({ currencyCode: ccy });
    const rate = doc?.rate;
    fxByCurrency.set(ccy, rate && rate > 0 ? rate : 1.0);
  }

  // Build refund rows.
  interface RefundRow {
    plan: (typeof planWithLiveData)[number];
    pricePerShareAnchor: number;
    baseAnchor: number;
    refundAnchor: number;
    recipientCurrency: CurrencyCode;
    fxRate: number;
    refundLocal: number;
    priceSource: "stored_avgCost" | "current_sharePrice";
  }
  const rows: RefundRow[] = [];
  for (const p of planWithLiveData) {
    const priceAnchor = p.liveAvgCostAnchor !== null ? p.liveAvgCostAnchor : sharePriceNow;
    const priceSource: RefundRow["priceSource"] =
      p.liveAvgCostAnchor !== null ? "stored_avgCost" : "current_sharePrice";
    const baseAnchor = p.liveShares * priceAnchor;
    const refundAnchor = baseAnchor * BONUS_MULTIPLIER;

    let recipientCurrency: CurrencyCode = "USD";
    let fxRate = 1.0;
    let refundLocal = refundAnchor;

    if (p.kind === "character") {
      const ch = charById.get(p.id);
      if (!ch) {
        console.error(`  character ${p.label} not found in DB — aborting`);
        process.exit(1);
      }
      recipientCurrency = getHomeCurrency(ch);
      fxRate = fxByCurrency.get(recipientCurrency) ?? 1.0;
      refundLocal = forexEnabled ? refundAnchor * fxRate : refundAnchor;
    } else {
      const c = corpById.get(p.id);
      if (!c) {
        console.error(`  corporation ${p.label} not found in DB — aborting`);
        process.exit(1);
      }
      recipientCurrency = (resolveCorpLiquidCurrencyCode(c) as CurrencyCode | undefined) ?? "USD";
      fxRate = fxByCurrency.get(recipientCurrency) ?? 1.0;
      refundLocal = anchorToCorpLiquidCapital(refundAnchor, c, fxRate);
    }

    rows.push({
      plan: p,
      pricePerShareAnchor: priceAnchor,
      baseAnchor,
      refundAnchor,
      recipientCurrency,
      fxRate,
      refundLocal,
      priceSource,
    });
  }

  // 4. Print plan.
  console.log(
    `\ncurrentTurn=${currentTurn} forexEnabled=${forexEnabled} sharePriceNow=${sharePriceNow} bonus=${BONUS_MULTIPLIER}`
  );
  console.log("\n==== REFUND PLAN ====");
  let totalBonusAnchor = 0;
  let totalRefundAnchor = 0;
  for (const r of rows) {
    totalBonusAnchor += r.refundAnchor - r.baseAnchor;
    totalRefundAnchor += r.refundAnchor;
    console.log(
      `  ${r.plan.label.padEnd(24)} ${r.plan.kind.padEnd(11)} ${String(r.plan.liveShares).padStart(3)}sh @ ₳${fmt(r.pricePerShareAnchor, 4)} (${r.priceSource})`
    );
    console.log(
      `    base=₳${fmt(r.baseAnchor)} +25%=₳${fmt(r.refundAnchor - r.baseAnchor)} total=₳${fmt(r.refundAnchor)}  →  ${r.recipientCurrency} ${fmt(r.refundLocal)} (rate=${fmt(r.fxRate, 6)})`
    );
  }
  console.log(
    `\nTotals: bonus=₳${fmt(totalBonusAnchor)}  refund_total=₳${fmt(totalRefundAnchor)}  shares_returned_to_CEO=${EXPECTED_NON_CEO_SHARE_SUM}`
  );

  if (!apply) {
    console.log("\nDry-run only. Re-run with --apply to write.");
    await client.close();
    return;
  }

  // 5. Apply.
  console.log("\n==== APPLYING ====");
  const now = new Date();

  // 5a. Credit each recipient.
  for (const r of rows) {
    if (r.plan.kind === "character") {
      const res = await db.collection<Character>("characters").updateOne(
        { _id: new ObjectId(r.plan.id) },
        {
          $inc: buildPersonalBalanceInc(r.refundLocal, r.recipientCurrency, forexEnabled),
          $set: { updatedAt: now },
        }
      );
      console.log(
        `  credited ${r.plan.label}: ${r.recipientCurrency} ${fmt(r.refundLocal)} (matched=${res.matchedCount})`
      );
    } else {
      const res = await db
        .collection<Corporation>("corporations")
        .updateOne(
          { _id: new ObjectId(r.plan.id) },
          { $inc: { liquidCapital: r.refundLocal }, $set: { updatedAt: now } }
        );
      console.log(
        `  credited ${r.plan.label}: ${r.recipientCurrency} ${fmt(r.refundLocal)} liquidCapital (matched=${res.matchedCount})`
      );
    }
  }

  // 5b. Pull the 7 non-CEO shareholder entries one at a time. Using $or in a
  // single $pull avoids a race, but MongoDB's positional typing for mixed
  // character/corporation predicates is tricky; serial pulls keep it simple
  // and safe since this script runs interactively.
  for (const r of rows) {
    const pullFilter =
      r.plan.kind === "character"
        ? { characterId: new ObjectId(r.plan.id) }
        : { corporationId: new ObjectId(r.plan.id) };
    const res = await db.collection<Corporation>("corporations").updateOne(
      { _id: new ObjectId(EXPECTED_CORP_ID) },
      {
        $pull: { shareholders: pullFilter } as unknown as Record<string, unknown>,
        $set: { updatedAt: now },
      }
    );
    console.log(`  pulled entry for ${r.plan.label} (modifiedCount=${res.modifiedCount})`);
  }

  // 5c. Return 93 shares to KIMI via atomic positional $inc.
  const sharesReturned = rows.reduce((s, r) => s + r.plan.liveShares, 0);
  const returnRes = await db.collection<Corporation>("corporations").updateOne(
    {
      _id: new ObjectId(EXPECTED_CORP_ID),
      "shareholders.characterId": new ObjectId(EXPECTED_CEO_ID),
    },
    {
      $inc: { "shareholders.$.shares": sharesReturned },
      $set: { updatedAt: now },
    }
  );
  console.log(
    `  returned ${sharesReturned} shares to CEO (modifiedCount=${returnRes.modifiedCount})`
  );

  // 5d. Clear lastShareIssuance so a fresh issuance isn't blocked by the
  // 24h cooldown stamp from KIMI's prior issuance.
  await db
    .collection<Corporation>("corporations")
    .updateOne(
      { _id: new ObjectId(EXPECTED_CORP_ID) },
      { $unset: { lastShareIssuance: "" }, $set: { updatedAt: now } }
    );
  console.log(`  cleared lastShareIssuance`);

  // Per operator direction, no audit rows are written for this reversal —
  // Share History starts empty on Corp 16 and accumulates only forward
  // trades. The `currentTurn` and `corpLiquidCurrencyCode` locals remain
  // plan-visible in the dry-run output above for traceability.
  void currentTurn;
  void corpLiquidCurrencyCode;

  // 5e. Re-verify post-state.
  const after = await db.collection<Corporation>("corporations").findOne({ _id: corp._id });
  if (!after) {
    console.error("  ERROR: corp disappeared after writes");
    await client.close();
    process.exit(1);
  }
  const afterShareholders = after.shareholders ?? [];
  const afterSum = afterShareholders.reduce((s, sh) => s + (sh.shares ?? 0), 0);
  console.log("\n==== POST-WRITE VERIFY ====");
  console.log(
    `  shareholders.length=${afterShareholders.length} (expected 1), sumShares=${afterSum} (expected ${EXPECTED_TOTAL_SHARES}), publicFloat=${after.publicFloat ?? 0}, lastShareIssuance=${after.lastShareIssuance ?? "cleared"}`
  );
  if (afterShareholders.length !== 1) {
    console.error("  WARN: more than one shareholder entry remains");
  }
  const ceoEntry = afterShareholders.find((sh) => sh.characterId?.toString() === EXPECTED_CEO_ID);
  if (!ceoEntry || ceoEntry.shares !== EXPECTED_TOTAL_SHARES) {
    console.error(
      `  WARN: CEO entry not equal to totalShares (ceo=${ceoEntry?.shares}, totalShares=${EXPECTED_TOTAL_SHARES})`
    );
  } else {
    console.log(`  CEO now holds ${ceoEntry.shares} / ${EXPECTED_TOTAL_SHARES} ✓`);
  }

  await client.close();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
