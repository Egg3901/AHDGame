// READ-ONLY: confirm no duplicate ticketNumbers and counter is pinned. No writes.
import { MongoClient } from "mongodb";
import { extractMongoDbNameFromUri, DEFAULT_MONGODB_DB_NAME } from "@/lib/mongodb";

function directConnectionUri(uri: string): string {
  return uri.includes("directConnection=") ? uri : `${uri}&directConnection=true`;
}

async function main() {
  const uri = process.env.MONGODB_URI!;
  const client = new MongoClient(directConnectionUri(uri));
  await client.connect();
  const db = client.db(extractMongoDbNameFromUri(uri) ?? DEFAULT_MONGODB_DB_NAME);
  const coll = db.collection("tickets");

  const dups = await coll
    .aggregate([
      { $group: { _id: "$ticketNumber", n: { $sum: 1 }, chans: { $push: "$discordChannelId" } } },
      { $match: { n: { $gt: 1 } } },
    ])
    .toArray();
  console.log(`duplicate ticketNumbers: ${dups.length}`);
  for (const d of dups) console.log(`  #${d._id} x${d.n} -> ${d.chans.join(", ")}`);

  const chanDups = await coll
    .aggregate([
      { $match: { discordChannelId: { $ne: null } } },
      { $group: { _id: "$discordChannelId", n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ])
    .toArray();
  console.log(`duplicate discordChannelIds: ${chanDups.length}`);

  const counter = await db.collection("counters").findOne({ _id: "tickets" as any });
  const maxDoc = await coll.findOne(
    {},
    { projection: { ticketNumber: 1 }, sort: { ticketNumber: -1 } }
  );
  console.log(`counter seq = ${counter?.seq}, max ticketNumber = ${maxDoc?.ticketNumber}`);
  console.log(
    counter?.seq >= (maxDoc?.ticketNumber ?? 0) ? "OK: counter >= max" : "WARN: counter behind max"
  );
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
