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

    // Check ALL central banks for lobbying pools and chair status
    const banks = await db.collection("centralBanks").find({}).toArray();
    console.log("=== All Central Banks ===");
    banks.forEach((b) => {
      console.log(
        b._id +
          ": chair=" +
          (b.chairCharacterName ?? "VACANT") +
          " termExpires=" +
          (b.chairTermExpiresAtTurn ?? "null") +
          " pending=" +
          (b.chairSelectionPending ? b.chairSelectionPending.characterName : "none") +
          " lobbyCount=" +
          (b.lobbyingPool?.length ?? 0) +
          " nomCount=" +
          (b.nominations?.length ?? 0)
      );
    });

    // Check when the last chair was appointed for CN
    const cnBank = banks.find((b) => b._id === "CN");
    console.log("\n=== CN Bank History ===");
    console.log("chairAppointedAt:", cnBank?.chairAppointedAt);
    console.log("chairAppointedBy:", cnBank?.chairAppointedBy?.toString());
    console.log("createdAt:", cnBank?.createdAt);

    // Check if there was EVER a chair for CN
    const allTurnLogs = await db
      .collection("turnLogs")
      .find({
        "phases.centralBankChairSelection.selectionsTriggered": { $gt: 0 },
      })
      .sort({ turn: -1 })
      .limit(20)
      .toArray();

    console.log("\n=== Turns where CB selection actually triggered ===");
    allTurnLogs.forEach((tl) => {
      const cb = tl.phases?.centralBankChairSelection;
      console.log(
        "Turn " +
          tl.turn +
          ": triggered=" +
          cb.selectionsTriggered +
          " political=" +
          cb.politicalPicks +
          " economic=" +
          cb.economicPicks +
          " vacancies=" +
          cb.vacanciesRemaining
      );
    });

    await client.close();
  })
  .catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
