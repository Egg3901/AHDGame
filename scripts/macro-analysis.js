const fs = require("fs");
const { MongoClient } = require("mongodb");
const raw = fs.readFileSync(".env.local", "utf8");
raw.split("\n").forEach((line) => {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const client = new MongoClient(process.env.MONGODB_URI);

async function run() {
  await client.connect();
  const db = client.db("a-house-divided");

  const banks = await db.collection("centralBanks").find({}).toArray();
  const fx = await db.collection("exchangeRates").find({}).toArray();
  const gs = await db.collection("gameState").findOne({ _id: "current" });
  const countries = await db.collection("countries").find({}).toArray();
  const budgets = await db.collection("budgets").find({}).toArray();
  const commodities = await db.collection("commodityPrices").find({}).toArray();

  // Corporation aggregate data per country
  const corps = await db.collection("corporations").find({ isPrivate: false }).toArray();
  const corpByCountry = {};
  for (const c of corps) {
    const cid = c.countryId;
    if (!corpByCountry[cid])
      corpByCountry[cid] = {
        count: 0,
        totalMarketCap: 0,
        totalRevenue: 0,
        totalIncome: 0,
        totalLiquidCapital: 0,
        totalPublicFloat: 0,
        totalShares: 0,
      };
    corpByCountry[cid].count++;
    corpByCountry[cid].totalMarketCap += (c.sharePrice || 0) * (c.totalShares || 0);
    corpByCountry[cid].totalRevenue += c.revenue || 0;
    corpByCountry[cid].totalIncome += c.income || 0;
    corpByCountry[cid].totalLiquidCapital += c.liquidCapital || 0;
    corpByCountry[cid].totalPublicFloat += c.publicFloat || 0;
    corpByCountry[cid].totalShares += c.totalShares || 0;
  }

  // Share orders (open buy/sell)
  const shareOrders = await db.collection("shareOrders").find({ status: "open" }).toArray();
  const ordersByCountry = {};
  for (const o of shareOrders) {
    // Need to look up corp country
    const corp = corps.find((c) => c._id.equals(o.corporationId));
    if (!corp) continue;
    const cid = corp.countryId;
    if (!ordersByCountry[cid])
      ordersByCountry[cid] = { buys: 0, sells: 0, buyVolume: 0, sellVolume: 0 };
    if (o.type === "buy") {
      ordersByCountry[cid].buys++;
      ordersByCountry[cid].buyVolume += o.sharesRemaining || 0;
    } else {
      ordersByCountry[cid].sells++;
      ordersByCountry[cid].sellVolume += o.sharesRemaining || 0;
    }
  }

  // Sovereign bonds outstanding per country
  const bonds = await db.collection("sovereignBonds").find({}).toArray();
  const bondsByCountry = {};
  for (const b of bonds) {
    const cid = b.countryId;
    if (!bondsByCountry[cid])
      bondsByCountry[cid] = { totalIssued: 0, totalOutstanding: 0, count: 0 };
    bondsByCountry[cid].totalIssued += b.totalIssued || 0;
    bondsByCountry[cid].totalOutstanding += b.remainingPrincipal || 0;
    bondsByCountry[cid].count++;
  }

  // Character wealth by country
  const chars = await db.collection("characters").find({}).toArray();
  const wealthByCountry = {};
  for (const ch of chars) {
    const cid = ch.countryId;
    if (!wealthByCountry[cid])
      wealthByCountry[cid] = { count: 0, totalWealth: 0, totalCash: 0, avgWealth: 0, maxWealth: 0 };
    wealthByCountry[cid].count++;
    const w = (ch.currencyBalances?.campaign || 0) + (ch.currencyBalances?.personal || 0);
    wealthByCountry[cid].totalWealth += w;
    wealthByCountry[cid].totalCash += ch.currencyBalances?.campaign || 0;
    wealthByCountry[cid].maxWealth = Math.max(wealthByCountry[cid].maxWealth, w);
  }
  for (const cid of Object.keys(wealthByCountry)) {
    if (wealthByCountry[cid].count > 0)
      wealthByCountry[cid].avgWealth =
        wealthByCountry[cid].totalWealth / wealthByCountry[cid].count;
  }

  const result = {
    turn: gs?.currentTurn,
    year: gs?.startingYear ? gs.startingYear + Math.floor((gs.currentTurn - 1) / 48) : null,
    banks: banks.map((b) => ({
      _id: b._id,
      primeRate: b.primeRate,
      inflationHistory: b.inflationHistory?.slice(-8),
      gdpGrowthHistory: b.gdpGrowthHistory?.slice(-8),
      interestRateHistory: b.interestRateHistory?.slice(-8),
      forexRevenue: b.forexRevenue,
    })),
    fx: fx.map((f) => ({
      _id: f._id,
      rate: f.rate,
      baseRate: f.baseRate,
      macroTarget: f.macroTarget,
      rateHistory: f.rateHistory?.slice(-5),
    })),
    countries: countries.map((c) => ({
      _id: c._id,
      name: c.name,
      gdp: c.gdp,
      population: c.population,
      status: c.status,
    })),
    budgets: budgets.map((b) => ({
      _id: b._id,
      countryId: b.countryId,
      totalRevenue: b.totalRevenue,
      totalSpending: b.totalSpending,
      deficit: b.deficit,
      revenueBreakdown: b.revenueBreakdown
        ? Object.keys(b.revenueBreakdown).reduce((acc, k) => {
            acc[k] = b.revenueBreakdown[k];
            return acc;
          }, {})
        : null,
      spendingBreakdown: b.spendingBreakdown
        ? Object.keys(b.spendingBreakdown).reduce((acc, k) => {
            acc[k] = b.spendingBreakdown[k];
            return acc;
          }, {})
        : null,
    })),
    commodities: commodities.map((c) => ({
      commodity: c.commodity,
      globalPrice: c.globalPrice,
      basePrice: c.basePrice,
      globalSupply: c.globalSupply,
      globalDemand: c.globalDemand,
    })),
    corpByCountry,
    ordersByCountry,
    bondsByCountry,
    wealthByCountry,
  };

  console.log(JSON.stringify(result, null, 2));
  await client.close();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
