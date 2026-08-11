/**
 * Remediate the null-rate market-maker bug.
 *
 * Incident: On turns 270–275 and 277, many market-maker auto-conversions
 * (`auto_coupon`, `auto_dividend`, `auto_purchase`, `auto_maturity`) wrote
 * tradeHistory rows with `rate: null` because `executeMarketMakerTrade` did
 * not validate the cross rate before applying its $inc. The source balance
 * was debited while the destination credit was dropped. Biggest single
 * victim: character Quintus Rockefeller lost ~39.55M GBP on a Smiths
 * Manufacturing bond maturity at turn 271.
 *
 * Remediation strategy: for every null-rate trade, refund the FROM currency
 * at the full `amount` that was debited (spread included — spread wasn't
 * earned because no conversion happened). This keeps players whole without
 * guessing what the intended cross rate would have been. Players can then
 * re-convert now that the code path is patched.
 *
 * Safety:
 *  - Dry run by default. Pass `--commit` to actually write.
 *  - Idempotent: a remediation marker doc is written per (characterId, turn,
 *    fromCurrency, amount) so re-running the script never double-credits.
 *  - Emits a `tradeHistory` row with `source: "remediation"` for each
 *    refund so the audit trail is intact.
 *
 * Usage:
 *   MONGODB_URI_LIVE=... npx tsx scripts/remediate-null-rate-trades.ts         # dry run
 *   MONGODB_URI_LIVE=... npx tsx scripts/remediate-null-rate-trades.ts --commit
 */

import { MongoClient, ObjectId } from "mongodb";
import type { Db } from "mongodb";

const COMMIT = process.argv.includes("--commit");
const MIN_TURN = 269;

interface NullRateTrade {
  _id: ObjectId;
  buyerCharacterId?: ObjectId;
  fromCurrency: string;
  toCurrency: string;
  amount: number;
  turn: number;
  source?: string;
  createdAt: Date;
}

async function main() {
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) {
    console.error("MONGODB_URI_LIVE not set");
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("a-house-divided");

  console.log(COMMIT ? "=== COMMIT MODE ===" : "=== DRY RUN ===");

  const trades = (await db
    .collection("tradeHistory")
    .find({
      turn: { $gte: MIN_TURN },
      $or: [{ rate: null }, { rate: { $exists: false } }, { rate: { $lte: 0 } }],
    })
    .sort({ turn: 1, createdAt: 1 })
    .toArray()) as unknown as NullRateTrade[];

  console.log(`\nFound ${trades.length} null-rate trades at turn >= ${MIN_TURN}`);

  // Aggregate per character for summary
  const perChar = new Map<
    string,
    { name?: string; trades: NullRateTrade[]; totalByCurrency: Record<string, number> }
  >();
  for (const t of trades) {
    if (!t.buyerCharacterId) continue;
    const key = t.buyerCharacterId.toString();
    let entry = perChar.get(key);
    if (!entry) {
      entry = { trades: [], totalByCurrency: {} };
      perChar.set(key, entry);
    }
    entry.trades.push(t);
    entry.totalByCurrency[t.fromCurrency] = (entry.totalByCurrency[t.fromCurrency] ?? 0) + t.amount;
  }

  // Load names
  const charIds = [...perChar.keys()].map((s) => new ObjectId(s));
  const chars = await db
    .collection("characters")
    .find({ _id: { $in: charIds } })
    .project({ name: 1 })
    .toArray();
  for (const c of chars) {
    const key = c._id.toString();
    const entry = perChar.get(key);
    if (entry) entry.name = c.name;
  }

  // Sort victims by total loss in USD-equivalent using current live rates
  const liveRates = await db.collection("exchangeRates").find({}).toArray();
  const rateByCode: Record<string, number> = {};
  for (const r of liveRates) {
    if (r.currencyCode && typeof r.rate === "number" && r.rate > 0) {
      rateByCode[r.currencyCode] = r.rate;
    }
  }

  function usdEquivalent(amount: number, currency: string): number {
    const fromRate = rateByCode[currency];
    const usdRate = rateByCode["USD"];
    if (!fromRate || !usdRate) return amount; // best-effort display only
    return (amount * usdRate) / fromRate;
  }

  const ranked = [...perChar.entries()].map(([id, entry]) => {
    const usd = Object.entries(entry.totalByCurrency).reduce(
      (sum, [cur, amt]) => sum + usdEquivalent(amt, cur),
      0
    );
    return { id, entry, usd };
  });
  ranked.sort((a, b) => b.usd - a.usd);

  console.log("\n=== Affected characters (sorted by USD-equivalent loss) ===");
  for (const r of ranked) {
    const summary = Object.entries(r.entry.totalByCurrency)
      .map(([cur, amt]) => `${cur}=${amt.toFixed(2)}`)
      .join(", ");
    console.log(
      `  ${r.entry.name ?? "(unknown)"} [${r.id}] — ${r.entry.trades.length} trades, ~$${r.usd.toFixed(2)} USD: ${summary}`
    );
  }

  // Apply refunds
  let refundedCount = 0;
  let skippedCount = 0;
  for (const t of trades) {
    if (!t.buyerCharacterId) {
      skippedCount++;
      continue;
    }
    // Guard: only auto-sources. Manual trades at null rate are suspicious but
    // we don't want to auto-refund them — they may have been intentional admin
    // actions or other edge cases. Log them separately.
    const autoSources = new Set([
      "auto_coupon",
      "auto_dividend",
      "auto_purchase",
      "auto_maturity",
      "auto_bond",
    ]);
    if (!autoSources.has(t.source ?? "")) {
      console.log(
        `  SKIP non-auto trade: turn=${t.turn} src=${t.source} amount=${t.amount} ${t.fromCurrency}→${t.toCurrency} buyer=${t.buyerCharacterId.toString()}`
      );
      skippedCount++;
      continue;
    }

    // Idempotency check — look for an existing remediation row tied to this trade.
    const existing = await db
      .collection("tradeHistory")
      .findOne({ source: "remediation", sourceRef: t._id.toString() });
    if (existing) {
      skippedCount++;
      continue;
    }

    if (!Number.isFinite(t.amount) || t.amount <= 0) {
      skippedCount++;
      continue;
    }

    if (COMMIT) {
      const outcome = await applyRefund(db, t);
      if (outcome === "ok") {
        refundedCount++;
      } else {
        skippedCount++;
      }
    } else {
      refundedCount++;
    }
  }

  console.log(
    `\nSummary: ${refundedCount} refunds ${COMMIT ? "applied" : "would be applied"}, ${skippedCount} skipped`
  );

  await client.close();
}

