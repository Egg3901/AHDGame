require("dotenv").config({ path: "./.env.local" });

(async () => {
  const { MongoClient } = require("mongodb");
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("a-house-divided");

  // Search for corps with Goldman in name
  const goldmanCorps = await db
    .collection("corporations")
    .find({
      name: { $regex: "Goldman", $options: "i" },
    })
    .toArray();

  console.log(
    "Goldman corps:",
    goldmanCorps.map((c) => ({ name: c.name, id: c._id.toString(), ceoId: c.ceoId?.toString() }))
  );

  // Search for characters with Marty or Goldman
  const chars = await db
    .collection("characters")
    .find({
      $or: [
        { name: { $regex: "Marty", $options: "i" } },
        { name: { $regex: "Goldman", $options: "i" } },
      ],
    })
    .toArray();

  console.log(
    "\nCharacters:",
    chars.map((c) => ({ name: c.name, id: c._id.toString(), countryId: c.countryId }))
  );

  await client.close();
})();
