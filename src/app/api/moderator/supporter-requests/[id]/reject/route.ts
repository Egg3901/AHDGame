import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { createModAuditLog } from "@/lib/modAuditLog";
import { getSupporterRequestsCollection } from "@/lib/db/collections/supporterRequests";
import type { User } from "@/lib/db/types";
import { notifySubmitterOfSupporterDecision } from "@/lib/supporter/reviewNotifications";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});

// POST /api/moderator/supporter-requests/[id]/reject — reject a pending
// supporter request with an optional reason.
// Auth: requireModerator
// Errors: 400, 403, 404, 409
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;
    const { user: moderator } = auth;

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid request ID." }, { status: 400 });
    }

    let reason: string | undefined;
    if (request.headers.get("content-length")) {
      const parsed = await parseJsonBody(request, bodySchema);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error }, { status: parsed.status });
      }
      reason = parsed.data.reason;
    }

    const db = await getDb();
    const requestsCol = await getSupporterRequestsCollection(db);
    const req = await requestsCol.findOne({ _id: new ObjectId(id) });
    if (!req) {
      return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }
    if (req.status !== "pending") {
      return NextResponse.json({ error: "Request has already been decided." }, { status: 409 });
    }

    const requester = await db
      .collection<User>("users")
      .findOne({ _id: req.userId }, { projection: { username: 1 } });

    const now = new Date();
    await requestsCol.updateOne(
      { _id: req._id },
      {
        $set: {
          status: "rejected",
          decidedAt: now,
          decidedBy: new ObjectId(moderator.userId),
          ...(reason ? { rejectionReason: reason } : {}),
        },
      }
    );

    const summary =
      req.kind === "wall-name"
        ? `"${req.proposedName ?? ""}"`
        : `"${req.currentNppName ?? ""}" to "${req.proposedNppName ?? ""}"`;

    await createModAuditLog({
      moderatorId: moderator.userId,
      moderatorName: moderator.username,
      action: "reject_supporter_request",
      targetUserId: req.userId.toString(),
      targetUsername: requester?.username,
      details: `Rejected ${req.kind} request: ${summary}${reason ? ` Reason: ${reason}` : ""}`,
    });

    await notifySubmitterOfSupporterDecision({
      submitterId: req.userId,
      kind: req.kind,
      decision: "rejected",
      summary,
      reason,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
