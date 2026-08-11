import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set");
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  // Find characters with '195' in their slug or name
  const chars = await db
    .collection("characters")
    .find({
      $or: [{ slug: { $regex: "195" } }, { name: { $regex: "195" } }],
    })
    .limit(5)
    .toArray();

  console.log(
    "Characters matching 195:",
    chars.map((c) => ({ id: c._id.toString(), slug: c.slug, name: c.name }))
  );

  // Check if there's a numeric ID field
  const withNumericId = await db.collection("characters").find({ numericId: 195 }).toArray();
  console.log("By numericId 195:", withNumericId.length);

  // Show sample slugs
  const allSlugs = await db
    .collection("characters")
    .find()
    .project({ slug: 1, name: 1 })
    .limit(10)
    .toArray();
  console.log(
    "Sample slugs:",
    allSlugs.map((c) => ({ slug: c.slug, name: c.name }))
  );

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
