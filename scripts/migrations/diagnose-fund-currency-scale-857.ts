/**
 * READ-ONLY diagnostic for ticket #857 index-fund currency-scale reconciliation.
 *
 * Answers the one question that decides the migration direction:
 *   Are fund ₳ fields (quotedNav/cashAnchor/holdings/avgNavAnchor) stored at
 *   ANCHOR scale (≈ native ÷ rate) or NATIVE scale (already × rate)?
 *
 * Writes NOTHING. Prints, per fund: currency, FX rate, quotedNav, unitSupply,
 * cashAnchor, holdingsValue, backing ratio, and a native-vs-anchor scale guess,
 * plus a sample of holder positions (avgNavAnchor) so we can see what holders
 * actually paid.
 *
 * Run:  MONGODB_URI="$(grep '^MONGODB_URI=' .env.local | cut -d= -f2-)" \
 *         npx tsx scripts/migrations/diagnose-fund-currency-scale-857.ts
 */
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI not set");

type Holding = { shares: number; avgCostPerShareAnchor?: number; lastValueAnchor?: number };
type BondAlloc = { principalAnchor?: number };
type Fund = {
  _id: ObjectId;
  slug: string;
  name: string;
  anchorCurrencyCode: string;
  status: string;
  quotedNav: number;
  unitSupply: number;
  cashAnchor: number;
  holdings?: Holding[];
  bondAllocations?: BondAlloc[];
};

function holdingsValue(h: Holding[] = []): number {
  return h.reduce((s, x) => {
    const v = x.lastValueAnchor ?? x.shares * (x.avgCostPerShareAnchor ?? 0);
    return s + (Number.isFinite(v) ? Math.max(0, v) : 0);
  }, 0);
}
function bondValue(b: BondAlloc[] = []): number {
  return b.reduce((s, x) => s + Math.max(0, x.principalAnchor ?? 0), 0);
}
const fmt = (n: number) =>
  Math.abs(n) >= 1e9
    ? (n / 1e9).toFixed(2) + "B"
    : Math.abs(n) >= 1e6
      ? (n / 1e6).toFixed(2) + "M"
      : n.toLocaleString(undefined, { maximumFractionDigits: 2 });

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  const db = client.db();
  console.log("Connected. DB =", db.databaseName, "\n");

  // FX rates: native per 1 ₳
  const rates = new Map<string, number>();
  for (const r of await db.collection("exchangeRates").find({}).toArray()) {
    if (typeof r.currencyCode === "string" && typeof r.rate === "number")
      rates.set(r.currencyCode, r.rate);
  }
  console.log("exchangeRates loaded:", rates.size, "currencies");
  console.log(
    "  sample:",
    [...rates.entries()]
      .slice(0, 12)
      .map(([c, r]) => `${c}=${r}`)
      .join("  "),
    "\n"
  );

  const funds = (await db.collection("indexFunds").find({}).toArray()) as unknown as Fund[];
  console.log("indexFunds:", funds.length, "\n");
  console.log("─".repeat(120));

  for (const f of funds.sort((a, b) => a.anchorCurrencyCode.localeCompare(b.anchorCurrencyCode))) {
    const ccy = f.anchorCurrencyCode;
    const rate = rates.get(ccy);
    const hv = holdingsValue(f.holdings);
    const bv = bondValue(f.bondAllocations);
    const qLiab = f.quotedNav * f.unitSupply;
    const backing = Math.max(0, f.cashAnchor + hv + bv);
    const ratio = qLiab > 0 ? backing / qLiab : 1;

    // Scale guess: if quotedNav*rate lands in a "human native price" band it's anchor-scale.
    const navIfAnchor = rate ? f.quotedNav * rate : null; // what native NAV would be if field is ₳
    const scaleGuess =
      rate == null
        ? "no-rate"
        : Math.abs(rate - 1) < 0.02
          ? "rate≈1 (n/a)"
          : "see nav_native vs quotedNav";

    console.log(
      `${f.slug.padEnd(16)} ${ccy.padEnd(4)} rate=${(rate ?? NaN).toFixed(3).padStart(9)}  ` +
        `status=${(f.status || "").padEnd(8)} units=${fmt(f.unitSupply).padStart(9)}`
    );
    console.log(
      `    quotedNav=${fmt(f.quotedNav).padStart(12)}  cashAnchor=${fmt(f.cashAnchor).padStart(12)}  ` +
        `holdings=${fmt(hv).padStart(12)}  bonds=${fmt(bv).padStart(10)}`
    );
    console.log(
      `    quotedLiability=${fmt(qLiab).padStart(12)}  backingValue=${fmt(backing).padStart(12)}  ` +
        `backingRatio=${(ratio * 100).toFixed(1)}%   nav_native(=nav×rate)=${navIfAnchor == null ? "?" : fmt(navIfAnchor)}   [${scaleGuess}]`
    );

    // sample positions
    const pos = await db
      .collection("indexFundPositions")
      .find({ fundId: f._id, units: { $gt: 0 } })
      .limit(4)
      .toArray();
    if (pos.length) {
      console.log(
        "    positions:",
        pos
          .map(
            (p) =>
              `[${p.holderKind} u=${fmt(p.units)} avgNav=${p.avgNavAnchor == null ? "?" : fmt(p.avgNavAnchor)}]`
          )
          .join(" ")
      );
    }
    console.log("─".repeat(120));
  }

  await client.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
