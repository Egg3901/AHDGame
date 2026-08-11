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

    // Check ALL turn logs for any CN-related CB activity
    const allLogs = await db.collection("turnLogs").find({}).sort({ turn: -1 }).limit(50).toArray();
    console.log("=== All recent turns - CB selection phase ===");
    allLogs.forEach((tl) => {
      const cb = tl.phases?.centralBankChairSelection;
      if (cb) {
        console.log(
          "Turn " +
            tl.turn +
            ": checked=" +
            cb.countriesChecked +
            " triggered=" +
            cb.selectionsTriggered +
            " political=" +
            cb.politicalPicks +
            " economic=" +
            cb.economicPicks +
            " vacancies=" +
            cb.vacanciesRemaining
        );
      }
    });

    // Check admin logs for CN central bank appointments
    const adminLogs = await db
      .collection("adminLogs")
      .find({
        $or: [
          { action: { $regex: "central_bank" } },
          { details: { $regex: "PBoC|China|CN", $options: "i" } },
        ],
      })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();

    console.log("\n=== Admin logs related to CN/PBoC ===");
    adminLogs.forEach((log) => {
      console.log(log.createdAt + ": " + log.action + " - " + log.details);
    });

    // Check if there are any characters with centralBankChair office
    const cbChairs = await db
      .collection("characters")
      .find({
        "currentOffice.type": "centralBankChair",
      })
      .toArray();

    console.log("\n=== Characters currently holding centralBankChair office ===");
    console.log("Count:", cbChairs.length);
    cbChairs.forEach((c) => {
      console.log(c.name + " (" + c.countryId + ")");
    });

    await client.close();
  })
  .catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
