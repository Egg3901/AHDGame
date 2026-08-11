import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { getSupporterRequestsCollection } from "@/lib/db/collections/supporterRequests";
import type { SupporterRequest } from "@/lib/db/types/supporterRequests";
import type { User } from "@/lib/db/types";

function serialize(
  r: SupporterRequest,
  requesterById: Map<
    string,
    { username?: string; displayName?: string; patreonTier?: User["patreonTier"] }
  >
) {
  const requester = requesterById.get(r.userId.toString());
  return {
    _id: r._id.toString(),
    userId: r.userId.toString(),
    kind: r.kind,
    status: r.status,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt ?? null,
    rejectionReason: r.rejectionReason ?? null,
    proposedName: r.proposedName ?? null,
    nppId: r.nppId?.toString() ?? null,
    nppSequentialId: r.nppSequentialId ?? null,
    currentNppName: r.currentNppName ?? null,
    proposedNppName: r.proposedNppName ?? null,
    requesterName: requester?.displayName || requester?.username || "Unknown",
    requesterUsername: requester?.username ?? null,
    requesterTier: requester?.patreonTier ?? null,
  };
}

// GET /api/moderator/supporter-requests — pending supporter requests plus the
// most recently decided ones, enriched with requester name and tier.
// Auth: requireModerator
// Errors: 401, 403
export async function GET() {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const requestsCol = await getSupporterRequestsCollection(db);

    const [pending, decided] = await Promise.all([
      requestsCol.find({ status: "pending" }).sort({ createdAt: 1 }).limit(100).toArray(),
      requestsCol
        .find({ status: { $in: ["approved", "rejected"] } })
        .sort({ decidedAt: -1 })
        .limit(25)
        .toArray(),
    ]);

    const userIds = Array.from(
      new Set([...pending, ...decided].map((r) => r.userId.toString()))
    ).map((id) => new ObjectId(id));

    const users = userIds.length
      ? await db
          .collection<User>("users")
          .find({ _id: { $in: userIds } })
          .project<{
            _id: ObjectId;
            username?: string;
            displayName?: string;
            patreonTier?: User["patreonTier"];
          }>({ username: 1, displayName: 1, patreonTier: 1 })
          .toArray()
      : [];
    const requesterById = new Map(users.map((u) => [u._id.toString(), u]));

    return NextResponse.json({
      pending: pending.map((r) => serialize(r, requesterById)),
      decided: decided.map((r) => serialize(r, requesterById)),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
