import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { MongoClient } from "mongodb";
const __d = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__d, "../../.env.local") });
let uri = process.env.MONGODB_URI_LIVE;
if (!uri.includes("directConnection"))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";
const client = new MongoClient(uri);
const M = (n) =>
  n == null ? "-" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
try {
  await client.connect();
  const db = client.db();
  const gs = await db.collection("gameState").findOne({ _id: "current" });
  console.log("turn now:", gs.currentTurn);

  // --- 1. ASMC attribution: who actually traded corp 738 stock? ---
  const tinky = await db.collection("corporations").findOne({ sequentialId: 738 });
  const asmc = await db
    .collection("corporations")
    .findOne(
      { name: /American Semiconductor/i },
      { projection: { name: 1, sequentialId: 1, liquidCapital: 1, sharePrice: 1, totalShares: 1 } }
    );
  console.log("\n=== 1. ASMC attribution ===");
  console.log("Tinky 3.0 _id:", String(tinky._id), "seqId", tinky.sequentialId);
  console.log(
    "ASMC:",
    asmc
      ? `${asmc.name} seqId=${asmc.sequentialId} _id=${asmc._id} cash=${M(asmc.liquidCapital)}`
      : "NOT FOUND"
  );
  const asmcId = asmc ? String(asmc._id) : null;
  const tr = await db
    .collection("shareTradeHistory")
    .find({ corporationId: tinky._id })
    .sort({ turn: 1 })
    .toArray();
  let bought = 0,
    boughtCost = 0,
    sold = 0,
    soldProceeds = 0;
  for (const t of tr) {
    const toId = t.to?.corporationId ? String(t.to.corporationId) : null;
    const frId = t.from?.corporationId ? String(t.from.corporationId) : null;
    if (toId && toId === asmcId) {
      bought += t.shares;
      boughtCost += t.totalAnchor;
    }
    if (frId && frId === asmcId) {
      sold += t.shares;
      soldProceeds += t.totalAnchor;
    }
  }
  console.log(
    `ASMC as COUNTERPARTY in corp-738 stock: bought ${M(bought)} sh for $${M(boughtCost)}; sold ${M(sold)} sh for $${M(soldProceeds)}`
  );
  console.log(`ASMC realized gain on corp-738 stock: $${M(soldProceeds - boughtCost)}`);
  // does ASMC have its OWN shareTradeHistory rows (i.e. trades in ASMC's own stock)?
  if (asmc) {
    const own = await db
      .collection("shareTradeHistory")
      .countDocuments({ corporationId: asmc._id });
    console.log(`rows keyed to ASMC's OWN stock (corporationId=ASMC): ${own}`);
  }

  // --- 2. rare-earth worker share ---
  console.log("\n=== 2. rare-earth worker share ===");
  const re = await db
    .collection("corporateSectors")
    .find({ strategyId: "rare_earth_mining" })
    .toArray();
  const totWk = re.reduce((a, s) => a + (s.workers ?? 0), 0);
  const tinkyWk = re
    .filter((s) => String(s.corporationId) === String(tinky._id))
    .reduce((a, s) => a + (s.workers ?? 0), 0);
  console.log(
    `global rare-earth workers=${M(totWk)} across ${re.length} sectors; corp738=${M(tinkyWk)} => ${((tinkyWk / totWk) * 100).toFixed(1)}%`
  );

  // --- 3. aggregate market cap in ANCHOR currency ---
  console.log("\n=== 3. aggregate marketCap: raw local sum vs anchor-converted ===");
  const rates = await db.collection("exchangeRates").find({}).toArray();
  const rateBy = new Map();
  for (const r of rates) rateBy.set(r._id ?? r.currencyCode, r.rate ?? r.rateToAnchor ?? r.value);
  console.log("exchangeRates sample:", JSON.stringify(rates.slice(0, 3)));
  const corps = await db
    .collection("corporations")
    .find({}, { projection: { liquidCurrencyCode: 1, countryId: 1 } })
    .toArray();
  const ccyBy = new Map(corps.map((c) => [String(c._id), c.liquidCurrencyCode]));
  for (const turn of [400, 500, 600, 694]) {
    const rows = await db
      .collection("corporationHistory")
      .find({ turn }, { projection: { corporationId: 1, marketCap: 1 } })
      .toArray();
    let raw = 0,
      anchor = 0,
      unpriced = 0;
    for (const h of rows) {
      const mc = h.marketCap ?? 0;
      raw += mc;
      const ccy = ccyBy.get(String(h.corporationId));
      const rate = ccy ? rateBy.get(ccy) : undefined;
      if (typeof rate === "number" && rate > 0) anchor += mc / rate;
      else {
        anchor += mc;
        unpriced++;
      }
    }
    console.log(
      `t${turn}: n=${rows.length} rawLocalSum=${M(raw)} anchorSum=${M(anchor)} (unpriced ${unpriced})`
    );
  }

  // --- 4. USD pool full ledger legs ---
  console.log("\n=== 4. USD equity pool: ALL lifetime legs ===");
  const usd = await db.collection("equityMarketPools").findOne({ _id: "USD" });
  console.log(
    "cashLocal",
    M(usd.cashLocal),
    "target",
    M(usd.targetCashLocal),
    "m2",
    M(usd.m2Local)
  );
  console.log("lifetime:", JSON.stringify(usd.lifetime, null, 1));
  const l = usd.lifetime ?? {};
  const ins = (l.purchasesIn ?? 0) + (l.dividendsIn ?? 0) + (l.inflowIn ?? 0);
  const outs = (l.salesOut ?? 0) + (l.issuanceOut ?? 0) + (l.sweepOut ?? 0) + (l.estateOut ?? 0);
  console.log(
    `sum(ins)=${M(ins)} sum(outs)=${M(outs)} ins-outs=${M(ins - outs)} vs cashLocal=${M(usd.cashLocal)}`
  );
  console.log(`implied initial seed = cash - (ins-outs) = ${M(usd.cashLocal - (ins - outs))}`);
  const gap = usd.targetCashLocal - usd.cashLocal;
  console.log(`current shortfall=${M(gap)} => next-turn inflow @2% = ${M(gap * 0.02)}`);

  // --- 5. rate limiter compounding ---
  console.log("\n=== 5. rate limiter compounding (1.35^n) ===");
  for (const n of [24, 25, 48]) console.log(`1.35^${n} = ${Math.pow(1.35, n).toExponential(3)}`);
} finally {
  await client.close();
}
