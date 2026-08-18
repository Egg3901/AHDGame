/**
 * POST /api/admin/state-party/[stateId]/[partyId]/appoint
 *
 * Directly appoint (or vacate) a leadership position.
 * body: { position: "chair"|"viceChair"|"treasurer", characterId: string | null }
 *
 * - characterId = null → vacate the seat
 * - Elections continue running; winner will take position when election completes
 * - Writes to admin log.
 * - Sends leadership_appointed / leadership_removed notifications.
 */

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { adminStatePartyAppointSchema } from "@/lib/api/schemas/admin";
import {
  POSITION_LABELS,
  notifyLeadershipAppointed,
  notifyLeadershipRemovedByAdmin,
} from "@/lib/statePartyElections";
import type {
  StatePartyElectionPosition,
  StatePartyOrg,
  Character,
  AdminLog,
} from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ stateId: string; partyId: string }>;
}

const POSITION_FIELD: Record<
  StatePartyElectionPosition,
  "chairId" | "viceChairId" | "treasurerId"
> = {
  chair: "chairId",
  viceChair: "viceChairId",
  treasurer: "treasurerId",
};

// POST /api/admin/state-party/[stateId]/[partyId]/appoint — Appoints or vacates a state party leadership position (chair, viceChair, or treasurer).
// Auth: requireAdmin
// Errors: 400, 403, 404
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { admin } = auth;

    const { stateId: rawState, partyId } = await params;
    const stateId = rawState.toUpperCase();

    const parsed = await parseJsonBody(request, adminStatePartyAppointSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { position, characterId } = parsed.data;

    const db = await getDb();
    const now = new Date();
    const field = POSITION_FIELD[position];
    const label = POSITION_LABELS[position];

    // Resolve new holder (null = vacate)
    let newHolderId: ObjectId | null = null;
    let newHolderName = "(Vacant)";

    if (characterId !== null) {
      let charOid: ObjectId;
      try {
        charOid = new ObjectId(characterId);
      } catch {
        return NextResponse.json({ error: "Invalid characterId" }, { status: 400 });
      }

      const char = await db.collection<Character>("characters").findOne({ _id: charOid });

      if (!char) return NextResponse.json({ error: "Character not found" }, { status: 404 });

      if (char.homeState !== stateId || char.party !== partyId) {
        return NextResponse.json(
          { error: "Character is not a member of this state party" },
          { status: 400 }
        );
      }

      newHolderId = charOid;
      newHolderName = char.name;
    }

    // Get current holder so we can notify removal
    const org = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .findOne({ _id: `${stateId}_${partyId}` as unknown as string });

    const previousHolderId: ObjectId | null = org?.[field] ?? null;
    const leadershipReset: Partial<Pick<StatePartyOrg, "chairId" | "viceChairId" | "treasurerId">> =
      {};
    if (org && newHolderId) {
      for (const [otherPosition, otherField] of Object.entries(POSITION_FIELD) as Array<
        [StatePartyElectionPosition, "chairId" | "viceChairId" | "treasurerId"]
      >) {
        if (otherPosition === position) continue;
        if (org[otherField]?.equals(newHolderId)) {
          leadershipReset[otherField] = null;
        }
      }
    }

    // Update statePartyOrg (elections continue running - winner will take position when election completes)
    await db
      .collection<StatePartyOrg>("statePartyOrg")
      .updateOne(
        { _id: `${stateId}_${partyId}` as unknown as string },
        { $set: { ...leadershipReset, [field]: newHolderId, updatedAt: now } }
      );

    // Notifications
    if (newHolderId) {
      await notifyLeadershipAppointed(newHolderId, stateId, partyId, position, "an admin");
    }
    if (previousHolderId && (!newHolderId || !previousHolderId.equals(newHolderId))) {
      await notifyLeadershipRemovedByAdmin(previousHolderId, stateId, partyId, position);
    }

    // Admin log
    const logEntry: Omit<AdminLog, "_id"> = {
      category: "election",
      action: newHolderId ? "leadership_appointed" : "leadership_removed",
      username: newHolderName,
      adminUsername: admin.username,
      details: `${label} of ${stateId} ${partyId}`,
      createdAt: now,
    };
    await db.collection("adminLogs").insertOne(logEntry);

    return NextResponse.json({
      success: true,
      message: newHolderId
        ? `${newHolderName} appointed as ${label} of ${stateId} ${partyId}`
        : `${label} of ${stateId} ${partyId} vacated`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
