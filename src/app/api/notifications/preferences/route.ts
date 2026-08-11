import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { withNoStore } from "@/lib/api/withNoStore";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { notificationPreferenceActionSchema } from "@/lib/api/schemas/notifications";
import type { User } from "@/lib/db/types";
import type { NotificationType, NotificationSnoozedEntry } from "@/lib/db/types/notifications";
import { ObjectId } from "mongodb";

// GET /api/notifications/preferences — Returns the authenticated user's notification mute and snooze preferences, expiring stale snoozes
// Auth: requireBasicAuth
// Errors: 401, 404
export const GET = withNoStore(async () => {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const db = await getDb();
    const userId = new ObjectId(user.userId);
    const dbUser = await db.collection<User>("users").findOne({ _id: userId });
    if (!dbUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const prefs = dbUser.notificationPreferences ?? {};
    const now = new Date();

    // Auto-expire stale snoozes
    const activeSnoozed = (prefs.snoozedTypes ?? []).filter((s) => new Date(s.until) > now);

    if (activeSnoozed.length !== (prefs.snoozedTypes ?? []).length) {
      await db
        .collection<User>("users")
        .updateOne(
          { _id: userId },
          { $set: { "notificationPreferences.snoozedTypes": activeSnoozed } }
        );
    }

    return NextResponse.json({
      mutedTypes: prefs.mutedTypes ?? [],
      snoozedTypes: activeSnoozed.map((s) => ({
        type: s.type,
        until: s.until,
      })),
    });
  } catch (err) {
    return handleRouteError(err);
  }
});

// PUT /api/notifications/preferences — Updates the authenticated user's notification mute or snooze preference for a given type
// Auth: requireBasicAuth
// Errors: 400, 401, 404, 429
export async function PUT(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const rateLimit = checkRateLimit(user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, notificationPreferenceActionSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { action, type } = parsed.data;

    const db = await getDb();
    const userId = new ObjectId(user.userId);
    const dbUser = await db.collection<User>("users").findOne({ _id: userId });
    if (!dbUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const prefs = dbUser.notificationPreferences ?? {};
    let mutedTypes: NotificationType[] = prefs.mutedTypes ?? [];
    let snoozedTypes: NotificationSnoozedEntry[] = (prefs.snoozedTypes ?? []).filter(
      (s) => new Date(s.until) > new Date()
    );

    if (action === "mute") {
      if (!mutedTypes.includes(type)) mutedTypes = [...mutedTypes, type];
      snoozedTypes = snoozedTypes.filter((s) => s.type !== type);
    } else if (action === "unmute") {
      mutedTypes = mutedTypes.filter((t) => t !== type);
    } else if (action === "snooze") {
      const until = new Date(Date.now() + 12 * 60 * 60 * 1000);
      snoozedTypes = snoozedTypes.filter((s) => s.type !== type);
      snoozedTypes = [...snoozedTypes, { type, until }];
      mutedTypes = mutedTypes.filter((t) => t !== type);
    } else if (action === "unsnooze") {
      snoozedTypes = snoozedTypes.filter((s) => s.type !== type);
    }

    await db
      .collection<User>("users")
      .updateOne(
        { _id: userId },
        { $set: { notificationPreferences: { mutedTypes, snoozedTypes } } }
      );

    return NextResponse.json({ success: true, mutedTypes, snoozedTypes });
  } catch (err) {
    return handleRouteError(err, { request, route: "/api/notifications/preferences PUT" });
  }
}
