require("dotenv").config({ path: "/root/projects/a-house-divided/.env.local" });
const { MongoClient, ObjectId } = require("mongodb");

async function run() {
  const baseUri = process.env.MONGODB_URI;
  const sep = baseUri.includes("?") ? "&" : "?";
  const uri = baseUri + sep + "directConnection=true";
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("a-house-divided");

  // 1. Find north's character(s) — search by various name patterns
  const charPatterns = ["north", "ovo", "OVO"];
  const chars = [];
  for (const p of charPatterns) {
    const results = await db
      .collection("characters")
      .find({
        $or: [
          { name: { $regex: p, $options: "i" } },
          { displayName: { $regex: p, $options: "i" } },
        ],
      })
      .project({ sequentialId: 1, name: 1, displayName: 1, countryId: 1, userId: 1 })
      .toArray();
    chars.push(...results);
  }
  // Dedupe
  const charMap = {};
  for (const c of chars) charMap[c._id.toString()] = c;
  const allChars = Object.values(charMap);
  console.log("\n=== Characters found ===");
  allChars.forEach((c) =>
    console.log(`  ${c.name} (seqId:${c.sequentialId}, country:${c.countryId}, _id:${c._id})`)
  );

  // 2. Find OVO/north's corporations by CEO
  const charIds = allChars.map((c) => c._id);
  const userCorps = [];
  if (charIds.length > 0) {
    const corps = await db
      .collection("corporations")
      .find({
        ceoId: { $in: charIds },
      })
      .project({
        _id: 1,
        name: 1,
        type: 1,
        secondaryType: 1,
        countryId: 1,
        isPrivate: 1,
        sharePrice: 1,
        liquidCapital: 1,
        totalShares: 1,
        publicFloat: 1,
        rdScore: 1,
        rdBudget: 1,
        marketingBudget: 1,
        marketingStrength: 1,
        logisticsBudget: 1,
        logisticsStrength: 1,
        dividendRate: 1,
        headquartersState: 1,
        foundedAtTurn: 1,
        legalStructure: 1,
        currencyCode: 1,
      })
      .toArray();
    userCorps.push(...corps);
  }
  console.log("\n=== North/OVO's Corporations ===");
  console.log(`Found ${userCorps.length} corps`);
  userCorps.forEach((c) =>
    console.log(
      `  ${c.name} (${c._id}) type=${c.type}/${c.secondaryType || "-"} country=${c.countryId} private=${c.isPrivate} HQ=${c.headquartersState} founded=${c.foundedAtTurn} rdScore=${c.rdScore} rdBudget=${c.rdBudget} mktg=${c.marketingStrength}(${c.markingBudget}) logistics=${c.logisticsStrength}(${c.logisticsBudget}) dividend=${c.dividendRate}%`
    )
  );

  // 3. Find JP Morgan
  const jp = await db
    .collection("corporations")
    .findOne({ name: { $regex: "jp morgan", $options: "i" } });
  console.log("\n=== JP Morgan ===");
  if (jp) {
    console.log(
      `  ${jp.name} (${jp._id}) type=${jp.type}/${jp.secondaryType || "-"} country=${jp.countryId} private=${jp.isPrivate} HQ=${jp.headquartersState} founded=${jp.foundedAtTurn} rdScore=${jp.rdScore} rdBudget=${jp.rdBudget} mktg=${jp.marketingStrength}(${jp.marketingBudget}) logistics=${jp.logisticsStrength}(${jp.logisticsBudget}) dividend=${jp.dividendRate}%`
    );
  } else {
    console.log("  NOT FOUND — searching broader financial firms...");
    const finCorps = await db
      .collection("corporations")
      .find({ type: "financial" })
      .project({ _id: 1, name: 1, countryId: 1, rdScore: 1, rdBudget: 1 })
      .toArray();
    finCorps.forEach((c) =>
      console.log(
        `    ${c.name} (${c._id}) country=${c.countryId} rdScore=${c.rdScore} rdBudget=${c.rdBudget}`
      )
    );
  }

  // 4. Compare top US public corps by revenue (from latest corporationHistory)
  console.log("\n=== Top 30 US Corps by Latest Revenue ===");
  const usCorpIds = await db
    .collection("corporations")
    .find({ countryId: "US" })
    .project({
      _id: 1,
      name: 1,
      type: 1,
      secondaryType: 1,
      rdScore: 1,
      rdBudget: 1,
      marketingStrength: 1,
      logisticsStrength: 1,
      dividendRate: 1,
      foundedAtTurn: 1,
      isPrivate: 1,
      currencyCode: 1,
    })
    .toArray();
  const usCorpMap = {};
  for (const c of usCorpIds) usCorpMap[c._id.toString()] = c;

  // Fetch latest history for each US corp
  const usHistIds = usCorpIds.map((c) => new ObjectId(c._id));
  const pipeline = [
    { $match: { corporationId: { $in: usHistIds } } },
    { $sort: { turn: -1 } },
    { $group: { _id: "$corporationId", latest: { $first: "$$ROOT" } } },
  ];
  const latestUSHist = await db.collection("corporationHistory").aggregate(pipeline).toArray();
  const usRows = [];
  for (const lh of latestUSHist) {
    const corp = usCorpMap[lh._id.toString()];
    if (!corp) continue;
    const h = lh.latest;
    usRows.push({
      name: corp.name,
      type: corp.type,
      founded: corp.foundedAtTurn,
      private: corp.isPrivate,
      rdScore: corp.rdScore,
      rdBudget: corp.rdBudget,
      marketing: corp.marketingStrength,
      logistics: corp.logisticsStrength,
      dividend: corp.dividendRate,
      turn: h.turn,
      revenue: h.revenue,
      income: h.income,
      margin: h.marginDiagnostic?.effectiveMargin,
      sectorNPV: h.sectorNPV,
      liquidCapital: h.liquidCapital,
      corpTax: h.corporateTaxPaid,
      fedTax: h.federalTaxPaid,
      stateTax: h.stateTaxPaid,
      marketingMarketCap: h.sharePrice * h.totalShares,
    });
  }
  usRows.sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
  console.log(
    "name | type | founded | priv | rev | inc | margin | rdScore | rdBudget | mktg | log | div% | sectorNPV | liquid"
  );
  for (const r of usRows.slice(0, 30)) {
    console.log(
      `${r.name} | ${r.type} | T${r.founded} | ${r.private} | ${(r.revenue || 0).toLocaleString()} | ${(r.income || 0).toLocaleString()} | ${(r.margin * 100 || 0).toFixed(1)}% | ${r.rdScore} | ${r.rdBudget} | ${r.marketing} | ${r.logistics} | ${r.dividend}% | ${(r.sectorNPV || 0).toFixed(0)} | ${(r.liquidCapital || 0).toFixed(0)}`
    );
  }

  // 5. Get sectors for user's corps AND for top revenue corp (JP Morgan or known like SAP/Rockefeller)
  const topCorpsToCompare = [userCorps[0], jp].filter(Boolean);
  for (const cmp of topCorpsToCompare) {
    if (!cmp) continue;
    console.log(`\n=== Sector breakdown for ${cmp.name} (${cmp._id}) ===`);
    const sectors = await db
      .collection("corporateSectors")
      .find({ corporationId: new ObjectId(cmp._id) })
      .toArray();
    sectors.forEach((s) =>
      console.log(
        `  ${s.sectorType} / ${s.stateId} / ${s.countryId} rev=${s.revenue} margin=${s.profitMargin} workers=${s.workers} prodPolicy=${s.productionPolicyLevel} targetGrowth=${s.targetGrowthRate} growthCost=${s.currentGrowthCost}`
      )
    );

    // recent income history
    console.log("--- last 6 turns income history ---");
    const hist = await db
      .collection("corporationHistory")
      .find({ corporationId: new ObjectId(cmp._id) })
      .sort({ turn: -1 })
      .limit(6)
      .toArray();
    for (const hh of hist.reverse()) {
      console.log(
        `  T${hh.turn} rev=${(hh.revenue || 0).toLocaleString()} inc=${(hh.income || 0).toLocaleString()} margin=${(hh.marginDiagnostic?.effectiveMargin * 100 || 0).toFixed(1)}% sectorNPV=${(hh.sectorNPV || 0).toFixed(0)} macroMod=${(hh.marginDiagnostic?.macroMod || 0).toFixed(2)}pp stateMetricsMod=${(hh.marginDiagnostic?.stateMetricsMod || 0).toFixed(2)}pp commodityInputMod=${(hh.marginDiagnostic?.commodityInputMod || 0).toFixed(2)}pp growthCostRatio=${(hh.marginDiagnostic?.growthCostRatio || 0).toFixed(3)}`
      );
    }

    // Marketing/logistics/r&d reference (need full corp, re-fetch)
    const fullCorp = await db.collection("corporations").findOne({ _id: new ObjectId(cmp._id) });
    console.log("--- full corp investment fields ---");
    console.log(
      JSON.stringify(
        {
          rdScore: fullCorp.rdScore,
          rdBudget: fullCorp.rdBudget,
          rdIncomeMultiplier: fullCorp.rdIncomeMultiplier,
          marketingBudget: fullCorp.marketingBudget,
          marketingStrength: fullCorp.marketingStrength,
          marketingShare: fullCorp.marketingShare,
          logisticsBudget: fullCorp.logisticsBudget,
          logisticsStrength: fullCorp.logisticsStrength,
          dividendRate: fullCorp.dividendRate,
          dividendsPaidPerTurn: fullCorp.dividendsPaidPerTurn,
          orderFlowMultiplier: fullCorp.orderFlowMultiplier,
          creditRating: fullCorp.creditRatingSnapshot,
          liquidCapital: fullCorp.liquidCapital,
        },
        null,
        2
      )
    );
  }

  await client.close();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
