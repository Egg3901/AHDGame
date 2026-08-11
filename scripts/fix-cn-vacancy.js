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

    // Set vacancyAwaitingAutomaticSelection on CN bank
    const result = await db.collection("centralBanks").updateOne(
      { _id: "CN" },
      {
        $set: {
          vacancyAwaitingAutomaticSelection: true,
          updatedAt: new Date(),
        },
      }
    );

    console.log("DB update result:", JSON.stringify(result));

    // Verify
    const bank = await db.collection("centralBanks").findOne({ _id: "CN" });
    console.log(
      "CN bank vacancyAwaitingAutomaticSelection:",
      bank.vacancyAwaitingAutomaticSelection
    );

    await client.close();
  })
  .catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
