import { connectDb, closeDb } from "./utils/db";

async function check() {
  const db = await connectDb();
  const states = await db
    .collection("states")
    .find({ abbreviation: { $in: ["ENG", "SCO", "WAL", "NIR"] } })
    .toArray();
  console.log("UK regions found:", states.length);
  console.log(JSON.stringify(states, null, 2));
  await closeDb();
}

check().catch(console.error);
