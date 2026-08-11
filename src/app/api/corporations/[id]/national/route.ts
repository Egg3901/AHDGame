// GET /api/corporations/[id]/national
// Read-only view-model for the National Corporation page (spec §17). Public read;
// `viewerIsOfficial` is true only when the logged-in viewer passes treasury authority.
// Errors: 404 (not found / not state-owned).
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { verifyAuth } from "@/lib/auth";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { handleRouteError } from "@/lib/api/errors";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { buildNationalCorporationView } from "@/lib/nationalization/nationalCorporationView";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    if (!isStateOwned(corporation)) {
      return NextResponse.json({ error: "Not a National Corporation." }, { status: 404 });
    }

    const authUser = await verifyAuth().catch(() => null);
    const viewerCharacter = authUser
      ? await getCharacterByUserId(db, authUser.userId).catch(() => null)
      : null;

    const viewModel = await buildNationalCorporationView(
      db,
      corporation,
      viewerCharacter?._id ?? null
    );
    return NextResponse.json(viewModel);
  } catch (error) {
    return handleRouteError(error);
  }
}
