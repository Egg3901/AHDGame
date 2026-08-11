// GET /api/admin/alts/clusters — ranked alt-detection clusters, confidence desc
// Auth: requireModerator (mods and admins both read; plan §4.6)
// Errors: 400, 401, 403
//
// Frozen contract (forensics/alt-detection rework plan §4.9):
//   GET /api/admin/alts/clusters?minConfidence&status&signal&limit&cursor
//     -> { clusters: [{ id, confidence, size, roles, topSignal, status, memberPreview[] }], nextCursor? }
import { NextResponse } from "next/server";
import { ObjectId, type Filter } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { getAltClustersCollection } from "@/lib/db/collections";
import type { AltCluster, AltClusterStatus } from "@/lib/db/types/altDetection";
import type { User } from "@/lib/db/types";
import { decodeClusterCursor, encodeClusterCursor, isAltSignal } from "../_shared";

const ALT_CLUSTER_STATUSES: ReadonlySet<AltClusterStatus> = new Set([
  "open",
  "reviewed",
  "confirmed",
  "dismissed",
]);
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 25;
const MEMBER_PREVIEW_LIMIT = 5;

export async function GET(request: Request) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const minConfidenceParam = searchParams.get("minConfidence");
    const statusParam = searchParams.get("status");
    const signalParam = searchParams.get("signal");
    const cursorParam = searchParams.get("cursor");
    const limitParam = searchParams.get("limit");

    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(limitParam ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
    );

    const filter: Filter<AltCluster> & Record<string, unknown> = {};

    if (minConfidenceParam !== null) {
      const v = Number(minConfidenceParam);
      if (!Number.isFinite(v) || v < 0 || v > 1) {
        return NextResponse.json({ error: "Invalid minConfidence" }, { status: 400 });
      }
      filter.confidence = { $gte: v };
    }

    if (statusParam !== null) {
      if (!ALT_CLUSTER_STATUSES.has(statusParam as AltClusterStatus)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      filter.status = statusParam as AltClusterStatus;
    }

    if (signalParam !== null) {
      if (!isAltSignal(signalParam)) {
        return NextResponse.json({ error: "Invalid signal" }, { status: 400 });
      }
      filter["signalSummary.type"] = signalParam;
    }

    if (cursorParam !== null) {
      const decoded = decodeClusterCursor(cursorParam);
      if (!decoded) {
        return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
      }
      // Keyset pagination over the {confidence:-1,_id:-1} sort: strictly
      // lower confidence, OR equal confidence with a strictly lower _id.
      filter.$or = [
        { confidence: { $lt: decoded.confidence } },
        {
          confidence: decoded.confidence,
          _id: { $lt: new ObjectId(decoded.id) },
        },
      ];
    }

    const db = await getDb();
    const clustersCol = await getAltClustersCollection(db);

    const docs = await clustersCol
      .find(filter)
      .sort({ confidence: -1, _id: -1 })
      .limit(limit + 1)
      .toArray();

    const hasMore = docs.length > limit;
    if (hasMore) docs.pop();

    // Batch-fetch usernames for the member preview across every returned
    // cluster in one query rather than N+1.
    const previewIds = new Set<string>();
    for (const doc of docs) {
      for (const id of doc.memberUserIds.slice(0, MEMBER_PREVIEW_LIMIT)) {
        previewIds.add(id.toString());
      }
    }
    const previewObjectIds = [...previewIds].map((id) => new ObjectId(id));
    const users = previewObjectIds.length
      ? await db
          .collection<User>("users")
          .find({ _id: { $in: previewObjectIds } }, { projection: { username: 1, isBanned: 1 } })
          .toArray()
      : [];
    const userById = new Map(users.map((u) => [u._id.toString(), u]));

    const clusters = docs.map((doc) => ({
      id: doc._id.toString(),
      confidence: doc.confidence,
      size: doc.size,
      roles: {
        operator: doc.roles.operator?.toString(),
        burners: doc.roles.burners.map((id) => id.toString()),
        associates: doc.roles.associates.map((id) => id.toString()),
      },
      topSignal: doc.signalSummary[0]?.type ?? null,
      status: doc.status,
      memberPreview: doc.memberUserIds.slice(0, MEMBER_PREVIEW_LIMIT).map((id) => {
        const u = userById.get(id.toString());
        return {
          userId: id.toString(),
          name: u?.username ?? null,
          banned: u?.isBanned ?? false,
        };
      }),
    }));

    const nextCursor =
      hasMore && docs.length > 0
        ? encodeClusterCursor(docs[docs.length - 1].confidence, docs[docs.length - 1]._id)
        : undefined;

    return NextResponse.json({ clusters, ...(nextCursor ? { nextCursor } : {}) });
  } catch (error) {
    return handleRouteError(error);
  }
}
