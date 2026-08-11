require("dotenv").config({ path: ".env.local" });
const { MongoClient } = require("mongodb");

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("a-house-divided");
  const gs = await db.collection("gameState").findOne({ _id: "current" });
  const _currentTurn = gs.currentTurn;

  // Find Ashton Gilbert character
  const char = await db.collection("characters").findOne({ name: "Ashton Gilbert" });
  if (!char) {
    console.log("Character not found");
    await client.close();
    return;
  }

  // Check character stats — PS might be nested under stats or a different field
  console.log(
    "Character keys:",
    Object.keys(char).filter(
      (k) =>
        k.toLowerCase().includes("political") ||
        k.toLowerCase().includes("strength") ||
        k.toLowerCase().includes("stat")
    )
  );
  console.log("\nFull stats object:", JSON.stringify(char.stats, null, 2));
  console.log("\nFull character (relevant fields):");
  console.log("  actionsRemaining:", char.actionsRemaining);
  console.log("  actionsPerTurn:", char.actionsPerTurn);
  console.log("  politicalStrength:", char.politicalStrength);
  console.log("  basePS:", char.basePS);
  console.log("  psPerTurn:", char.psPerTurn);
  console.log("  stats:", JSON.stringify(char.stats));
  console.log("  turn:", char.turn);
  console.log("  lastTurnProcessed:", char.lastTurnProcessed);

  // Check gameConfig for PS generation settings
  const gc = await db.collection("gameConfig").findOne({ _id: "default" });
  console.log("\nGameConfig psGenerationRate:", gc?.psGenerationRate);
  console.log("GameConfig psPerTurn:", gc?.psPerTurn);
  console.log("GameConfig basePS:", gc?.basePS);

  // Check if there's a per-country or per-character PS setting
  const countryState = await db.collection("countryState").findOne({ _id: char.countryId });
  console.log(
    "\nCountryState keys:",
    Object.keys(countryState || {}).filter(
      (k) =>
        k.toLowerCase().includes("political") ||
        k.toLowerCase().includes("strength") ||
        k.toLowerCase().includes("action")
    )
  );

  // Check all action logs for this character (not just PS-related) to see what actions they've taken
  const allLogs = await db
    .collection("actionLogs")
    .find({ characterId: char._id })
    .sort({ turn: -1 })
    .limit(20)
    .toArray();
  console.log("\nAll recent action logs:", allLogs.length);
  allLogs.forEach((l) =>
    console.log(
      "  turn",
      l.turn,
      "-",
      l.actionType,
      "- cost:",
      l.actionCost,
      "- result:",
      JSON.stringify(l.result).substring(0, 200)
    )
  );

  await client.close();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
