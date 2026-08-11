// src/lib/inbox/inboxItem.ts
import type { NotificationType } from "@/lib/db/types/notifications";
import { categoryOf, type InboxCategory } from "./categories";
import { isActionRequired } from "./priority";
import { resolveSourceLink, type InboxSource } from "./sourceLink";
import type { MailThread } from "./mailThreads";

export type SerializedNotification = {
  _id: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  metadata?: Record<string, unknown>;
  createdAt: string;
  turn?: string;
};

export type InboxItem = {
  id: string;
  kind: "notif" | "mail";
  category: InboxCategory;
  unread: boolean;
  action: boolean;
  time: string;
  turn?: string;
  title: string;
  body: string;
  meta?: [string, string][];
  source?: InboxSource;
  counterpartName?: string;
  messages?: MailThread["messages"];
  counterpartId?: string;
};

export function relativeTime(iso: string, now: number): string {
  const diff = Math.max(0, now - Date.parse(iso));
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function notificationToInboxItem(n: SerializedNotification, now: number): InboxItem {
  const turn = typeof n.metadata?.turn === "string" ? n.metadata.turn : n.turn;
  return {
    id: n._id,
    kind: "notif",
    category: categoryOf(n.type),
    unread: !n.read,
    action: isActionRequired({ kind: "notif", unread: !n.read, type: n.type }),
    time: relativeTime(n.createdAt, now),
    turn,
    title: n.title,
    body: n.message,
    source: resolveSourceLink(n.type, n.metadata) ?? undefined,
  };
}

export function mailThreadToInboxItem(t: MailThread, now: number): InboxItem {
  return {
    id: t.id,
    kind: "mail",
    category: "party",
    unread: t.unread,
    action: isActionRequired({ kind: "mail", unread: t.unread }),
    time: relativeTime(t.latestAt, now),
    title: t.subject,
    body: t.messages[t.messages.length - 1]?.body ?? "",
    counterpartName: t.counterpartName,
    counterpartId: t.counterpartId,
    messages: t.messages,
  };
}
