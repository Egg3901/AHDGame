/**
 * Ad-hoc shadow-ledger coverage stats for a sandbox sim DB (Phase 3 measurement).
 *
 * Compares financialTxLog rows against derived ledgerEntries by txType so we can
 * report "% of tx rows deriving into entries" and see which types still fall
 * short. Read-only. Not part of the shipped surface — a measurement aid.
 *
 * Usage:
 *   SIM_MONGODB_URI=mongodb://127.0.0.1:27018/?directConnection=true \
 *     npx tsx scripts/ledger/coverageStats.ts --db=ahd_sim_ledger_base
 */
export {};

function arg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  return process.argv.find((v) => v.startsWith(prefix))?.slice(prefix.length);
}

const SIM_MONGODB_URI = process.env.SIM_MONGODB_URI ?? process.env.MONGODB_URI;
const dbName = arg("db");
if (!SIM_MONGODB_URI || !dbName) {
  console.error("SIM_MONGODB_URI and --db=<name> required.");
  process.exit(1);
}
(process.env as { NODE_ENV: string }).NODE_ENV = "test";
process.env.MONGODB_URI = SIM_MONGODB_URI;
process.env.MONGODB_DB = dbName;

async function main() {
  const { getDb } = await import("@/lib/mongodb");
  const db = await getDb();

  const txByType = new Map<string, number>();
  const txRows = db.collection<{ type: string; anchorAmount?: number }>("financialTxLog");
  const totalTx = await txRows.countDocuments();
  const derivableTx = await txRows.countDocuments({ anchorAmount: { $exists: true } });
  for await (const r of txRows.find({}, { projection: { type: 1 } })) {
    txByType.set(r.type, (txByType.get(r.type) ?? 0) + 1);
  }

  const entryByType = new Map<string, number>();
  const entries = db.collection<{ txType: string }>("ledgerEntries");
  const totalEntries = await entries.countDocuments();
  for await (const e of entries.find({}, { projection: { txType: 1 } })) {
    entryByType.set(e.txType, (entryByType.get(e.txType) ?? 0) + 1);
  }

  console.log(`financialTxLog rows:      ${totalTx}`);
  console.log(`  with anchorAmount:      ${derivableTx}`);
  console.log(`ledgerEntries derived:    ${totalEntries}`);
  console.log(`coverage (entries/txRows): ${((totalEntries / totalTx) * 100).toFixed(2)}%`);
  console.log("");
  console.log("Per-txType: txRows -> entries (gap = undivined rows)");
  const types = [...new Set([...txByType.keys(), ...entryByType.keys()])].sort();
  for (const t of types) {
    const tx = txByType.get(t) ?? 0;
    const en = entryByType.get(t) ?? 0;
    const gap = tx - en;
    console.log(
      `  ${t.padEnd(32)} ${String(tx).padStart(7)} -> ${String(en).padStart(7)}` +
        (gap !== 0 ? `   gap ${gap}` : "")
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
