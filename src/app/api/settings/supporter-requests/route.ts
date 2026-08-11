import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getSupporterRequestsCollection } from "@/lib/db/collections/supporterRequests";
import type { SupporterRequest } from "@/lib/db/types/supporterRequests";
import type { NPP, User } from "@/lib/db/types";
import { isPatreonActive } from "@/lib/db/types";
import { nameCollidesWithUser, validateProposedName } from "@/lib/supporter/requestValidation";
import { notifyModeratorsOfSupporterRequest } from "@/lib/supporter/reviewNotifications";
import { escapeRegex } from "@/lib/utils/escapeRegex";

const bodySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("wall-name"),
    proposedName: z.string().min(1).max(200),
  }),
  z.object({
    kind: z.literal("npp-rename"),
    nppId: z.string().refine((v) => ObjectId.isValid(v), "Invalid NPP ID"),
    proposedNppName: z.string().min(1).max(200),
  }),
]);

// GET /api/settings/supporter-requests — the current user's recent supporter
// requests plus eligibility flags for the settings UI.
// Auth: requireBasicAuth
export async function GET() {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const userId = new ObjectId(auth.user.userId);

    const db = await getDb();
    const user = await db.collection<User>("users").findOne(
      { _id: userId },
      {
        projection: {
          patreonTier: 1,
          patreonExpiresAt: 1,
          supporterWallName: 1,
          nppRenameUsedAt: 1,
        },
      }
    );
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const requests = await (
      await getSupporterRequestsCollection(db)
    )
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();

    const tier = user.patreonTier ?? null;
    const active = isPatreonActive(tier, user.patreonExpiresAt ?? null);
    const hasPending = (kind: SupporterRequest["kind"]) =>
      requests.some((r) => r.kind === kind && r.status === "pending");
    const renameUsed =
      !!user.nppRenameUsedAt ||
      requests.some((r) => r.kind === "npp-rename" && r.status === "approved");

    return NextResponse.json({
      tier,
      isPatronActive: active,
      supporterWallName: user.supporterWallName ?? null,
      canSubmitWallName: active && !hasPending("wall-name"),
      canSubmitNppRename:
        active && tier === "supporter-plus-plus" && !renameUsed && !hasPending("npp-rename"),
      nppRenameUsed: renameUsed,
      requests: requests.map((r) => ({
        _id: r._id.toString(),
        kind: r.kind,
        status: r.status,
        createdAt: r.createdAt,
        decidedAt: r.decidedAt ?? null,
        rejectionReason: r.rejectionReason ?? null,
        proposedName: r.proposedName ?? null,
        currentNppName: r.currentNppName ?? null,
        proposedNppName: r.proposedNppName ?? null,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/settings/supporter-requests — submit a wall-name or npp-rename
// request for moderator review.
// Auth: requireBasicAuth (plus active supporter benefit)
// Errors: 400, 401, 403, 404, 409
export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const userId = new ObjectId(auth.user.userId);

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const user = await db.collection<User>("users").findOne({ _id: userId });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const tier = user.patreonTier ?? null;
    if (!isPatreonActive(tier, user.patreonExpiresAt ?? null)) {
      return NextResponse.json(
        { error: "An active supporter subscription is required." },
        { status: 403 }
      );
    }

    const requestsCol = await getSupporterRequestsCollection(db);
    const pending = await requestsCol.findOne({
      userId,
      kind: parsed.data.kind,
      status: "pending",
    });
    if (pending) {
      return NextResponse.json(
        { error: "You already have a pending request of this type." },
        { status: 409 }
      );
    }

    const submitterName = user.displayName || user.username;

    if (parsed.data.kind === "wall-name") {
      const validated = validateProposedName(parsed.data.proposedName, { minLen: 2, maxLen: 40 });
      if (!validated.ok) {
        return NextResponse.json({ error: validated.error }, { status: 400 });
      }
      if (await nameCollidesWithUser(db, validated.name, userId)) {
        return NextResponse.json(
          { error: "That name matches another player's name. Pick something distinct." },
          { status: 409 }
        );
      }

      const doc: SupporterRequest = {
        _id: new ObjectId(),
        userId,
        kind: "wall-name",
        status: "pending",
        createdAt: new Date(),
        proposedName: validated.name,
      };
      await requestsCol.insertOne(doc);
      await notifyModeratorsOfSupporterRequest({
        kind: "wall-name",
        submitterName,
        summary: `"${validated.name}"`,
      });
      return NextResponse.json({ success: true, requestId: doc._id.toString() });
    }

    // npp-rename
    if (tier !== "supporter-plus-plus") {
      return NextResponse.json(
        { error: "Politician renames require the Supporter++ tier." },
        { status: 403 }
      );
    }
    if (user.nppRenameUsedAt) {
      return NextResponse.json(
        { error: "Your one-time politician rename has already been used." },
        { status: 409 }
      );
    }
    const priorApproved = await requestsCol.findOne({
      userId,
      kind: "npp-rename",
      status: "approved",
    });
    if (priorApproved) {
      return NextResponse.json(
        { error: "Your one-time politician rename has already been used." },
        { status: 409 }
      );
    }

    const validated = validateProposedName(parsed.data.proposedNppName, { minLen: 2, maxLen: 60 });
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const npp = await db.collection<NPP>("npps").findOne({ _id: new ObjectId(parsed.data.nppId) });
    if (!npp) {
      return NextResponse.json({ error: "Politician not found." }, { status: 404 });
    }
    if (npp.retiredAt) {
      return NextResponse.json(
        { error: "That politician is retired and cannot be renamed." },
        { status: 400 }
      );
    }

    const exact = new RegExp(`^${escapeRegex(validated.name)}$`, "i");
    const nameTaken = await db.collection<NPP>("npps").findOne(
      {
        _id: { $ne: npp._id },
        countryId: npp.countryId,
        name: exact,
      },
      { projection: { _id: 1 } }
    );
    if (nameTaken) {
      return NextResponse.json(
        { error: "A politician in that country already has this name." },
        { status: 409 }
      );
    }
    if (await nameCollidesWithUser(db, validated.name, userId)) {
      return NextResponse.json(
        { error: "That name matches a player's name. Pick something distinct." },
        { status: 409 }
      );
    }

    const doc: SupporterRequest = {
      _id: new ObjectId(),
      userId,
      kind: "npp-rename",
      status: "pending",
      createdAt: new Date(),
      nppId: npp._id,
      nppSequentialId: npp.sequentialId,
      currentNppName: npp.name,
      proposedNppName: validated.name,
    };
    await requestsCol.insertOne(doc);
    await notifyModeratorsOfSupporterRequest({
      kind: "npp-rename",
      submitterName,
      summary: `"${npp.name}" to "${validated.name}"`,
    });
    return NextResponse.json({ success: true, requestId: doc._id.toString() });
  } catch (error) {
    return handleRouteError(error);
  }
}
