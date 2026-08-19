/**
 * POST /api/admin/state-party/[stateId]/[partyId]/delete — Delete a state party organization
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { StatePartyOrg, PartyBudget, StatePartyElection } from "@/lib/db/types";

// POST /api/admin/state-party/[stateId]/[partyId]/delete — Deletes a state party organization along with its budget and election records.
// Auth: requireAdmin
// Errors: 403, 404
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ stateId: string; partyId: string }> }
) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { stateId, partyId } = await params;
    const upperStateId = stateId.toUpperCase();
    const statePartyId = `${upperStateId}_${partyId}`;

    const db = await getDb();

    // Check state party exists
    const stateParty = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .findOne({ _id: statePartyId });

    if (!stateParty) {
      return NextResponse.json({ error: "State party not found" }, { status: 404 });
    }

    // Delete state party budget
    await db.collection<PartyBudget>("partyBudget").deleteMany({
      partyId,
      stateId: upperStateId,
    });

    // Delete state party leadership elections
    await db.collection<StatePartyElection>("statePartyElections").deleteMany({
      partyId,
      stateId: upperStateId,
    });

    // Delete the state party organization
    await db.collection<StatePartyOrg>("statePartyOrg").deleteOne({ _id: statePartyId });

    return NextResponse.json({
      success: true,
      message: `Deleted ${partyId} state party organization in ${upperStateId}`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
