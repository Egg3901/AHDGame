import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { withNoStore } from "@/lib/api/withNoStore";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseObjectId } from "@/lib/utils/objectId";
import { parseJsonBody } from "@/lib/api/validate";
import { notificationsPatchSchema } from "@/lib/api/schemas/notifications";
import type { Notification } from "@/lib/db/types";
import type { User } from "@/lib/db/types/user";
import type { Character } from "@/lib/db/types/character";
import {
  getNotificationBundleUserIds,
  resolveAccountFilter,
  resolveCharacterProfileFilter,
} from "@/lib/notifications/notificationBundle";

const notificationsDeleteSchema = z.object({
  id: z.string().optional(),
  ids: z.array(z.string()).optional(),
  deleteAll: z.boolean().optional(),
});

async function loadBundleContext(db: Db, userId: ObjectId) {
  const user = await db
    .collection<User>("users")
    .findOne({ _id: userId }, { projection: { _id: 1, notificationBundleUserIds: 1 } });
  if (!user) return null;
  const bundleUserIds = getNotificationBundleUserIds(user);
  const labelDocs = await db
    .collection<User>("users")
    .find({ _id: { $in: bundleUserIds } })
    .project<{ _id: ObjectId; username: string; displayName: string }>({
      username: 1,
      displayName: 1,
    })
    .toArray();
  const labelById = new Map(labelDocs.map((d) => [d._id.toString(), d]));
  const notificationAccounts = bundleUserIds.map((id) => {
    const row = labelById.get(id.toString());
    return {
      id: id.toString(),
      username: row?.username ?? "?",
      displayName: row?.displayName ?? row?.username ?? "?",
    };
  });
  return { bundleUserIds, notificationAccounts };
}

// GET /api/notifications — Paginated notifications; supports bundled accounts via `account` query param
// Auth: requireBasicAuth
// Errors: 401
export const GET = withNoStore(async (request: Request) => {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const offset = parseInt(searchParams.get("offset") || "0");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100); // Max 100
    const type = searchParams.get("type");
    const search = searchParams.get("search");
    const accountParam = searchParams.get("account");
    const profileParam = searchParams.get("profile");

    const db = await getDb();
    const userId = new ObjectId(auth.user.userId);

    const ctx = await loadBundleContext(db, userId);
    if (!ctx) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { bundleUserIds, notificationAccounts } = ctx;
    const accountResolution = resolveAccountFilter(accountParam, bundleUserIds);
    if (!accountResolution.ok) {
      return NextResponse.json({ error: "Invalid account filter" }, { status: 400 });
    }
    const queryUserIds = accountResolution.userIds;

    const profileScopeCharacters = await db
      .collection<Character>("characters")
      .find(
        { userId: { $in: queryUserIds } },
        { projection: { _id: 1, name: 1, userId: 1, avatarUrl: 1 } }
      )
      .toArray();
    const allowedCharacterIds = new Set(profileScopeCharacters.map((c) => c._id.toString()));
    const profileResolution = resolveCharacterProfileFilter(profileParam, allowedCharacterIds);
    if (!profileResolution.ok) {
      return NextResponse.json({ error: "Invalid profile filter" }, { status: 400 });
    }

    const query: Record<string, unknown> = { userId: { $in: queryUserIds } };
    if (profileResolution.characterId) {
      query["metadata.recipientCharacterId"] = profileResolution.characterId;
    }
    if (type && type !== "all") {
      query.type = type;
    }
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { message: { $regex: search, $options: "i" } },
      ];
    }

    const include = (searchParams.get("include") ?? "").split(",");
    if (!include.includes("archived")) query.archivedAt = { $exists: false };
    if (!include.includes("snoozed")) {
      query.$and = [
        ...(Array.isArray(query.$and) ? (query.$and as unknown[]) : []),
        { $or: [{ snoozedUntil: { $exists: false } }, { snoozedUntil: { $lte: new Date() } }] },
      ];
    }

    interface FacetResult {
      notifications: Notification[];
      total: { count: number }[];
    }

    const [unreadByUserAgg, unreadByCharacterAgg, listResult, unreadForScope] = await Promise.all([
      db
        .collection<Notification>("notifications")
        .aggregate<{ _id: ObjectId; count: number }>([
          { $match: { userId: { $in: bundleUserIds }, read: false } },
          { $group: { _id: "$userId", count: { $sum: 1 } } },
        ])
        .toArray(),
      db
        .collection<Notification>("notifications")
        .aggregate<{ _id: string; count: number }>([
          {
            $match: {
              userId: { $in: queryUserIds },
              read: false,
              "metadata.recipientCharacterId": { $exists: true, $type: "string", $ne: "" },
            },
          },
          { $group: { _id: "$metadata.recipientCharacterId", count: { $sum: 1 } } },
        ])
        .toArray(),
      db
        .collection<Notification>("notifications")
        .aggregate<FacetResult>([
          { $match: query },
          {
            $facet: {
              notifications: [{ $sort: { createdAt: -1 } }, { $skip: offset }, { $limit: limit }],
              total: [{ $count: "count" }],
            },
          },
        ])
        .toArray(),
      db.collection<Notification>("notifications").countDocuments({
        ...query,
        read: false,
      }),
    ]);

    const result = listResult[0];
    const notifications = result?.notifications ?? [];
    const total = result?.total[0]?.count ?? 0;

    const unreadByUserId: Record<string, number> = {};
    for (const row of unreadByUserAgg) {
      unreadByUserId[row._id.toString()] = row.count;
    }

    const unreadByCharacterId: Record<string, number> = {};
    for (const row of unreadByCharacterAgg) {
      if (row._id) unreadByCharacterId[row._id] = row.count;
    }

    const nameByCharacterId = new Map(
      profileScopeCharacters.map((c) => [
        c._id.toString(),
        { name: c.name, avatarUrl: c.avatarUrl },
      ])
    );

    const notificationProfiles = profileScopeCharacters.map((c) => ({
      id: c._id.toString(),
      name: c.name,
      userId: c.userId.toString(),
    }));

    return NextResponse.json({
      notifications: notifications.map((n) => {
        const rid =
          typeof n.metadata?.recipientCharacterId === "string"
            ? n.metadata.recipientCharacterId
            : undefined;
        const meta = rid ? nameByCharacterId.get(rid) : undefined;
        return {
          ...n,
          _id: n._id.toString(),
          userId: n.userId.toString(),
          ...(meta ? { profileLabel: meta.name, avatarUrl: meta.avatarUrl } : {}),
        };
      }),
      unreadCount: unreadForScope,
      unreadByUserId,
      unreadByCharacterId,
      total,
      hasMore: offset + notifications.length < total,
      notificationAccounts,
      hasBundledAccounts: bundleUserIds.length > 1,
      hasMultipleProfiles: notificationProfiles.length > 1,
      notificationProfiles,
    });
  } catch (err) {
    return handleRouteError(err);
  }
});

