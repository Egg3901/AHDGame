// Backup Report Data Extraction — 2026-06-06
require("dotenv").config({ path: ".env.local" });
const { MongoClient } = require("mongodb");
const fs = require("fs");

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("a-house-divided");

  const output = {};

  // === PART 1: Backup Inventory ===

  // List all collections with doc counts
  const collections = await db.listCollections().toArray();
  const collectionStats = [];
  for (const col of collections) {
    try {
      const count = await db.collection(col.name).countDocuments();
      if (count > 0) {
        collectionStats.push({ name: col.name, count });
      }
    } catch {
      /* skip */
    }
  }
  collectionStats.sort((a, b) => b.count - a.count);
  output.collectionStats = collectionStats;
  output.totalCollections = collections.length;
  output.nonEmptyCollections = collectionStats.length;
  output.totalDocuments = collectionStats.reduce((s, c) => s + c.count, 0);

  // Top 20 largest collections
  output.top20Collections = collectionStats.slice(0, 20);

  // === PART 2: Game State Snapshot ===

  // Game state
  output.gameState = await db.collection("gameState").findOne({ _id: "current" });
  output.gameConfig = await db.collection("gameConfig").findOne({ _id: "default" });

  // Countries
  output.countryStates = await db.collection("countryState").find({}).toArray();

  // Commodity prices
  output.commodityPrices = await db.collection("commodityPrices").find({}).toArray();

  // Exchange rates
  output.exchangeRates = await db.collection("exchangeRates").find({}).toArray();

  // Central banks
  output.centralBanks = await db.collection("centralBanks").find({}).toArray();

  // Federal budgets
  output.federalBudgets = await db.collection("federalBudget").find({}).toArray();

  // Users summary
  const totalUsers = await db.collection("users").countDocuments();
  const adminUsers = await db.collection("users").countDocuments({ role: "admin" });
  const playerUsers = await db.collection("users").countDocuments({ role: "player" });
  output.userStats = { total: totalUsers, admins: adminUsers, players: playerUsers };

  // Characters summary
  const totalCharacters = await db.collection("characters").countDocuments();
  const retiredCharacters = await db.collection("retiredCharacters").countDocuments();
  output.characterStats = { active: totalCharacters, retired: retiredCharacters };

  // Corporations summary
  const totalCorps = await db.collection("corporations").countDocuments();
  const publicCorps = await db.collection("corporations").countDocuments({ isPrivate: false });
  const privateCorps = await db.collection("corporations").countDocuments({ isPrivate: true });

  // Top corporations by market cap (public only)
  const topCorps = await db
    .collection("corporations")
    .find(
      { isPrivate: false },
      {
        projection: {
          name: 1,
          sharePrice: 1,
          totalShares: 1,
          publicFloat: 1,
          liquidCapital: 1,
          countryId: 1,
        },
      }
    )
    .toArray();
  topCorps.forEach((c) => {
    c.marketCap = (c.sharePrice || 0) * (c.totalShares || 0);
  });
  topCorps.sort((a, b) => b.marketCap - a.marketCap);

  output.corporationStats = { total: totalCorps, public: publicCorps, private: privateCorps };
  output.top15Corporations = topCorps.slice(0, 15).map((c) => ({
    name: c.name,
    countryId: c.countryId,
    sharePrice: c.sharePrice,
    totalShares: c.totalShares,
    marketCap: c.marketCap,
    liquidCapital: c.liquidCapital,
    publicFloat: c.publicFloat,
  }));

  // Elections summary
  const activeElections = await db
    .collection("elections")
    .countDocuments({ status: { $in: ["active", "voting"] } });
  const resolvedElections = await db.collection("elections").countDocuments({ status: "resolved" });
  output.electionStats = { active: activeElections, resolved: resolvedElections };

  // Political parties
  output.politicalParties = await db.collection("politicalParties").find({}).toArray();

  // States count per country
  const statesByCountry = await db
    .collection("states")
    .aggregate([{ $group: { _id: "$countryId", count: { $sum: 1 } } }])
    .toArray();
  output.statesByCountry = statesByCountry;

  // Character wealth by country
  const wealthByCountry = await db
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
  output.wealthByCountry = wealthByCountry;

  // Corporate sectors summary
  const sectorsByCountry = await db
    .collection("corporateSectors")
    .aggregate([
      {
        $group: { _id: "$countryId", sectorCount: { $sum: 1 }, totalRevenue: { $sum: "$revenue" } },
      },
    ])
    .toArray();
  output.sectorsByCountry = sectorsByCountry;

  // NPPs count
  const nppCount = await db.collection("npps").countDocuments();
  output.nppCount = nppCount;

  // Site traffic (last 7 days count)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentPageviews = await db
    .collection("siteTrafficPageviews")
    .countDocuments({ recordedAt: { $gte: sevenDaysAgo } });
  output.recentPageviews = recentPageviews;

  // Activity log (last 7 days)
  const recentActivity = await db
    .collection("activityLog")
    .countDocuments({ timestamp: { $gte: sevenDaysAgo } });
  output.recentLogins = recentActivity;

  // Bot API usage
  const botApiRequests = await db.collection("botApiRequestLog").countDocuments();
  const recentBotApi = await db
    .collection("botApiRequestLog")
    .countDocuments({ createdAt: { $gte: sevenDaysAgo } });
  output.botApiStats = { total: botApiRequests, last7d: recentBotApi };

  // Stock exchange snapshots
  output.stockExchanges = await db.collection("stockExchangeSnapshots").find({}).toArray();

  // Savings ledger summary
  const savingsStats = await db
    .collection("savingsLedger")
    .aggregate([
      {
        $group: {
          _id: "$currencyCode",
          count: { $sum: 1 },
          totalBalance: { $sum: "$balance" },
          avgBalance: { $avg: "$balance" },
        },
      },
    ])
    .toArray();
  output.savingsStats = savingsStats;

  // Bonds summary
  const bondStats = await db
    .collection("bonds")
    .aggregate([
      { $group: { _id: "$countryId", count: { $sum: 1 }, totalAmount: { $sum: "$totalAmount" } } },
    ])
    .toArray();
  output.bondStats = bondStats;

  fs.writeFileSync("/tmp/backup-report-data.json", JSON.stringify(output, null, 2));
  console.log("DONE — wrote /tmp/backup-report-data.json");
  console.log("Collections:", output.totalCollections, "| Non-empty:", output.nonEmptyCollections);
  console.log("Total documents:", output.totalDocuments);
  console.log(
    "Users:",
    output.userStats.total,
    "| Characters:",
    output.characterStats.active,
    "(retired:",
    output.characterStats.retired,
    ")"
  );
  console.log(
    "Corporations:",
    output.corporationStats.total,
    "| Turn:",
    output.gameState?.currentTurn
  );

  await client.close();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
