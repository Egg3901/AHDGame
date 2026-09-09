import { createHash, randomUUID } from "node:crypto";
import { ObjectId, type Db } from "mongodb";
import type { PushDevice, PushProvider } from "./types";

const indexes = new WeakMap<Db, Promise<unknown>>();
export async function pushDevices(db: Db) {
  const collection = db.collection<PushDevice>("nativePushDevices");
  let ready = indexes.get(db);
  if (!ready) {
    ready = collection
      .createIndexes([
        { key: { tokenHash: 1 }, unique: true },
        { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
        { key: { nextAttemptAt: 1, leaseUntil: 1 } },
        { key: { userId: 1 } },
      ])
      .then(() => db.collection("notifications").createIndex({ userId: 1, createdAt: 1, _id: 1 }))
      .catch((error: unknown) => {
        indexes.delete(db);
        throw error;
      });
    indexes.set(db, ready);
  }
  await ready;
  return collection;
}
export function installationHash(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
export async function registerDevice(
  db: Db,
  userId: ObjectId,
  input: {
    installation: string;
    token: string;
    provider: PushProvider;
    environment: "production" | "development";
  }
): Promise<boolean> {
  const devices = await pushDevices(db);
  const _id = installationHash(input.installation);
  const existing = await devices.findOne({ _id });
  if (!existing && (await devices.countDocuments({ userId })) >= 10) return false;
  const now = new Date();
  const sameAccount = existing?.userId.equals(userId) && existing.expiresAt > now;
  await devices.updateOne(
    { _id },
    {
      $set: {
        userId,
        token: input.token,
        provider: input.provider,
        environment: input.environment,
        tokenHash: installationHash(`${input.provider}:${input.token}`),
        revision: randomUUID(),
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
        nextAttemptAt: now,
        leaseUntil: now,
        ...(!sameAccount
          ? { cursorAt: now, cursorId: new ObjectId("000000000000000000000000") }
          : {}),
      },
    },
    { upsert: true }
  );
  return true;
}
export async function revokeDevice(db: Db, installation: string): Promise<void> {
  await (await pushDevices(db)).deleteOne({ _id: installationHash(installation) });
}
