// Read-only: inspect Missouri state metrics + baselines to ground-truth ticket #909.
const { MongoClient } = require("mongodb");
const d = (u) => (u.includes("directConnection=") ? u : `${u}&directConnection=true`);

(async () => {
  const c = new MongoClient(d(process.env.MONGODB_URI));
  await c.connect();
  const db = c.db(process.env.MONGODB_DB || undefined);

  // Find Missouri (US)
  const mo = await db
    .collection("states")
    .findOne(
      { countryId: "US", $or: [{ name: /missouri/i }, { abbreviation: "MO" }, { _id: /MO/ }] },
      { projection: { name: 1, abbreviation: 1, population: 1 } }
    );
  console.log("STATE:", JSON.stringify(mo));
  if (!mo) {
    await c.close();
    return;
  }

  const id = mo._id;
  const sm = await db.collection("stateMetrics").findOne({ _id: id });
  const pick = (o, cat, m) => o?.[cat]?.[m];
  console.log("\n=== stateMetrics (value) ===");
  for (const [cat, m] of [
    ["infrastructure", "broadbandAccess"],
    ["infrastructure", "publicTransit"],
    ["infrastructure", "transportEfficiency"],
    ["infrastructure", "infrastructureInvestmentGap"],
    ["education", "educationSpending"],
    ["education", "highSchoolGradRate"],
    ["education", "collegeEnrollment"],
    ["education", "universityEnrollment"],
  ]) {
    const v = pick(sm, cat, m);
    console.log(`${cat}.${m}:`, v && typeof v === "object" ? JSON.stringify(v) : v);
  }

  const bl = await db.collection("stateBaselines").findOne({ _id: id });
  console.log("\n=== stateBaselines ===");
  console.log("infrastructure:", JSON.stringify(bl?.baselines?.infrastructure));
  console.log("education:", JSON.stringify(bl?.baselines?.education));

  // Game state / era flag
  const gs = await db
    .collection("gameState")
    .findOne(
      { _id: "current" },
      { projection: { currentTurn: 1, currentYear: 1, startingYear: 1, eraSystemEnabled: 1 } }
    );
  console.log("\n=== gameState ===", JSON.stringify(gs));

  await c.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
