/**
 * READ-ONLY investigation for ticket #890 ("my liquid capital keeps dropping").
 * Reporter: char 10 (Obafemi Awolowo), corp 168 (Pfizer), NG.
 * Dumps recent financial tx-log entries for the character (and corp) and
 * summarizes debits/credits by type so we can tell a bug from legit upkeep/tax.
 *
 * NO WRITES. Run: npx tsx scripts/inspect-890-liquid.ts
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const d = (u: string) => (u.includes("directConnection=") ? u : `${u}&directConnection=true`);

async function main() {
  const c = new MongoClient(d(process.env.MONGODB_URI!));
  await c.connect();
  const db = c.db();

  const ch: any =
    (await db.collection("characters").findOne({ sequentialId: 10 })) ??
    (await db.collection("characters").findOne({ name: "Obafemi Awolowo" }));
  if (!ch) throw new Error("character not found");
  console.log("=== Character ===");
  console.log({
    _id: String(ch._id),
    name: ch.name,
    countryId: ch.countryId,
    funds: ch.funds,
    currencyBalances: ch.currencyBalances,
  });

  const tx = db.collection("financialTxLog");
  const recent: any[] = await tx
    .find({ subjectId: ch._id })
    .sort({ turn: -1, createdAt: -1 })
    .limit(40)
    .toArray();
  console.log(`\n=== Last ${recent.length} character tx (newest first) ===`);
  for (const t of recent) {
    console.log(
      `t${t.turn}`.padEnd(7),
      String(t.type).padEnd(22),
      String(t.amount).padStart(14),
      t.currencyCode ?? "",
      t.memo ? `— ${t.memo}` : ""
    );
  }

  // Summaries by type over the recent window.
  const byType: Record<string, { n: number; sum: number }> = {};
  for (const t of recent) {
    const k = String(t.type);
    byType[k] = byType[k] ?? { n: 0, sum: 0 };
    byType[k].n++;
    byType[k].sum += t.amount ?? 0;
  }
  console.log("\n=== Net by type (recent window) ===");
  for (const [k, v] of Object.entries(byType).sort((a, b) => a[1].sum - b[1].sum)) {
    console.log(k.padEnd(24), `n=${v.n}`.padEnd(6), v.sum.toLocaleString());
  }

  // Corp 168 snapshot (liquidCapital) + recent corp tx.
  const corp: any =
    (await db.collection("corporations").findOne({ sequentialId: 168 })) ??
    (await db.collection("corporations").findOne({ name: "Pfizer" }));
  if (corp) {
    console.log("\n=== Corp 168 (Pfizer) ===");
    console.log({
      _id: String(corp._id),
      name: corp.name,
      liquidCapital: corp.liquidCapital,
      liquidCurrencyCode: corp.liquidCurrencyCode,
      ceoId: String(corp.ceoId),
    });
  }

  await c.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
