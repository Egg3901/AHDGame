import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { resolveGameYear } from "@/lib/era/era";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { isAdvertisingAgreementsEnabled } from "@/lib/advertising/featureFlag";
import { listAdvertisingSuppliers } from "@/lib/advertising/suppliers";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** GET: media corporations this corporation can buy coverage advertising from. */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const { id } = await params;
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const denied = requireCeo(resolved.corporation, auth.user.userId);
    if (denied) return denied;
    if (!(await isAdvertisingAgreementsEnabled(db))) {
      return errorResponse(403, "Advertising agreements are not enabled in this world");
    }
    const currentYear = resolveGameYear((await getGameState(db)) ?? {});
    const body = await listAdvertisingSuppliers(db, resolved.corporation, currentYear);
    return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
