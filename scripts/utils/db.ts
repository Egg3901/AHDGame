import { MongoClient, Db } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

let client: MongoClient | null = null;
let clientUri: string | null = null;
let connectAttempt: Promise<MongoClient> | null = null;
let connectAttemptUri: string | null = null;
let connectAttemptToken: object | null = null;
let closeAttempt: Promise<void> | null = null;

export async function connectDb(databaseName?: string, uriOverride?: string): Promise<Db> {
  const uri = uriOverride ?? process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Please add your MongoDB URI to .env.local");
  }

  if (closeAttempt) await closeAttempt;

  if (client) {
    assertSameUri(uri, clientUri);
    return client.db(databaseName);
  }

  if (connectAttempt) {
    assertSameUri(uri, connectAttemptUri);
    const attemptToken = connectAttemptToken;
    if (!attemptToken) {
      throw new Error("MongoDB connection was closed while connecting");
    }
    const attempt = connectAttempt;
    const connectedClient = await attempt;
    if (connectAttemptToken !== attemptToken) {
      throw new Error("MongoDB connection was closed while connecting");
    }
    return connectedClient.db(databaseName);
  }

  // Resolve lazily so importing this module does not require a URI or open a
  // connection. Keep a URI identity alongside the shared in-flight attempt so
  // concurrent calls cannot silently reuse a client for another deployment.
  const nextClient = new MongoClient(uri);
  const attemptToken = {};
  const attempt: Promise<MongoClient> = (async () => {
    try {
      await nextClient.connect();
      if (connectAttemptToken === attemptToken) {
        client = nextClient;
        clientUri = uri;
        console.log("Connected to MongoDB");
      }
      return nextClient;
    } catch (error) {
      if (connectAttemptToken === attemptToken) {
        connectAttempt = null;
        connectAttemptUri = null;
        connectAttemptToken = null;
      }
      try {
        await nextClient.close();
      } catch {
        // Preserve the original connection error; the failed client is discarded.
      }
      throw error;
    }
  })();
  connectAttempt = attempt;
  connectAttemptUri = uri;
  connectAttemptToken = attemptToken;

  const connectedClient = await attempt;
  if (connectAttemptToken !== attemptToken) {
    throw new Error("MongoDB connection was closed while connecting");
  }
  return connectedClient.db(databaseName);
}

export async function closeDb(): Promise<void> {
  if (closeAttempt) return closeAttempt;

  const connectedClient = client;
  const pendingConnect = connectAttempt;
  client = null;
  clientUri = null;
  connectAttempt = null;
  connectAttemptUri = null;
  connectAttemptToken = null;

  const attempt = (async () => {
    const clientToClose = connectedClient ?? (await pendingConnect?.catch(() => null));
    if (clientToClose) {
      await clientToClose.close();
      console.log("Disconnected from MongoDB");
    }
  })();
  closeAttempt = attempt;
  try {
    await attempt;
  } finally {
    if (closeAttempt === attempt) closeAttempt = null;
  }
}

function assertSameUri(requestedUri: string, connectedUri: string | null): void {
  if (requestedUri !== connectedUri) {
    throw new Error("MongoDB client is already connected to a different URI; close it first");
  }
}
