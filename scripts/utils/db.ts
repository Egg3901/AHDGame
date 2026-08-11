import { MongoClient, Db } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

let client: MongoClient | null = null;

export async function connectDb(): Promise<Db> {
  if (!client) {
    // Resolved lazily (not at module load) so importing this module — e.g. the
    // migration registry pulling in a script-wrapped migration under vitest —
    // does not require a MongoDB URI until a connection is actually opened.
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error("Please add your MongoDB URI to .env.local");
    }
    client = new MongoClient(uri);
    await client.connect();
    console.log("Connected to MongoDB");
  }
  return client.db();
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    console.log("Disconnected from MongoDB");
  }
}
