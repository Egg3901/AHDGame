import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { parseJsonBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { loadVentureContext, newVentureId } from "@/lib/products/venture/access";
import { newVenture, clampFundingPerTurn } from "@/lib/products/venture/engine";
import { availableVentureLines, liftedSectorIds } from "@/lib/products/venture/lines";
import { buildStudioView } from "@/lib/products/venture/studio";
import { PRODUCT_VENTURES, ventureDocument } from "@/lib/products/venture/store";
import { sectorTurnRevenueAnchor } from "@/lib/products/venture/revenue";
import { ventureSector } from "@/lib/products/venture/turn";
import type { ProductVenture } from "@/lib/products/venture/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const noStore = { "Cache-Control": "private, no-store" };
const startSchema = z.object({
  domain: z.enum(["media", "manufacturing"]),
  lineId: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(60),
  fundingPerTurnAnchor: z.number().finite().positive().optional(),
});

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const { id } = await params;
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;
    const context = await loadVentureContext(db, corporation);
    const isCeo = requireCeo(corporation, auth.user.userId) === null;
    const view = buildStudioView({
      isCeo,
      corporation,
      sectors: context.sectors,
      ventures: context.ventures,
      fxByCurrency: context.fxByCurrency,
      turn: context.turn,
      currentYear: context.currentYear,
      eligibility: context.eligibility,
      enabled: context.enabled,
    });
    return NextResponse.json(view, { headers: noStore });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const limit = checkRateLimit(auth.user.userId, 20, 60_000);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);
    const parsed = await parseJsonBody(request, startSchema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);
    const { id } = await params;
    const db = await getDb();
    const actionBlock = await requireCorporationActionsEnabled(db);
    if (actionBlock) return actionBlock;
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;
    const denied = requireCeo(corporation, auth.user.userId);
    if (denied) return denied;

    const context = await loadVentureContext(db, corporation);
    const { domain, lineId } = parsed.data;
    if (!context.enabled[domain]) {
      return errorResponse(409, "Product development is not available in this world");
    }
    const corporationId = corporation._id.toString();
    const status = availableVentureLines({
      domain,
      corporationId,
      sectors: context.sectors.map(ventureSector),
      currentYear: context.currentYear,
      eligibility: context.eligibility,
    }).find((candidate) => candidate.line.id === lineId);
    if (!status) return errorResponse(400, "Unknown product line");
    if (!status.available) {
      return errorResponse(400, status.reason ?? "Your sectors cannot make this product");
    }
    const lifted = new Set(
      liftedSectorIds({
        domain,
        lineId,
        corporationId,
        sectors: context.sectors.map(ventureSector),
      })
    );
    const baseline = context.sectors
      .filter((sector) => lifted.has(sector._id.toString()))
      .reduce(
        (sum, sector) => sum + sectorTurnRevenueAnchor(sector, corporation, context.fxByCurrency),
        0
      );
    const venture = newVenture({
      id: newVentureId(),
      corporationId,
      domain,
      lineId,
      name: parsed.data.name,
      turn: context.turn,
      baselineRevenueAnchor: baseline,
    });
    const funding = clampFundingPerTurn(
      venture.targetAnchor,
      parsed.data.fundingPerTurnAnchor ?? venture.fundingPerTurnAnchor
    );
    try {
      await db.collection<ProductVenture>(PRODUCT_VENTURES).insertOne({
        _id: venture._id,
        ...ventureDocument({ ...venture, fundingPerTurnAnchor: funding }),
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
        return errorResponse(409, "You already have a product in development in this area");
      }
      throw error;
    }
    return NextResponse.json({ ventureId: venture._id }, { status: 201, headers: noStore });
  } catch (error) {
    return handleRouteError(error);
  }
}
