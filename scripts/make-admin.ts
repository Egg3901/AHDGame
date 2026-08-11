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

  // Find character with sequentialId 195
  const char = await db.collection("characters").findOne({ sequentialId: 195 });
  if (char) {
    console.log("Found character with sequentialId 195:", {
      id: char._id.toString(),
      name: char.name,
      userId: char.userId?.toString?.() || char.userId,
      sequentialId: char.sequentialId,
    });

    // Make user admin
    const result = await db
      .collection("users")
      .updateOne(
        { _id: char.userId },
        { $set: { isAdmin: true, role: "admin", updatedAt: new Date() } }
      );
    console.log("Update result:", result);

    // Verify
    const user = await db.collection("users").findOne({ _id: char.userId });
    console.log("User isAdmin:", user?.isAdmin);
    console.log("User role:", user?.role);
  } else {
    console.log("No character with sequentialId 195");
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