async function applyRefund(db: Db, t: NullRateTrade): Promise<"ok" | "skip_nan" | "skip_missing"> {
  // Determine whether this was a Character or ImperialCharacter — balance
  // writes go to the same collection the original deduction hit.
  const balanceField = `currencyBalances.personal.${t.fromCurrency}` as const;
  let collectionName: "characters" | "imperialCharacters" = "characters";
  let currentDoc = await db
    .collection(collectionName)
    .findOne({ _id: t.buyerCharacterId }, { projection: { [balanceField]: 1 } });
  if (!currentDoc) {
    collectionName = "imperialCharacters";
    currentDoc = await db
      .collection(collectionName)
      .findOne({ _id: t.buyerCharacterId }, { projection: { [balanceField]: 1 } });
  }
  if (!currentDoc) {
    console.warn(
      `  WARN character ${t.buyerCharacterId?.toString()} not found in characters or imperialCharacters — skipping refund for trade ${t._id.toString()}`
    );
    return "skip_missing";
  }

  // `$inc` on a NaN field yields NaN, so a pre-existing NaN balance would
  // silently swallow the refund. Bail out and flag so it can be healed
  // (e.g. via the NaN-cascade heal script) before re-running.
  const currentBalance =
    (currentDoc as { currencyBalances?: { personal?: Record<string, number> } }).currencyBalances
      ?.personal?.[t.fromCurrency] ?? 0;
  if (!Number.isFinite(currentBalance)) {
    console.warn(
      `  WARN ${collectionName}/${t.buyerCharacterId?.toString()} has non-finite ${t.fromCurrency} balance (${currentBalance}) — skipping refund for trade ${t._id.toString()}`
    );
    return "skip_nan";
  }

  // Crash-safety ordering: insert the audit row FIRST, then apply the
  // balance `$inc`. If the process dies between the two writes, re-running
  // sees the existing audit row and skips — preventing double-credit.
  // Worst case is an audit row with no matching balance bump, which an
  // admin can heal manually (and which is still less damaging than an
  // extra $39M GBP showing up in someone's wallet).
  await db.collection("tradeHistory").insertOne({
    buyerCharacterId: t.buyerCharacterId,
    sellerCharacterId: null,
    fromCurrency: t.toCurrency, // inverted — we're refunding, so semantically
    toCurrency: t.fromCurrency, // the "from" becomes the credit target
    amount: 0, // no currency was taken to execute this remediation
    rate: 1,
    spread: 0,
    turn: t.turn,
    createdAt: new Date(),
    source: "remediation",
    sourceRef: t._id.toString(),
    note: `Refund for null-rate auto-convert on turn ${t.turn}: ${t.amount} ${t.fromCurrency} credited back.`,
  } as never);

  await db
    .collection(collectionName)
    .updateOne({ _id: t.buyerCharacterId }, { $inc: { [balanceField]: t.amount } });

  return "ok";
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
