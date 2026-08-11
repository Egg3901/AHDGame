// GET /api/corporations/[id]/nationalization-status
// Status card data for a private corp page: pending taking countdown + ownership
// flags (spun-out / golden share / open auction). Public read.
// Errors: 404 (corp not found)
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { handleRouteError } from "@/lib/api/errors";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { buildCorpNationalizationStatus } from "@/lib/nationalization/corpNationalizationStatus";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const currentTurn = await getCurrentTurn(db);
    const status = await buildCorpNationalizationStatus(db, resolved.corporation, currentTurn);
    return NextResponse.json(status);
  } catch (error) {
    return handleRouteError(error);
  }
}
