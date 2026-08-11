import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import { getDb } from "@/lib/mongodb";
import { parseBoundedIntParam } from "@/lib/api/validate";

interface UserApiKeyRow {
  _id: string;
  name: string;
  scope: "public" | "private";
  prefix: string;
  requestCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  userId: string;
  username: string;
  characterName: string | null;
}

// GET /api/admin/user-api-keys — List all user API keys with user info, sortable/filterable.
export const GET = withAdminAuth(async (_auth, request: Request) => {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseBoundedIntParam(searchParams, "limit", 200, 1, 1000);
    const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);
    const scope = searchParams.get("scope"); // "public" | "private" | null (all)
    const search = searchParams.get("search")?.trim() || null; // filter by username or key name
    const includeRevoked = searchParams.get("includeRevoked") === "true";

    const db = await getDb();

    // Build filter
    const filter: Record<string, unknown> = {};
    if (scope === "public" || scope === "private") filter.scope = scope;
    if (!includeRevoked) filter.revokedAt = null;

    // If searching by username/key name, do a two-step lookup:
    // 1) Find matching user IDs, 2) Add to filter
    let matchingUserIds: ObjectId[] | null = null;
    if (search) {
      const users = await db
        .collection("users")
        .find({ username: { $regex: search, $options: "i" } })
        .project({ _id: 1 })
        .limit(100)
        .toArray();
      matchingUserIds = users.map((u) => u._id);
      // Also match keys by name
      const keysByName = await db
        .collection("userApiKeys")
        .find({ name: { $regex: search, $options: "i" } })
        .project({ userId: 1 })
        .limit(100)
        .toArray();
      const nameUserIds = keysByName.map((k) => k.userId as ObjectId);
      const allIds = [...new Set([...matchingUserIds, ...nameUserIds].map((id) => id.toString()))];
      filter.userId = { $in: allIds.map((id) => new ObjectId(id)) };
    }

    const [keys, total] = await Promise.all([
      db
        .collection("userApiKeys")
        .find(filter)
        .project({ tokenHash: 0 })
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      db.collection("userApiKeys").countDocuments(filter),
    ]);

    // Resolve user info
    const userIds = [...new Set(keys.map((k) => k.userId.toString()))];
    const users = await db
      .collection("users")
      .find({ _id: { $in: userIds.map((id) => new ObjectId(id)) } })
      .project({ _id: 1, username: 1 })
      .toArray();
    const userMap = new Map(users.map((u) => [u._id.toString(), u.username]));

    // Resolve character names
    const characters = await db
      .collection("characters")
      .find({ userId: { $in: userIds.map((id) => new ObjectId(id)) } })
      .project({ userId: 1, name: 1 })
      .toArray();
    const charMap = new Map(characters.map((c) => [c.userId.toString(), c.name]));

    const rows: UserApiKeyRow[] = keys.map((k) => ({
      _id: k._id.toString(),
      name: k.name,
      scope: k.scope,
      prefix: k.prefix,
      requestCount: k.requestCount ?? 0,
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      createdAt: k.createdAt?.toISOString() ?? "",
      revokedAt: k.revokedAt?.toISOString() ?? null,
      userId: k.userId.toString(),
      username: userMap.get(k.userId.toString()) ?? "Unknown",
      characterName: charMap.get(k.userId.toString()) ?? null,
    }));

    return NextResponse.json({ keys: rows, total, limit, offset });
  } catch (error) {
    return handleRouteError(error);
  }
});

// DELETE /api/admin/user-api-keys — Admin-revoke any user API key by ID.
export const DELETE = withAdminAuth(async (_auth, request: Request) => {
  try {
    const { searchParams } = new URL(request.url);
    const keyId = searchParams.get("keyId");
    if (!keyId) {
      return NextResponse.json({ error: "keyId is required" }, { status: 400 });
    }

    const db = await getDb();
    const result = await db
      .collection("userApiKeys")
      .updateOne(
        { _id: new ObjectId(keyId), revokedAt: null },
        { $set: { revokedAt: new Date(), updatedAt: new Date() } }
      );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: "Key not found or already revoked" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
});
