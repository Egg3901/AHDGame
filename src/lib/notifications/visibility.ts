/** Notification preferences hide muted and currently snoozed alert types without deleting history. */
import type { NotificationPreferences } from "@/lib/db/types/notifications";

export function notificationTypeFilter(
  preferences: NotificationPreferences | undefined,
  now: Date
) {
  const hidden = [
    ...new Set([
      ...(preferences?.mutedTypes ?? []),
      ...(preferences?.snoozedTypes ?? [])
        .filter((entry) => new Date(entry.until) > now)
        .map((entry) => entry.type),
    ]),
  ];
  return hidden.length ? { type: { $nin: hidden } } : {};
}
