import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { loadOwnershipHistory } from "@/lib/corporations/ownership/history";

const querySchema = z.coerce.number().refine((n) => [24, 96, 192].includes(n));

/** Public cap table history, with the same visibility as the shareholder register. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const parsed = querySchema.safeParse(new URL(request.url).searchParams.get("turns") ?? 96);
    if (!parsed.success) return errorResponse(400, "Choose 24, 96 or 192 turns");
    const db = await getDb();
    const { id } = await params;
    const resolved = await resolveCorporation(db, id, { _id: 1, totalShares: 1 });
    if (!resolved.ok) return resolved.response;
    const history = await loadOwnershipHistory(db, resolved.corporation._id, parsed.data);
    return NextResponse.json(history, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
