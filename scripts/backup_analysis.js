const fs = require("fs");
const raw = fs.readFileSync(".env.local", "utf8");
raw.split("\n").forEach((line) => {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});
const { MongoClient } = require("mongodb");

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("ahd_backup_temp");

  const results = {};

  // 1. Game state
  const gs = await db.collection("gameState").findOne({ _id: "current" });
  results.gameState = gs;

  // 2. Game config
  const gc = await db.collection("gameConfig").findOne({ _id: "default" });
  results.gameConfig = {
    isActive: gc?.isActive,
    maintenanceMode: gc?.maintenanceMode,
    testMode: gc?.testMode,
    forexEnabled: gc?.forexEnabled,
    nppEconomyEnabled: gc?.nppEconomyEnabled,
    indexFundsEnabled: gc?.indexFundsEnabled,
    registrationEnabled: gc?.registrationEnabled,
  };

  // 3. Characters count and breakdown
  const charCount = await db.collection("characters").countDocuments();
  const charsByCountry = await db
    .collection("characters")
    .aggregate([{ $group: { _id: "$countryId", count: { $sum: 1 } } }, { $sort: { count: -1 } }])
    .toArray();
  results.characters = { total: charCount, byCountry: charsByCountry };

  // 4. Users count
  const userCount = await db.collection("users").countDocuments();
  const recentUsers = await db.collection("users").countDocuments({
    lastLogin: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
  });
  results.users = { total: userCount, activeLast7Days: recentUsers };

  // 5. Federal budgets - revenue, spending, debt
  const budgets = await db.collection("federalBudget").find({}).toArray();
  results.federalBudgets = budgets.map((b) => ({
    _id: b._id,
    countryId: b.countryId,
    gdp: b.gdp,
    surplus: b.surplus,
    revenue: b.revenue?.total,
    spending: b.spending?.total,
    debtToGdpRatio: b.debtToGdpRatio,
    economicFactors: b.economicFactors,
  }));

  // 6. Central banks - inflation, prime rates
  const banks = await db.collection("centralBanks").find({}).toArray();
  results.centralBanks = banks.map((b) => ({
    _id: b._id,
    countryId: b.countryId,
    primeRate: b.primeRate,
    latestInflation:
      b.inflationHistory?.length > 0 ? b.inflationHistory[b.inflationHistory.length - 1] : null,
    latestInterestRate:
      b.interestRateHistory?.length > 0
        ? b.interestRateHistory[b.interestRateHistory.length - 1]
        : null,
    latestGdpGrowth:
      b.gdpGrowthHistory?.length > 0 ? b.gdpGrowthHistory[b.gdpGrowthHistory.length - 1] : null,
  }));

  // 7. Exchange rates
  const fx = await db.collection("exchangeRates").find({}).toArray();
  results.exchangeRates = fx.map((f) => ({
    _id: f._id,
    countryId: f.countryId,
    currencyCode: f.currencyCode,
    rate: f.rate,
    baseRate: f.baseRate,
    macroTarget: f.macroTarget,
  }));

  // 8. Commodity prices
  const commodities = await db.collection("commodityPrices").find({}).toArray();
  results.commodityPrices = commodities.map((c) => ({
    commodity: c.commodity,
    globalPrice: c.globalPrice,
    basePrice: c.basePrice,
    globalSupply: c.globalSupply,
    globalDemand: c.globalDemand,
    supplyDemandRatio:
      c.globalDemand && c.globalSupply ? (c.globalDemand / c.globalSupply).toFixed(2) : null,
    priceRatio: c.globalPrice && c.basePrice ? (c.globalPrice / c.basePrice).toFixed(2) : null,
  }));

  // 9. Political parties - treasury, PS
  const parties = await db.collection("politicalParties").find({}).toArray();
  results.politicalParties = parties.map((p) => ({
    name: p.name,
    countryId: p.countryId,
    sequentialId: p.sequentialId,
    treasury: p.treasury,
    politicalStrength: p.politicalStrength,
    memberCount: p.memberCount,
    nationalTaxRate: p.nationalTaxRate,
    regimeStatus: p.regimeStatus,
  }));

  // 10. Top corporations by market cap
  const topCorps = await db
    .collection("corporations")
    .aggregate([
      { $match: { isPrivate: { $ne: true } } },
      { $addFields: { marketCap: { $multiply: ["$sharePrice", "$totalShares"] } } },
      { $sort: { marketCap: -1 } },
      { $limit: 15 },
      {
        $project: {
          name: 1,
          countryId: 1,
          sharePrice: 1,
          totalShares: 1,
          publicFloat: 1,
          marketCap: 1,
          liquidCapital: 1,
          isPrivate: 1,
        },
      },
    ])
    .toArray();
  results.topCorporations = topCorps;

  // 11. Largest recent financial transactions (by amount)
  const largeTxs = await db
    .collection("financialTxLog")
    .aggregate([
      { $sort: { _id: -1 } },
      { $limit: 5000 },
      { $addFields: { absAmount: { $abs: "$amount" } } },
      { $sort: { absAmount: -1 } },
      { $limit: 10 },
      {
        $project: {
          type: 1,
          subjectName: 1,
          counterpartyName: 1,
          amount: 1,
          currencyCode: 1,
          turn: 1,
          createdAt: 1,
        },
      },
    ])
    .toArray();
  results.largestRecentTxs = largeTxs;

  // 12. Elections overview
  const activeElections = await db
    .collection("elections")
    .countDocuments({ status: { $in: ["active", "voting"] } });
  const upcomingElections = await db.collection("elections").countDocuments({ status: "upcoming" });
  const electionTypes = await db
    .collection("elections")
    .aggregate([
      {
        $group: {
          _id: { type: "$electionType", countryId: "$countryId", status: "$status" },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ])
    .toArray();
  results.elections = {
    active: activeElections,
    upcoming: upcomingElections,
    byType: electionTypes.slice(0, 20),
  };

  // 13. Country states
  const countryStates = await db.collection("countryState").find({}).toArray();
  results.countryStates = countryStates;

  // 14. Wire events - recent large transfers
  const recentWires = await db
    .collection("wireEvents")
    .find({})
    .sort({ _id: -1 })
    .limit(10)
    .toArray();
  results.recentWireEvents = recentWires;

  // 15. Share trades - recent
  const recentTrades = await db
    .collection("shareTradeHistory")
    .find({})
    .sort({ _id: -1 })
    .limit(15)
    .toArray();
  results.recentShareTrades = recentTrades.map((t) => ({
    kind: t.kind,
    corpId: t.corporationId,
    from: t.from?.name,
    to: t.to?.name,
    pricePerShare: t.pricePerShareAnchor,
    total: t.totalAnchor,
    turn: t.turn,
  }));

  // 16. Corporation votes - recent
  const corpVotes = await db
    .collection("corporationVotes")
    .find({})
    .sort({ _id: -1 })
    .limit(10)
    .toArray();
  results.recentCorpVotes = corpVotes.map((v) => ({
    corpId: v.corporationId,
    type: v.type,
    status: v.status,
    proposedBy: v.proposedByCharacterId,
  }));

  // 17. Bonds
  const bonds = await db.collection("bonds").find({}).toArray();
  const activeBonds = bonds.filter((b) => b.status === "active" || b.status === "issued");
  results.bonds = {
    total: bonds.length,
    active: activeBonds.length,
    details: activeBonds.map((b) => ({
      countryId: b.countryId,
      turn: b.turn,
      couponRate: b.couponRate,
      totalAmount: b.totalAmount,
      status: b.status,
    })),
  };

  // 18. Tariffs
  const tariffs = await db.collection("tariffs").find({}).toArray();
  results.tariffs = tariffs;

  // 19. State party elections
  const statePartyElec = await db.collection("statePartyElections").countDocuments();
  const natPartyElec = await db.collection("nationalPartyElections").countDocuments();
  results.partyElections = { stateParty: statePartyElec, nationalParty: natPartyElec };

  // 20. Crisis/regime escalation
  const regime = await db.collection("regimeEscalation").find({}).toArray();
  results.regimeEscalation = regime;

  // 21. Stock exchange snapshots
  const exchanges = await db.collection("stockExchangeSnapshots").find({}).toArray();
  results.stockExchanges = exchanges.map((e) => ({
    _id: e._id,
    listingsCount: e.listings?.length || 0,
    topListings: (e.listings || []).slice(0, 5).map((l) => ({
      name: l.name,
      ticker: l.ticker,
      sharePrice: l.sharePrice,
      marketCap: l.marketCap,
    })),
  }));

  // 22. NPPs count
  const nppCount = await db.collection("npps").countDocuments();
  results.npps = { count: nppCount };

  // 23. Turn logs - recent
  const recentTurnLogs = await db
    .collection("turnLogs")
    .find({})
    .sort({ turn: -1 })
    .limit(3)
    .toArray();
  results.recentTurnLogs = recentTurnLogs.map((t) => ({
    turn: t.turn,
    duration: t.duration,
    createdAt: t.createdAt,
  }));

  // 24. Treasury transactions - recent large ones
  const largeTreasTxs = await db
    .collection("treasuryTransactions")
    .aggregate([
      { $addFields: { absAmount: { $abs: "$amount" } } },
      { $sort: { absAmount: -1 } },
      { $limit: 10 },
      {
        $project: {
          partyId: 1,
          holderType: 1,
          category: 1,
          direction: 1,
          amount: 1,
          currencyCode: 1,
          memo: 1,
          turn: 1,
        },
      },
    ])
    .toArray();
  results.largeTreasuryTxs = largeTreasTxs;

  // 25. Party budgets
  const partyBudgets = await db.collection("partyBudget").find({}).toArray();
  results.partyBudgets = partyBudgets.map((pb) => ({
    partyId: pb.partyId,
    scope: pb.scope,
    countryId: pb.countryId,
    gotvBudgetPercent: pb.gotvBudgetPercent,
    suppressionBudgetPercent: pb.suppressionBudgetPercent,
    orgBuildingPercent: pb.orgBuildingPercent,
  }));

  console.log(JSON.stringify(results, null, 2));
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
