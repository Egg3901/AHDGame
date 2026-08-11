require("dotenv").config({ path: "/root/projects/a-house-divided/.env.local" });
const { MongoClient, ObjectId } = require("mongodb");

async function run() {
  const baseUri = process.env.MONGODB_URI;
  const sep = baseUri.includes("?") ? "&" : "?";
  const client = new MongoClient(baseUri + sep + "directConnection=true");
  await client.connect();
  const db = client.db("a-house-divided");

  // 1. Search users
  console.log("=== users matching north/ovo ===");
  const users = await db
    .collection("users")
    .find({
      $or: [
        { username: { $regex: "north|ovo", $options: "i" } },
        { displayName: { $regex: "north|ovo", $options: "i" } },
        { discordUsername: { $regex: "north|ovo", $options: "i" } },
      ],
    })
    .project({
      _id: 1,
      username: 1,
      displayName: 1,
      discordUsername: 1,
      discordId: 1,
      accountCountryId: 1,
      activeCharacterId: 1,
    })
    .toArray();
  users.forEach((u) =>
    console.log(
      `  user: ${u.username} / ${u.displayName} / discord=${u.discordUsername} id=${u.discordId} country=${u.accountCountryId} activeCharId=${u.activeCharacterId} _id=${u._id}`
    )
  );

  // 2. Get all characters for these users
  const userIds = users.map((u) => u._id);
  const userChars = [];
  if (userIds.length > 0) {
    const c = await db
      .collection("characters")
      .find({ userId: { $in: userIds } })
      .project({ sequentialId: 1, name: 1, countryId: 1, userId: 1 })
      .toArray();
    userChars.push(...c);
  }
  // Also search characters by name
  const nameChars = await db
    .collection("characters")
    .find({
      name: { $regex: "north|ovo", $options: "i" },
    })
    .project({ sequentialId: 1, name: 1, countryId: 1, userId: 1 })
    .toArray();
  console.log("\n=== characters found ===");
  const charMap = {};
  for (const c of [...userChars, ...nameChars]) charMap[c._id.toString()] = c;
  const allChars = Object.values(charMap);
  allChars.forEach((c) =>
    console.log(
      `  char: ${c.name} (seqId:${c.sequentialId}) country=${c.countryId} userId=${c.userId}`
    )
  );

  // 3. Find corporations by CEO match (chars we found)
  const charIds = allChars.map((c) => c._id);
  let userCorps = [];
  if (charIds.length > 0) {
    userCorps = await db
      .collection("corporations")
      .find({
        $or: [{ ceoId: { $in: charIds } }, { foundersCharacterIds: { $in: charIds } }],
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
        currencyCode: 1,
      })
      .toArray();
  }
  // Also search by corp name
  const corpNameMatches = await db
    .collection("corporations")
    .find({
      name: { $regex: "ovo|north", $options: "i" },
    })
    .project({ _id: 1, name: 1, type: 1, countryId: 1, ceoId: 1 })
    .toArray();

  console.log("\n=== user's corps (any) ===");
  userCorps.forEach((c) =>
    console.log(
      `  ${c.name} (${c._id}) type=${c.type}/${c.secondaryType || "-"} country=${c.countryId} private=${c.isPrivate} HQ=${c.headquartersState} founded=${c.foundedAtTurn} rdScore=${c.rdScore} rdBudget=${c.rdBudget} mktg=${c.marketingStrength}(${c.marketingBudget}) logistics=${c.logisticsStrength}(${c.logisticsBudget}) dividend=${c.dividendRate}%`
    )
  );

  console.log("\n=== corps matching 'ovo/north' in name ===");
  corpNameMatches.forEach((c) =>
    console.log(`  ${c.name} (${c._id}) type=${c.type} country=${c.countryId} ceoId=${c.ceoId}`)
  );

  // 4. For each user corp, get latest corp history + sectors
  for (const cmp of userCorps.slice(0, 3)) {
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

    console.log("--- last 6 turns income history ---");
    const hist = await db
      .collection("corporationHistory")
      .find({ corporationId: new ObjectId(cmp._id) })
      .sort({ turn: -1 })
      .limit(6)
      .toArray();
    for (const hh of hist.reverse()) {
      console.log(
        `  T${hh.turn} rev=${(hh.revenue || 0).toLocaleString()} inc=${(hh.income || 0).toLocaleString()} margin=${((hh.marginDiagnostic?.effectiveMargin || 0) * 100).toFixed(2)}% sectorNPV=${(hh.sectorNPV || 0).toFixed(0)} macroMod=${(hh.marginDiagnostic?.macroMod || 0).toFixed(2)}pp stateMetricsMod=${(hh.marginDiagnostic?.stateMetricsMod || 0).toFixed(2)}pp commodityInputMod=${(hh.marginDiagnostic?.commodityInputMod || 0).toFixed(2)}pp growthCostRatio=${(hh.marginDiagnostic?.growthCostRatio || 0).toFixed(3)}`
      );
    }

    // Full corp investment fields
    const fullCorp = await db.collection("corporations").findOne({ _id: new ObjectId(cmp._id) });
    console.log("--- full corp investment fields ---");
    console.log(
      JSON.stringify(
        {
          rdScore: fullCorp.rdScore,
          rdBudget: fullCorp.rdBudget,
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
          currencyCode: fullCorp.currencyCode,
          type: fullCorp.type,
          secondaryType: fullCorp.secondaryType,
          unlockedTechNodes: Array.isArray(fullCorp.unlockedTechNodes)
            ? fullCorp.unlockedTechNodes.length
            : fullCorp.unlockedTechNodes
              ? Object.keys(fullCorp.unlockedTechNodes)
              : 0,
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
