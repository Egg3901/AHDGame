import { z } from "zod";
import { schemas } from "../validate";
import { NOTIFICATION_TYPES } from "@/lib/db/types/notifications";

export const notificationsPatchSchema = z.object({
  id: schemas.objectId.optional(),
  /** When marking all read, limit to this bundled account (must be in bundle). */
  forUserId: schemas.objectId.optional(),
  /** When marking all read, limit to notifications tagged for this character (metadata.recipientCharacterId). */
  forCharacterId: schemas.objectId.optional(),
  action: z.enum(["read", "archive", "unarchive", "snooze", "unsnooze"]).optional(),
  snoozeMinutes: z
    .number()
    .int()
    .min(5)
    .max(7 * 24 * 60)
    .optional(),
});

export type NotificationsPatchBody = z.infer<typeof notificationsPatchSchema>;

export const notificationPreferenceActionSchema = z.object({
  action: z.enum(["mute", "unmute", "snooze", "unsnooze"]),
  type: z.enum(NOTIFICATION_TYPES),
});

export type NotificationPreferenceActionBody = z.infer<typeof notificationPreferenceActionSchema>;
