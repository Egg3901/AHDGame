import type { Notification, NotificationPreferences } from "@/lib/db/types/notifications";
import { categoryOf, type InboxCategory } from "@/lib/inbox/categories";
import { notificationLabel } from "@/lib/inbox/presentation";
import { resolveSourceLink } from "@/lib/inbox/sourceLink";

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

/** The inbox route. 2.3.x apps only act on a push whose `path` is exactly this. */
export const INBOX_PATH = "/notifications";

/** Used when a notification has no readable text of its own. */
export const PUSH_PREVIEW = {
  title: "A House Divided",
  body: "You have new activity. Open your inbox to catch up.",
  path: INBOX_PATH,
};

export interface PushPreview {
  title: string;
  /** Category, plus how many more alerts arrived with this one. */
  subtitle: string;
  body: string;
  path: typeof INBOX_PATH;
  /** Same-origin page the newest alert is about, or the inbox. */
  href: string;
  /** Inbox category key, used to group alerts on the device. */
  thread: string;
  /** Unread alerts this delivery covers. The newest one is shown. */
  count: number;
  /** Newest notification id, so a retried delivery replaces itself. */
  id: string;
}

/** Same names as the inbox category chips. */
const CATEGORY_LABELS: Record<InboxCategory, string> = {
  crisis: "Crisis",
  legislation: "Legislation",
  election: "Election",
  party: "Party",
  standing: "Standing",
  treasury: "Treasury",
  system: "System",
};

const TITLE_LIMIT = 90;
const BODY_LIMIT = 360;

function clean(text: unknown, limit: number): string {
  if (typeof text !== "string") return "";
  const flat = text
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1).trimEnd()}…` : flat;
}

/** A relative path on this site. Absolute, protocol-relative and odd paths fall back to the inbox. */
export function safePushHref(href: string | undefined): string {
  if (!href || href.length > 300 || !/^\/(?![/\\])[^\s\\]*$/.test(href)) return INBOX_PATH;
  return href;
}

/**
 * What a device shows for the unread alerts since its last delivery: the
 * newest alert's own title and message, its inbox category, and the page it
 * links to. `notifications` is oldest first, as the dispatcher reads them.
 */
export function buildPushPreview(
  notifications: Pick<Notification, "_id" | "type" | "title" | "message" | "metadata">[]
): PushPreview | null {
  const newest = notifications.at(-1);
  if (!newest) return null;
  const thread = categoryOf(newest.type);
  const category = CATEGORY_LABELS[thread];
  const extra = notifications.length - 1;
  return {
    title: clean(newest.title, TITLE_LIMIT) || notificationLabel(newest.type),
    subtitle: extra > 0 ? `${category} · ${extra} more in your inbox` : category,
    body: clean(newest.message, BODY_LIMIT) || PUSH_PREVIEW.body,
    path: INBOX_PATH,
    href: safePushHref(resolveSourceLink(newest.type, newest.metadata)?.href),
    thread,
    count: notifications.length,
    id: newest._id.toString(),
  };
}
