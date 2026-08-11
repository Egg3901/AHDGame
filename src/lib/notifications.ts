import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { NotificationType, Notification } from "@/lib/db/types";

export interface NotificationInput {
  userId: ObjectId;
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

function toDoc(input: NotificationInput): Omit<Notification, "_id"> {
  return {
    userId: input.userId,
    type: input.type,
    title: input.title,
    message: input.message,
    read: false,
    metadata: input.metadata,
    createdAt: new Date(),
  };
}

export async function createNotification(opts: NotificationInput): Promise<void> {
  try {
    const db = await getDb();
    await db.collection<Omit<Notification, "_id">>("notifications").insertOne(toDoc(opts));
  } catch (err) {
    // Non-fatal — log but don't crash the caller
    console.error("[createNotification] Failed:", err);
  }
}

/**
 * Batch insert notifications. Use when a single turn-phase or write path
 * needs to notify many recipients — collect inputs into an array and call
 * once instead of looping createNotification (one DB round-trip vs. N).
 *
 * Empty arrays are a no-op. Failures are swallowed and logged so the caller
 * does not crash a turn over a notification side effect.
 */
export async function createNotifications(inputs: NotificationInput[]): Promise<void> {
  if (inputs.length === 0) return;
  try {
    const db = await getDb();
    await db.collection<Omit<Notification, "_id">>("notifications").insertMany(inputs.map(toDoc));
  } catch (err) {
    console.error("[createNotifications] Failed:", err);
  }
}
