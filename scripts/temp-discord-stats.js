require("dotenv").config({ path: ".env.local" });
const { MongoClient } = require("mongodb");
async function run() {
  const client = new MongoClient(process.env.MONGODB_URI, { directConnection: true });
  await client.connect();
  const db = client.db("a-house-divided");
  const total = await db.collection("discord_messages").countDocuments();
  console.log("total discord_messages:", total);
  const authors = await db
    .collection("discord_messages")
    .aggregate([
      { $match: { content: { $exists: true, $ne: "" } } },
      { $group: { _id: "$author", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 30 },
    ])
    .toArray();
  console.log(JSON.stringify(authors, null, 2));
  const channels = await db
    .collection("discord_messages")
    .aggregate([
      { $group: { _id: "$channelName", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 30 },
    ])
    .toArray();
  console.log(JSON.stringify(channels, null, 2));
  await client.close();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
