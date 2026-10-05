/**
 * DELETE /api/admin/state-party-elections/[electionId]
 *   Cancel a specific party leadership election (state, national, or committee).
 */

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import type {
  StatePartyElection,
  NationalPartyElection,
  NationalCommitteeElection,
} from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ electionId: string }>;
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { electionId } = await params;

    let oid: ObjectId;
    try {
      oid = new ObjectId(electionId);
    } catch {
      return errorResponse(400, "Invalid electionId");
    }

    const db = await getDb();
    const now = new Date();

    // Try to find and cancel in state elections
    const stateElection = await db
      .collection<StatePartyElection>("statePartyElections")
      .findOne({ _id: oid });

    if (stateElection) {
      if (stateElection.status !== "voting") {
        return errorResponse(400, "Only active (voting) elections can be cancelled");
      }
      await db
        .collection<StatePartyElection>("statePartyElections")
        .updateOne({ _id: oid }, { $set: { status: "cancelled", updatedAt: now } });
      return NextResponse.json({
        success: true,
        message: `State election cancelled (${stateElection.stateId} ${stateElection.partyId} ${stateElection.position})`,
      });
    }

    // Try national elections
    const nationalElection = await db
      .collection<NationalPartyElection>("nationalPartyElections")
      .findOne({ _id: oid });

    if (nationalElection) {
      if (nationalElection.status !== "voting") {
        return errorResponse(400, "Only active (voting) elections can be cancelled");
      }
      await db
        .collection<NationalPartyElection>("nationalPartyElections")
        .updateOne({ _id: oid }, { $set: { status: "cancelled", updatedAt: now } });
      return NextResponse.json({
        success: true,
        message: `National election cancelled (${nationalElection.countryId ?? "US"} ${nationalElection.partyId} ${nationalElection.position})`,
      });
    }

    // Try committee elections
    const committeeElection = await db
      .collection<NationalCommitteeElection>("nationalCommitteeElections")
      .findOne({ _id: oid });

    if (committeeElection) {
      if (committeeElection.status !== "voting") {
        return errorResponse(400, "Only active (voting) elections can be cancelled");
      }
      await db
        .collection<NationalCommitteeElection>("nationalCommitteeElections")
        .updateOne({ _id: oid }, { $set: { status: "cancelled", updatedAt: now } });
      return NextResponse.json({
        success: true,
        message: `Committee election cancelled (${committeeElection.countryId ?? "US"} ${committeeElection.partyId})`,
      });
    }

    return errorResponse(404, "Election not found");
  } catch (error) {
    return handleRouteError(error);
  }
}
