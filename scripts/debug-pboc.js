const fs = require("fs");
const content = fs.readFileSync(".env.local", "utf8");
const match = content.match(/MONGODB_URI=(.+)/);
const uri = match[1].trim();
const { MongoClient } = require("mongodb");
const client = new MongoClient(uri);

client
  .connect()
  .then(async () => {
    const db = client.db("a-house-divided");

    // 1. Get current game state
    const gameState = await db.collection("gameState").findOne({ _id: "current" });
    console.log("=== Game State ===");
    console.log("Current turn:", gameState?.currentTurn);
    console.log("Last turn processed:", gameState?.lastTurnProcessed);

    // 2. Get Jack Ma character
    const jackMa = await db.collection("characters").findOne({ name: "Jack Ma", countryId: "CN" });
    console.log("\n=== Jack Ma Character ===");
    console.log("Character ID:", jackMa?._id?.toString());
    console.log("User ID:", jackMa?.userId?.toString());
    console.log("Cash on hand:", jackMa?.cashOnHand);
    console.log("Current office:", JSON.stringify(jackMa?.currentOffice));

    // 3. Check if Jack Ma is in top 20 wealthiest for CN
    const cnChars = await db
      .collection("characters")
      .find({
        countryId: "CN",
        userId: { $exists: true },
      })
      .project({ _id: 1, name: 1, cashOnHand: 1, currencyBalances: 1 })
      .toArray();

    console.log("\n=== CN Player Characters (top by cash) ===");
    cnChars.sort((a, b) => (b.cashOnHand ?? 0) - (a.cashOnHand ?? 0));
    cnChars.slice(0, 10).forEach((c, i) => {
      console.log(i + 1 + ". " + c.name + " - cash: " + (c.cashOnHand?.toLocaleString() ?? 0));
    });

    const jackMaRank = cnChars.findIndex((c) => c.name === "Jack Ma");
    console.log("\nJack Ma cash rank:", jackMaRank >= 0 ? jackMaRank + 1 : "Not found");

    // 4. Check recent turn logs for centralBankChairSelection
    const turnLogs = await db
      .collection("turnLogs")
      .find({
        "phases.centralBankChairSelection": { $exists: true },
      })
      .sort({ turn: -1 })
      .limit(5)
      .toArray();

    console.log("\n=== Recent Turn Logs with CB Chair Selection ===");
    turnLogs.forEach((tl) => {
      const cbPhase = tl.phases?.centralBankChairSelection;
      console.log("Turn " + tl.turn + ":", JSON.stringify(cbPhase, null, 2));
    });

    // 5. Check if there are any pending selections across all banks
    const pendingBanks = await db
      .collection("centralBanks")
      .find({
        chairSelectionPending: { $ne: null },
      })
      .toArray();

    console.log("\n=== Banks with Pending Selections ===");
    console.log("Count:", pendingBanks.length);
    pendingBanks.forEach((b) => {
      console.log(
        b._id +
          ": pending " +
          b.chairSelectionPending.characterName +
          " (" +
          b.chairSelectionPending.pool +
          ") since turn " +
          b.chairSelectionPending.proposedAtTurn
      );
    });

    // 6. Check ALL CN lobbying entries ever
    const bank = await db.collection("centralBanks").findOne({ _id: "CN" });
    console.log("\n=== ALL PBoC Lobbying Entries ===");
    console.log("Total entries:", bank?.lobbyingPool?.length ?? 0);
    (bank?.lobbyingPool ?? []).forEach((e, i) => {
      console.log(
        i +
          1 +
          ". " +
          e.targetCharacterName +
          " - " +
          e.amount.toLocaleString() +
          " by " +
          e.lobbyistCharacterId?.toString() +
          " at " +
          e.createdAt
      );
    });

    await client.close();
  })
  .catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
