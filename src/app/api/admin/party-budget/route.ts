import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { getPartyBudgetCollection } from "@/lib/db/collections";
import { ObjectId } from "mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody, schemas } from "@/lib/api/validate";

const postSchema = z.object({
  budgetId: schemas.objectId.optional(),
  partyId: z.string().min(1).optional(),
  scope: z.enum(["national", "state"]).optional(),
  stateId: z.string().min(1).optional(),
  gotvBudgetPerTurn: z.number().optional(),
});

/**
 * GET /api/admin/party-budget
 * Fetch party budgets with optional filters
 * Query params: partyId, stateId
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const partyId = req.nextUrl.searchParams.get("partyId");
    const stateId = req.nextUrl.searchParams.get("stateId");

    const collection = await getPartyBudgetCollection();
    const query: Record<string, unknown> = {};

    if (partyId) query.partyId = partyId;
    if (stateId) query.stateId = stateId;

    const budgets = await collection.find(query).toArray();

    return NextResponse.json({ budgets });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/admin/party-budget
 * Update party budget allocation settings.
 * Body: { budgetId?, partyId?, scope?, stateId?, gotvBudgetPerTurn? }
 *
 * Note: actual party treasury funds are NOT stored here — they live on
 * politicalParties.treasury (national) / statePartyOrg.treasury (state).
 * Any `treasury` field on the body is ignored.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(req, postSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { budgetId, partyId, scope, stateId, gotvBudgetPerTurn } = parsed.data;

    const collection = await getPartyBudgetCollection();
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (typeof gotvBudgetPerTurn === "number") {
      updates.gotvBudgetPerTurn = Math.max(0, gotvBudgetPerTurn);
    }

    // Build query: either by budgetId or by partyId+scope(+stateId)
    let query: Record<string, unknown>;
    if (budgetId) {
      query = { _id: new ObjectId(budgetId) };
    } else if (partyId && scope) {
      query = { partyId, scope };
      if (scope === "state" && stateId) {
        query.stateId = stateId;
      }
    } else {
      return NextResponse.json(
        { error: "Either budgetId or (partyId + scope) is required" },
        { status: 400 }
      );
    }

    const result = await collection.updateOne(query, { $set: updates });

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: "Budget not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: "Party budget updated successfully",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
