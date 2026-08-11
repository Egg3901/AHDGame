import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { CORPORATION_TYPES, type CorporationType } from "@/lib/constants/corporations";
import { isSubsidiaryCorporationsEnabled } from "@/lib/corporations/subsidiaries/featureFlag";
import { spinOff } from "@/lib/corporations/subsidiaries/commands/spinOff";

const bodySchema = z.object({
  sectorType: z.string(),
  name: z.string().min(1).max(80),
  tickerSymbol: z.string().max(5).optional(),
  appointedCeoType: z.enum(["character", "npp"]),
  appointedCeoCharacterId: schemas.objectId.optional(),
  forcedNppId: schemas.objectId.optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/corporations/[id]/subsidiary/spin-off
 * Parent CEO spins off one of the parent's sector types into a new, wholly
 * parent-owned private corporation. Feature-gated.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rl = checkRateLimit(`subsidiary-spin-off:${auth.user.userId}`, 5, 60000);
    if (!rl.ok) return rateLimitResponse(rl.retryAfter);

    const db = await getDb();
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;
    if (!(await isSubsidiaryCorporationsEnabled())) {
      return NextResponse.json(
        { error: "Subsidiary corporations are not enabled." },
        { status: 403 }
      );
    }

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    if (!(CORPORATION_TYPES as readonly string[]).includes(parsed.data.sectorType)) {
      return NextResponse.json({ error: "Invalid sector type." }, { status: 400 });
    }

    const { id } = await params;
    const parentResolved = await resolveCorporation(db, id);
    if (!parentResolved.ok) return parentResolved.response;

    const turn = await getCurrentTurn(db).catch(() => 0);
    const result = await spinOff(db, {
      parent: parentResolved.corporation,
      callerUserId: new ObjectId(auth.user.userId),
      sectorType: parsed.data.sectorType as CorporationType,
      name: parsed.data.name,
      tickerSymbol: parsed.data.tickerSymbol,
      appointedCeoType: parsed.data.appointedCeoType,
      appointedCeoCharacterId: parsed.data.appointedCeoCharacterId
        ? new ObjectId(parsed.data.appointedCeoCharacterId)
        : undefined,
      forcedNppId: parsed.data.forcedNppId,
      turn,
      now: new Date(),
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    return NextResponse.json({ success: true, newCorporationId: result.newCorporationId });
  } catch (error) {
    return handleRouteError(error);
  }
}
