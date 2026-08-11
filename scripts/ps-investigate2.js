require("dotenv").config({ path: ".env.local" });
const { MongoClient } = require("mongodb");

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("a-house-divided");

  // Find Ashton Gilbert character
  const char = await db.collection("characters").findOne({ name: "Ashton Gilbert" });
  if (!char) {
    console.log("Character not found");
    await client.close();
    return;
  }

  // Get his party
  const party = await db
    .collection("politicalParties")
    .findOne({ countryId: "UK", sequentialId: 2 });

  // Get all party members
  const members = await db.collection("characters").find({ countryId: "UK", party: "2" }).toArray();

  console.log("=== PARTY INFLUENCE BONUS CALCULATION ===");
  console.log("Party:", party?.name, "- members:", members.length);

  const totalInfluence = members.reduce((sum, c) => sum + (c.partyInfluence ?? 0), 0);
  console.log("Total party influence across all members:", totalInfluence);

  // Calculate Ashtons share
  const poolMultiplier = 3;
  const maxBonus = 6;
  const totalPool = poolMultiplier * members.length;

  // Compute closeness (simplified - assume perfect alignment for max)
  const closeness = 1.0; // max
  const rawShare = (char.partyInfluence / totalInfluence) * totalPool;
  const bonusActions = Math.min(maxBonus, Math.floor(rawShare * closeness));

  console.log("\nAshtons party influence:", char.partyInfluence);
  console.log("Total pool:", totalPool, "(3 x", members.length, "members)");
  console.log("Raw share:", rawShare);
  console.log("Bonus actions (capped at 6):", bonusActions);

  // Calculate total expected refresh
  const baseActions = 4;
  const officeBonus = 4; // primeMinister
  const chairBonus = 0;
  const totalRefresh = baseActions + officeBonus + chairBonus + bonusActions;

  console.log("\n=== TOTAL EXPECTED REFRESH ===");
  console.log("Base:", baseActions);
  console.log("Office (PM):", officeBonus);
  console.log("Chair:", chairBonus);
  console.log("Party bonus:", bonusActions);
  console.log("TOTAL:", totalRefresh);

  console.log("\n=== PLAYER CLAIM: 40 per turn ===");
  console.log("Actual:", totalRefresh);
  console.log("Gap:", 40 - totalRefresh);

  // Check if theres any other source of actions were missing
  // Check if he has any leadership role in party
  const isChair = party?.chairId?.toString() === char._id.toString();
  const isViceChair = party?.viceChairId?.toString() === char._id.toString();
  const isTreasurer = party?.treasurerId?.toString() === char._id.toString();

  console.log("\nParty leadership roles:");
  console.log("  Chair:", isChair);
  console.log("  Vice Chair:", isViceChair);
  console.log("  Treasurer:", isTreasurer);

  // Leadership bonus in party influence turn
  let leadershipBonus = 0;
  if (isChair) leadershipBonus += 3;
  if (isViceChair) leadershipBonus += 2;
  if (isTreasurer) leadershipBonus += 2;
  console.log("Party influence leadership bonus:", leadershipBonus);

  await client.close();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
