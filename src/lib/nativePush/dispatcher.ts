import { suppressTracing } from "@sentry/nextjs";
import { randomUUID } from "node:crypto";
import { type Db } from "mongodb";
import type { Notification } from "@/lib/db/types/notifications";
import type { User } from "@/lib/db/types/user";
import { pushDevices } from "./devices";
import { shouldPush } from "./policy";
import { providerConfigured, sendNativePush } from "./providers";
import type { PushDevice } from "./types";

async function deliverDevice(db: Db, device: PushDevice): Promise<void> {
  const devices = await pushDevices(db);
  const owned = { _id: device._id, revision: device.revision };
  const now = new Date();
  const user = await db.collection<User>("users").findOne(
    { _id: device.userId },
    {
      projection: { notificationPreferences: 1 },
    }
  );
  if (!user) {
    await devices.deleteOne(owned);
    return;
  }
  const notifications = await db
    .collection<Notification>("notifications")
    .find(
      {
        userId: device.userId,
        $or: [
          { createdAt: { $gt: device.cursorAt } },
          { createdAt: device.cursorAt, _id: { $gt: device.cursorId } },
        ],
      },
      { projection: { type: 1, read: 1, archivedAt: 1, snoozedUntil: 1, createdAt: 1 } }
    )
    .sort({ createdAt: 1, _id: 1 })
    .limit(500)
    .toArray();
  const candidate = notifications.some(
    (notification) =>
      notification.createdAt.getTime() > now.getTime() - 24 * 60 * 60_000 &&
      shouldPush(notification, user.notificationPreferences ?? {}, now)
  );
  // Revocation or an account switch invalidates a leased delivery.
  if (!(await devices.findOne(owned, { projection: { _id: 1 } }))) return;
  const result = candidate ? await sendNativePush(device) : "sent";
  if (result === "invalid") {
    await devices.deleteOne(owned);
    return;
  }
  const last = notifications.at(-1);
  await devices.updateOne(owned, {
    $set: {
      leaseUntil: now,
      nextAttemptAt: new Date(now.getTime() + (result === "retry" ? 5 : 1) * 60_000),
      ...(result === "sent" && last ? { cursorAt: last.createdAt, cursorId: last._id } : {}),
    },
  });
}

/** Read the existing inbox outside the turn loop, with leases across replicas. */
async function dispatch(db: Db): Promise<void> {
  const providers = (["fcm", "apns"] as const).filter(providerConfigured);
  if (!providers.length) return;
  const devices = await pushDevices(db);
  const started = Date.now();
  // Four workers, at most two hundred devices per sweep. Sorting due time keeps
  // large installations fair across sweeps without a full collection scan.
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let attempt = 0; attempt < 50 && Date.now() - started < 45_000; attempt++) {
        const now = new Date();
        const device = await devices.findOneAndUpdate(
          {
            provider: { $in: providers },
            nextAttemptAt: { $lte: now },
            leaseUntil: { $lte: now },
            expiresAt: { $gt: now },
          },
          { $set: { leaseUntil: new Date(now.getTime() + 2 * 60_000), revision: randomUUID() } },
          {
            sort: { nextAttemptAt: 1 },
            returnDocument: "after",
          }
        );
        if (!device) return;
        try {
          await deliverDevice(db, device);
        } catch {
          /* Lease expiry retries transient database failures without logging device data. */
        }
      }
    })
  );
}

export function dispatchNativePush(db: Db): Promise<void> {
  return suppressTracing(() => dispatch(db));
}
