import { MongoClient, type Admin } from "mongodb";
import { assertSingleplayerAllowed } from "@/lib/singleplayer";

const REPLICA_SET = "ahd-local";

/** Initialize only the loopback mongod owned by the singleplayer launcher.
 * Existing data stays in place. External/hosted Mongo is never reconfigured.
 */
export async function prepareManagedMongo(uri: string): Promise<void> {
  assertSingleplayerAllowed();
  const address = new URL(uri);
  if (address.protocol !== "mongodb:" || address.hostname !== "127.0.0.1")
    throw new Error("Managed singleplayer MongoDB must use loopback.");
  const client = new MongoClient(uri, {
    directConnection: true,
    serverSelectionTimeoutMS: 5_000,
    socketTimeoutMS: 5_000,
  });
  try {
    await client.connect();
    await initializeLocalReplicaSet(client.db("admin").admin(), address.host);
  } finally {
    await client.close();
  }
}

export async function initializeLocalReplicaSet(
  admin: Pick<Admin, "command">,
  host: string
): Promise<void> {
  try {
    const status = await admin.command({ replSetGetStatus: 1 });
    if (
      status.set !== REPLICA_SET ||
      status.members?.length !== 1 ||
      status.members[0].name !== host
    )
      throw new Error(
        "The local replica set configuration does not match this launch. Restore its original MongoDB port."
      );
  } catch (error) {
    if ((error as { code?: number }).code !== 94) throw error;
    try {
      await admin.command({ replSetInitiate: { _id: REPLICA_SET, members: [{ _id: 0, host }] } });
    } catch (initError) {
      // Another server worker may win first initialization.
      if ((initError as { code?: number }).code !== 23) throw initError;
    }
  }
  const deadline = performance.now() + 30_000;
  do {
    const hello = await admin.command({ hello: 1 });
    if (hello.isWritablePrimary && hello.setName === REPLICA_SET) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (performance.now() < deadline);
  throw new Error("The local database did not elect its primary within 30 seconds.");
}
