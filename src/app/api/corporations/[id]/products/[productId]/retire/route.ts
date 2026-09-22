import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getCurrentTurn } from "@/lib/currentTurn";
import { handleRouteError } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { getProductKind } from "@/lib/products/catalog";
import { isCorporationProductsEnabled } from "@/lib/products/featureFlag";
import {
  retireProductPersistent,
  type CorporationProductDocument,
} from "@/lib/products/persistence";

interface RouteParams {
  params: Promise<{ id: string; productId: string }>;
}

// POST /api/corporations/[id]/products/[productId]/retire — Retire the
// corporation's active product, freeing its one-product slot. The product
// must belong to the requested corporation.
// Auth: CEO only. Errors: 400, 401, 403, 404, 409
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id, productId } = await params;
    if (!productId || productId.length > 64) {
      return NextResponse.json({ error: "Invalid product ID" }, { status: 400 });
    }

    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    if (!(await isCorporationProductsEnabled(db))) {
      return NextResponse.json(
        { error: "Corporation products are not enabled in this world" },
        { status: 403 }
      );
    }

    const corporationId = corporation._id.toString();
    const stored = await db
      .collection<CorporationProductDocument>("corporationProducts")
      .findOne({ _id: productId });
    if (!stored || stored.corporationId !== corporationId) {
      return NextResponse.json(
        { error: "Product not found for this corporation" },
        { status: 404 }
      );
    }

    const retired = await retireProductPersistent(db, {
      productId,
      turn: await getCurrentTurn(db),
    });
    if (!retired.ok) {
      if (retired.reason === "already_retired") {
        return NextResponse.json({ error: "This product is already retired" }, { status: 409 });
      }
      return NextResponse.json(
        { error: "Product not found for this corporation" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      product: {
        id: retired.product.id,
        kindId: retired.product.kindId,
        kindLabel: getProductKind(retired.product.kindId)?.label ?? retired.product.kindId,
        name: retired.product.name,
        stage: retired.product.stage,
        startedTurn: retired.product.startedTurn,
        ...(retired.product.retiredTurn !== undefined
          ? { retiredTurn: retired.product.retiredTurn }
          : {}),
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
