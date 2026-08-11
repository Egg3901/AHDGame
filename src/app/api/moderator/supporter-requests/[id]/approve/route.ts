import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { createModAuditLog } from "@/lib/modAuditLog";
import { getSupporterRequestsCollection } from "@/lib/db/collections/supporterRequests";
import type { NPP, User } from "@/lib/db/types";
import { nameCollidesWithUser } from "@/lib/supporter/requestValidation";
import { notifySubmitterOfSupporterDecision } from "@/lib/supporter/reviewNotifications";
import { escapeRegex } from "@/lib/utils/escapeRegex";
import { syncDenormalizedNppName } from "@/lib/npp/syncDenormalizedName";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/moderator/supporter-requests/[id]/approve — approve a pending
// supporter request and apply its effect (wall name or NPP rename).
// Auth: requireModerator
// Errors: 400, 403, 404, 409
export async function POST(_request: Request, { params }: RouteContext) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;
    const { user: moderator } = auth;

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid request ID." }, { status: 400 });
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
      .findOne({ _id: req.userId }, { projection: { username: 1, nppRenameUsedAt: 1 } });
    if (!requester) {
      return NextResponse.json({ error: "Requesting user not found." }, { status: 404 });
    }

    const now = new Date();
    const moderatorId = new ObjectId(moderator.userId);
    let summary: string;

    if (req.kind === "wall-name") {
      if (!req.proposedName) {
        return NextResponse.json({ error: "Request is missing a proposed name." }, { status: 400 });
      }
      await db
        .collection<User>("users")
        .updateOne({ _id: req.userId }, { $set: { supporterWallName: req.proposedName } });
      summary = `"${req.proposedName}"`;
    } else {
      if (!req.nppId || !req.proposedNppName) {
        return NextResponse.json({ error: "Request is missing rename details." }, { status: 400 });
      }
      const npp = await db.collection<NPP>("npps").findOne({ _id: req.nppId });
      if (!npp || npp.retiredAt) {
        return NextResponse.json(
          { error: "The target politician no longer exists or is retired." },
          { status: 409 }
        );
      }
      // Re-check uniqueness at decision time to close the submit/approve race.
      const exact = new RegExp(`^${escapeRegex(req.proposedNppName)}$`, "i");
      const taken = await db
        .collection<NPP>("npps")
        .findOne(
          { _id: { $ne: npp._id }, countryId: npp.countryId, name: exact },
          { projection: { _id: 1 } }
        );
      if (taken || (await nameCollidesWithUser(db, req.proposedNppName, req.userId))) {
        return NextResponse.json(
          { error: "The proposed name is no longer unique. Reject the request instead." },
          { status: 409 }
        );
      }

      await db
        .collection<NPP>("npps")
        .updateOne({ _id: npp._id }, { $set: { name: req.proposedNppName, updatedAt: now } });
      // Keep denormalized ballot / office labels in lockstep with npps.name
      // (ticket #1037: polls kept the pre-rename name after supporter rename).
      await syncDenormalizedNppName(db, npp._id, req.proposedNppName);
      await db
        .collection<User>("users")
        .updateOne({ _id: req.userId }, { $set: { nppRenameUsedAt: now } });
      // Audit trail: store the name the NPP actually held at approval time.
      await requestsCol.updateOne(
        { _id: req._id },
        { $set: { currentNppName: npp.name, proposedNppName: req.proposedNppName } }
      );
      summary = `"${npp.name}" is now "${req.proposedNppName}"`;
    }

    await requestsCol.updateOne(
      { _id: req._id },
      { $set: { status: "approved", decidedAt: now, decidedBy: moderatorId } }
    );

    await createModAuditLog({
      moderatorId: moderator.userId,
      moderatorName: moderator.username,
      action: "approve_supporter_request",
      targetUserId: req.userId.toString(),
      targetUsername: requester.username,
      details: `Approved ${req.kind} request: ${summary}`,
    });

    await notifySubmitterOfSupporterDecision({
      submitterId: req.userId,
      kind: req.kind,
      decision: "approved",
      summary,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
