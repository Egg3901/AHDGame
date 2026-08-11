// Compact summary extraction for report
require("dotenv").config({ path: ".env.local" });
const { MongoClient } = require("mongodb");
const fs = require("fs");

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("a-house-divided");

  const out = {};

  // Commodity S/D summary
  const commodities = await db.collection("commodityPrices").find({}).toArray();
  out.commodities = commodities.map((c) => ({
    commodity: c.commodity,
    basePrice: c.basePrice,
    globalPrice: Math.round(c.globalPrice * 100) / 100,
    globalSupply: Math.round(c.globalSupply),
    globalDemand: Math.round(c.globalDemand),
    sdRatio: Math.round((c.globalDemand / c.globalSupply) * 100) / 100,
    priceRatio: Math.round((c.globalPrice / c.basePrice) * 100) / 100,
  }));

  // Exchange rates
  const rates = await db.collection("exchangeRates").find({}).toArray();
  out.exchangeRates = rates.map((r) => ({
    country: r._id,
    rate: r.rate,
    baseRate: r.baseRate,
    deviation: r.baseRate ? Math.round(((r.rate - r.baseRate) / r.baseRate) * 10000) / 100 : 0,
  }));

  // Central banks
  const banks = await db.collection("centralBanks").find({}).toArray();
  out.centralBanks = banks.map((b) => ({
    country: b._id,
    primeRate: b.primeRate,
    forexRevenue: b.forexRevenue,
  }));

  // Federal budgets
  const budgets = await db.collection("federalBudget").find({}).toArray();
  out.federalBudgets = budgets.map((b) => ({
    country: b._id || b.countryId,
    revenue: b.revenue?.total || 0,
    spending: b.spending?.total || 0,
    deficit: (b.revenue?.total || 0) - (b.spending?.total || 0),
    debtToGdp: b.debtToGdpRatio || null,
  }));

  // Top corporations
  const corps = await db.collection("corporations").find({ isPrivate: false }).toArray();
  corps.forEach((c) => {
    c.marketCap = (c.sharePrice || 0) * (c.totalShares || 0);
  });
  corps.sort((a, b) => b.marketCap - a.marketCap);
  out.topCorporations = corps.slice(0, 20).map((c) => ({
    name: c.name,
    country: c.countryId,
    sharePrice: c.sharePrice,
    totalShares: c.totalShares,
    marketCap: c.marketCap,
    liquidCapital: Math.round(c.liquidCapital || 0),
    publicFloat: c.publicFloat,
  }));

  // Corporation count by country
  const corpsByCountry = await db
    .collection("corporations")
    .aggregate([
      {
        $group: {
          _id: "$countryId",
          total: { $sum: 1 },
          public: { $sum: { $cond: ["$isPrivate", 0, 1] } },
          private: { $sum: { $cond: ["$isPrivate", 1, 0] } },
        },
      },
    ])
    .toArray();
  out.corpsByCountry = corpsByCountry;

  // Wealth by country
  const wealth = await db
    .collection("characters")
    .aggregate([
      { $match: { countryId: { $exists: true } } },
      {
        $group: {
          _id: "$countryId",
          count: { $sum: 1 },
          totalPersonal: { $sum: "$currencyBalances.personal" },
          totalCampaign: { $sum: "$currencyBalances.campaign" },
          avgPersonal: { $avg: "$currencyBalances.personal" },
          maxPersonal: { $max: "$currencyBalances.personal" },
        },
      },
    ])
    .toArray();
  out.wealthByCountry = wealth;

  // Political parties
  const parties = await db.collection("politicalParties").find({}).toArray();
  out.politicalParties = parties.map((p) => ({
    name: p.name,
    country: p.countryId,
    sequentialId: p.sequentialId,
    treasury: p.treasury,
    memberCount: p.memberCount,
    politicalStrength: p.politicalStrength,
  }));

  // Elections summary
  const electionSummary = await db
    .collection("elections")
    .aggregate([
      { $group: { _id: { country: "$countryId", status: "$status" }, count: { $sum: 1 } } },
    ])
    .toArray();
  out.electionSummary = electionSummary;

  // Stock exchange snapshots
  const exchanges = await db.collection("stockExchangeSnapshots").find({}).toArray();
  out.stockExchanges = exchanges.map((e) => ({
    exchange: e._id,
    listingCount: e.listings?.length || 0,
    topListing: e.listings?.[0]?.name || "N/A",
  }));

  // Savings summary
  const savings = await db
    .collection("savingsLedger")
    .aggregate([
      {
        $group: {
          _id: "$currencyCode",
          count: { $sum: 1 },
          total: { $sum: "$balance" },
          avg: { $avg: "$balance" },
        },
      },
    ])
    .toArray();
  out.savings = savings;

  // Bonds by country
  const bonds = await db
    .collection("bonds")
    .aggregate([
      { $match: { status: "active" } },
      { $group: { _id: "$countryId", count: { $sum: 1 }, totalAmount: { $sum: "$totalAmount" } } },
    ])
    .toArray();
  out.activeBonds = bonds;

  // NPP count
  out.nppCount = await db.collection("npps").countDocuments();

  // Corporate sectors by country
  const sectors = await db
    .collection("corporateSectors")
    .aggregate([
      { $group: { _id: "$countryId", count: { $sum: 1 }, totalRevenue: { $sum: "$revenue" } } },
    ])
    .toArray();
  out.sectorsByCountry = sectors;

  // Traffic stats
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  out.recentPageviews = await db
    .collection("siteTrafficPageviews")
    .countDocuments({ recordedAt: { $gte: sevenDaysAgo } });
  out.recentLogins = await db
    .collection("activityLog")
    .countDocuments({ timestamp: { $gte: sevenDaysAgo } });
  out.botApiTotal = await db.collection("botApiRequestLog").countDocuments();
  out.botApiRecent = await db
    .collection("botApiRequestLog")
    .countDocuments({ createdAt: { $gte: sevenDaysAgo } });

  fs.writeFileSync("/tmp/backup-summary.json", JSON.stringify(out, null, 2));
  console.log("DONE");
  await client.close();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
