import type { Notification, NotificationPreferences } from "@/lib/db/types/notifications";

/** Push follows inbox mutes and snoozes. Routine turn income stays in the inbox. */
export function shouldPush(
  notification: Pick<Notification, "type" | "read" | "archivedAt" | "snoozedUntil">,
  preferences: NotificationPreferences,
  now: Date
): boolean {
  return (
    !notification.read &&
    !notification.archivedAt &&
    !(notification.snoozedUntil && notification.snoozedUntil > now) &&
    !["welcome", "turn_advance", "resource_income", "new_post"].includes(notification.type) &&
    !preferences.mutedTypes?.includes(notification.type) &&
    !preferences.snoozedTypes?.some((s) => s.type === notification.type && new Date(s.until) > now)
  );
}

/** No player text, account identifiers or remote destinations enter a lock-screen payload. */
export const PUSH_PREVIEW = {
  title: "A House Divided",
  body: "You have new activity. Open your inbox to catch up.",
  path: "/notifications",
};
