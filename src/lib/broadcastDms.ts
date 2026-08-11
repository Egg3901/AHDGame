/**
 * Broadcast DM queue.
 *
 * Documents are inserted into this collection by an external ops tool, not
 * by this repo. The discord-bot API only reads pending entries and marks
 * them delivered or failed, so this module carries just the collection name
 * and the document shape.
 */
import { ObjectId } from "mongodb";

export const BROADCAST_DMS_COLLECTION = "broadcastDms";

export interface BroadcastDmDoc {
  _id: ObjectId;
  broadcastId: string;
  discordId: string;
  title: string;
  body: string;
  imageUrl?: string | null;
  url?: string | null;
  queuedAt: Date;
  deliveredAt: Date | null;
  failedAt?: Date | null;
}
