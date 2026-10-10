import { errorResponse } from "@/lib/api/errors";
import { suppressTracing } from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { withNoStore } from "@/lib/api/withNoStore";
import { buildPushPreview, shouldPush, type PushPreview } from "@/lib/nativePush/policy";
import type { Notification } from "@/lib/db/types/notifications";
import type { User } from "@/lib/db/types/user";

/** Alerts a desktop client shows per poll; the rest are summarised as a count. */
const SHOWN = 3;
/** Notifications scanned per poll. A larger backlog drains over the next polls. */
const SCAN = 100;
/** Same window as the mobile dispatcher: an alert older than this is stale. */
const MAX_AGE_MS = 24 * 60 * 60_000;

export type PushFeedItem = Omit<PushPreview, "path" | "count">;

// GET /api/push/feed?after=<notificationId>
// Desktop AHDClient has no OS push service, so it polls this while open. It
// applies the exact mobile push policy (inbox mutes, snoozes, routine types)
// and returns each alert's own text, category and page. Without `after` it
// returns only the current cursor, so a fresh install never replays a backlog.
// Auth: requireBasicAuth
export const GET = withNoStore(async (request: Request) => {
  const auth = await requireBasicAuth();
  if (!auth.ok) return auth.response;
  const limit = checkRateLimit(`push-feed:${auth.user.userId}`, 20, 60_000);
  if (!limit.ok) return rateLimitResponse(limit.retryAfter);
  const after = new URL(request.url).searchParams.get("after");
  if (after !== null && !ObjectId.isValid(after)) return errorResponse(400, "Invalid cursor");
  try {
    return await suppressTracing(async () => {
      const db = await getDb();
      const userId = new ObjectId(auth.user.userId);
      const notifications = db.collection<Notification>("notifications");
      if (after === null) {
        const newest = await notifications.findOne(
          { userId },
          { sort: { _id: -1 }, projection: { _id: 1 } }
        );
        return NextResponse.json({ cursor: newest?._id.toString() ?? null, items: [], more: 0 });
      }
      const [user, scanned] = await Promise.all([
        db
          .collection<User>("users")
          .findOne({ _id: userId }, { projection: { notificationPreferences: 1 } }),
        notifications
          .find(
            { userId, _id: { $gt: new ObjectId(after) } },
            {
              projection: {
                type: 1,
                title: 1,
                message: 1,
                metadata: 1,
                read: 1,
                archivedAt: 1,
                snoozedUntil: 1,
                createdAt: 1,
              },
            }
          )
          .sort({ _id: 1 })
          .limit(SCAN)
          .toArray(),
      ]);
      if (!user) return errorResponse(404, "User not found");
      const now = new Date();
      const due = scanned.filter(
        (notification) =>
          notification.createdAt.getTime() > now.getTime() - MAX_AGE_MS &&
          shouldPush(notification, user.notificationPreferences ?? {}, now)
      );
      // Newest first: the alerts a player most needs are the latest ones.
      const items = due
        .slice(-SHOWN)
        .reverse()
        .map((notification): PushFeedItem => {
          const preview = buildPushPreview([notification])!;
          return {
            id: preview.id,
            title: preview.title,
            subtitle: preview.subtitle,
            body: preview.body,
            href: preview.href,
            thread: preview.thread,
          };
        });
      return NextResponse.json({
        cursor: scanned.at(-1)?._id.toString() ?? after,
        items,
        more: due.length - items.length,
      });
    });
  } catch {
    return errorResponse(503, "Alerts are unavailable right now");
  }
});
