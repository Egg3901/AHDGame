/**
 * One-shot backfill of the audit spine from existing money history
 * (forensics/alt-detection rework plan Phase 9 T9.1).
 *
 * Seeds `actionAuditLog` envelopes from recent `financialTxLog` rows so the
 * Forensic Explorer / `audit_query` MCP tool are not empty the moment
 * `gameConfig.auditLog` is flipped on. Going forward, `emitTx`/`emitTxBulk`
 * write these envelopes live (Phase 2 T2.1); this only backfills history that
 * predates enablement. Money is the one domain with a durable pre-existing log
 * to reconstruct from — other categories start accumulating at flag-flip.
 *
 * DRY-RUN BY DEFAULT: reports what WOULD be written; pass `--apply` to insert.
 * Idempotent: skips any financialTxLog row that already has an audit envelope
 * (matched on `refs.financialTxLogId`), so re-running is safe.
 * Uses `directConnection=true` (single-node rs0 — see ops-knowledge
 * "AHD standalone Mongo = no txns").
 *
 * Run:
 *   npx tsx scripts/backfill-audit-from-financialtxlog.mjs                 # preview
 *   npx tsx scripts/backfill-audit-from-financialtxlog.mjs --apply         # write
 *   npx tsx scripts/backfill-audit-from-financialtxlog.mjs --turns 168 --apply
 *
 * `--turns N` limits the backfill to rows from the last N turns (default 336,
 * matching the actionAuditLog retention window; older money rows are typically
 * already aged out of financialTxLog by its own 168-turn TTL anyway).
 */

const APPLY = process.argv.includes("--apply");
const turnsArgIdx = process.argv.indexOf("--turns");
const TURNS_BACK = turnsArgIdx >= 0 ? Number(process.argv[turnsArgIdx + 1]) : 336;

const MONGO_URL = process.env.MONGODB_URI || process.env.MONGO_URL;
if (!MONGO_URL) {
  throw new Error("Set MONGODB_URI (or MONGO_URL) before running this script.");
}
const DB_NAME = process.env.MONGODB_DB || process.env.MONGO_DB_NAME || undefined;

function withDirectConnection(uri) {
  if (uri.includes("directConnection=")) return uri;
  return `${uri}${uri.includes("?") ? "&" : "?"}directConnection=true`;
}

const directUri = withDirectConnection(MONGO_URL);
const { MongoClient } = await import("mongodb");

const client = new MongoClient(directUri, { serverSelectionTimeoutMS: 15000 });
await client.connect();
const db = client.db(DB_NAME);

console.log(
  `DB: ${db.databaseName} | mode=${APPLY ? "APPLY" : "DRY-RUN"} | turnsBack=${TURNS_BACK}`
);
console.log(`Mongo: ${directUri.replace(/\/\/[^@]*@/, "//***:***@")}\n`);

// Minimal, self-contained tx-type -> namespaced audit action mapping (a superset
// map lives in src/lib/financialTxLog/emit.ts for the live path; backfilled
// historical rows only need a stable, readable verb).
function txTypeToAction(type) {
  if (!type) return "money.transaction";
  const map = {
    wire_transfer_out: "wire.send",
    wire_transfer_in: "wire.receive",
    campaign_donation: "party.donate",
    bond_purchase: "bond.buy",
    bond_sell: "bond.sell",
    corp_dividend: "corp.dividends",
    forex_trade: "forex.trade",
    stock_trade_buy: "stock.buy",
    stock_trade_sell: "stock.sell",
  };
  return map[type] || `money.${type}`;
}

try {
  const gameState = await db.collection("gameState").findOne({ _id: "current" });
  const currentTurn = gameState?.currentTurn ?? gameState?.turn ?? 0;
  const minTurn = Math.max(0, currentTurn - TURNS_BACK);

  const txCol = db.collection("financialTxLog");
  const auditCol = db.collection("actionAuditLog");

  const query = { turn: { $gte: minTurn } };
  const total = await txCol.countDocuments(query);
  console.log(`financialTxLog rows since turn ${minTurn}: ${total}`);

  let scanned = 0;
  let skippedExisting = 0;
  let toWrite = 0;
  let written = 0;
  const BATCH = 500;
  let batch = [];

  const cursor = txCol.find(query).sort({ turn: 1 }).batchSize(BATCH);
  for await (const tx of cursor) {
    scanned++;
    // Idempotency: skip if an audit envelope already references this tx.
    const exists = await auditCol.findOne(
      { "refs.financialTxLogId": tx._id },
      { projection: { _id: 1 } }
    );
    if (exists) {
      skippedExisting++;
      continue;
    }
    toWrite++;
    const ts = tx.createdAt instanceof Date ? tx.createdAt : new Date();
    const envelope = {
      ts,
      turn: tx.turn ?? currentTurn,
      traceId: `backfill:tx:${tx._id.toString()}`,
      source: "system",
      action: txTypeToAction(tx.type),
      category: "money",
      actor: { kind: "system" },
      subject: {
        type: tx.subjectType ?? "account",
        id: tx.subjectId ?? tx.countryId,
        name: tx.subjectName,
      },
      counterparty: tx.counterpartyType
        ? { type: tx.counterpartyType, id: tx.counterpartyId, name: tx.counterpartyName }
        : undefined,
      amount: tx.amount,
      currencyCode: tx.currencyCode,
      anchorAmount: tx.anchorAmount,
      refs: { financialTxLogId: tx._id },
      outcome: "ok",
      meta: { backfilled: true },
      // expiresAt left unset for backfill; the retention policy (timeKey "turn")
      // ages these out by turn regardless. The TTL index tolerates missing field.
    };
    if (APPLY) {
      batch.push(envelope);
      if (batch.length >= BATCH) {
        const res = await auditCol.insertMany(batch, { ordered: false });
        written += res.insertedCount;
        batch = [];
      }
    }
  }
  if (APPLY && batch.length) {
    const res = await auditCol.insertMany(batch, { ordered: false });
    written += res.insertedCount;
  }

  console.log("\nResult:");
  console.log(`  scanned:            ${scanned}`);
  console.log(`  already had audit:  ${skippedExisting}`);
  console.log(`  ${APPLY ? "written" : "would write"}:        ${APPLY ? written : toWrite}`);
  if (!APPLY) {
    console.log("\nDry run only — nothing written. Re-run with --apply to persist.");
  }
} finally {
  await client.close();
}