// PATCH /api/notifications — Mark read (one or all); supports bundled accounts via forUserId
// Auth: requireBasicAuth
// Errors: 400, 401, 429
export async function PATCH(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, notificationsPatchSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { id, forUserId, forCharacterId } = parsed.data;
    const db = await getDb();
    const userId = new ObjectId(auth.user.userId);

    const user = await db
      .collection<User>("users")
      .findOne({ _id: userId }, { projection: { _id: 1, notificationBundleUserIds: 1 } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const bundleUserIds = getNotificationBundleUserIds(user);
    const bundleSet = new Set(bundleUserIds.map((x) => x.toString()));

    if (id) {
      const notificationOid = parseObjectId(id);
      if (!notificationOid) {
        return NextResponse.json({ error: "Invalid notification ID" }, { status: 400 });
      }
      const action = parsed.data.action ?? "read";
      const filter = { _id: notificationOid, userId: { $in: bundleUserIds } };
      const col = db.collection<Notification>("notifications");
      if (action === "read") {
        await col.updateOne(filter, { $set: { read: true } });
      } else if (action === "archive") {
        await col.updateOne(filter, { $set: { archivedAt: new Date(), read: true } });
      } else if (action === "unarchive") {
        await col.updateOne(filter, { $unset: { archivedAt: "" } });
      } else if (action === "snooze") {
        const mins = parsed.data.snoozeMinutes ?? 12 * 60;
        await col.updateOne(filter, {
          $set: { snoozedUntil: new Date(Date.now() + mins * 60000) },
        });
      } else if (action === "unsnooze") {
        await col.updateOne(filter, { $unset: { snoozedUntil: "" } });
      }
    } else {
      let scopeIds = bundleUserIds;
      if (forUserId) {
        const scopeOid = parseObjectId(forUserId);
        if (!scopeOid || !bundleSet.has(scopeOid.toString())) {
          return NextResponse.json({ error: "Invalid account scope" }, { status: 400 });
        }
        scopeIds = [scopeOid];
      }
      const filter: Record<string, unknown> = { userId: { $in: scopeIds }, read: false };
      if (forCharacterId) {
        const charOid = parseObjectId(forCharacterId);
        if (!charOid) {
          return NextResponse.json({ error: "Invalid character id" }, { status: 400 });
        }
        const owningChar = await db
          .collection<Character>("characters")
          .findOne({ _id: charOid, userId: { $in: scopeIds } }, { projection: { _id: 1 } });
        if (!owningChar) {
          return NextResponse.json({ error: "Character not in scope" }, { status: 400 });
        }
        filter["metadata.recipientCharacterId"] = forCharacterId;
      }
      await db
        .collection<Notification>("notifications")
        .updateMany(filter, { $set: { read: true } });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleRouteError(err);
  }
}

// DELETE /api/notifications — Deletes notifications owned by any bundled account
// Auth: requireBasicAuth
// Errors: 400, 401, 429
export async function DELETE(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, notificationsDeleteSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { id, ids, deleteAll } = parsed.data;

    const db = await getDb();
    const userId = new ObjectId(auth.user.userId);

    const user = await db
      .collection<User>("users")
      .findOne({ _id: userId }, { projection: { _id: 1, notificationBundleUserIds: 1 } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const bundleUserIds = getNotificationBundleUserIds(user);

    if (deleteAll) {
      await db
        .collection<Notification>("notifications")
        .deleteMany({ userId: { $in: bundleUserIds }, read: true });
    } else if (ids && ids.length > 0) {
      const objectIds = ids
        .map((i) => parseObjectId(i))
        .filter((oid): oid is ObjectId => oid !== null);
      await db.collection<Notification>("notifications").deleteMany({
        _id: { $in: objectIds },
        userId: { $in: bundleUserIds },
      });
    } else if (id) {
      const notificationOid = parseObjectId(id);
      if (!notificationOid) {
        return NextResponse.json({ error: "Invalid notification ID" }, { status: 400 });
      }
      await db.collection<Notification>("notifications").deleteOne({
        _id: notificationOid,
        userId: { $in: bundleUserIds },
      });
    } else {
      return NextResponse.json({ error: "No id, ids, or deleteAll specified" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
