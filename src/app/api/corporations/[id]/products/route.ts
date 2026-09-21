import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getCurrentTurn } from "@/lib/currentTurn";
import { handleRouteError } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { startProductSchema } from "@/lib/api/schemas/corporations";
import { getProductKind } from "@/lib/products/catalog";
import { isCorporationProductsEnabled } from "@/lib/products/featureFlag";
import {
  getActiveProduct,
  listOperatingModels,
  startProductPersistent,
  type CorporationProductDocument,
} from "@/lib/products/persistence";
import { queryProductCatalog } from "@/lib/products/queries";
import { productFamilyForCorporationType, type ProductKindDefinition } from "@/lib/products/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const NO_STORE = { "Cache-Control": "private, no-store" };

function serializeProduct(product: CorporationProductDocument) {
  return {
    id: product.id,
    corporationId: product.corporationId,
    kindId: product.kindId,
    kindLabel: getProductKind(product.kindId)?.label ?? product.kindId,
    name: product.name,
    stage: product.stage,
    startedTurn: product.startedTurn,
    ...(product.launchedTurn !== undefined ? { launchedTurn: product.launchedTurn } : {}),
    ...(product.retiredTurn !== undefined ? { retiredTurn: product.retiredTurn } : {}),
  };
}

function serializeKind(kind: ProductKindDefinition) {
  return {
    id: kind.id,
    family: kind.family,
    label: kind.label,
    outputCommodity: kind.outputCommodity,
    ...(kind.operatingModels ? { operatingModels: [...kind.operatingModels] } : {}),
  };
}

// GET /api/corporations/[id]/products — Product Studio state: launch flag,
// owned operating models, the active product, and the legal product catalog.
// Auth: requireBasicAuth (any signed-in viewer; mutations stay CEO-only).
// Errors: 400, 401, 404
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;
    const corporationId = corporation._id.toString();
    const isCeo = requireCeo(corporation, auth.user.userId) === null;
    const family = productFamilyForCorporationType(corporation.type);

    const familyParam = new URL(request.url).searchParams.get("family");
    if (familyParam !== null) {
      if (familyParam !== family) {
        return NextResponse.json({ error: "Invalid product family" }, { status: 400 });
      }
    }

    if (!(await isCorporationProductsEnabled(db))) {
      return NextResponse.json(
        { enabled: false, isCeo, operatingModels: [], activeProduct: null, catalog: [] },
        { headers: NO_STORE }
      );
    }

    const [owned, active] = await Promise.all([
      listOperatingModels(db, corporationId),
      getActiveProduct(db, corporationId),
    ]);
    const ownedModels = owned.map((model) => model.operatingModel);
    const catalog = family
      ? queryProductCatalog({ family, operatingModels: ownedModels }).map(serializeKind)
      : [];

    return NextResponse.json(
      {
        enabled: true,
        isCeo,
        operatingModels: ownedModels,
        activeProduct: active ? serializeProduct(active) : null,
        catalog,
      },
      { headers: NO_STORE }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/corporations/[id]/products — Start a legal product project.
// Auth: CEO only. The product must be legal for the corporation's owned
// operating models (industrial products ignore models). One active product
// per corporation; a second start is a 409.
// Errors: 400, 401, 403, 404, 409
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const parsed = await parseJsonBody(request, startProductSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
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

    const { kindId, name } = parsed.data;
    const kind = getProductKind(kindId);
    if (!kind) {
      return NextResponse.json({ error: `Unknown product kind "${kindId}"` }, { status: 400 });
    }

    const family = productFamilyForCorporationType(corporation.type);
    if (family !== kind.family) {
      return NextResponse.json(
        { error: `"${kind.label}" is not legal for this corporation's sector` },
        { status: 400 }
      );
    }

    const corporationId = corporation._id.toString();
    const owned = await listOperatingModels(db, corporationId);
    const legal = queryProductCatalog({
      family,
      operatingModels: owned.map((model) => model.operatingModel),
    }).some((candidate) => candidate.id === kind.id);
    if (!legal) {
      return NextResponse.json(
        { error: `"${kind.label}" is not legal for this corporation's operating models` },
        { status: 400 }
      );
    }

    const started = await startProductPersistent(db, {
      enabled: true,
      draft: {
        id: new ObjectId().toHexString(),
        corporationId,
        kindId: kind.id,
        name,
        startedTurn: await getCurrentTurn(db),
      },
    });
    if (!started.ok) {
      if (started.reason === "active_product") {
        return NextResponse.json(
          { error: "This corporation already has an active product" },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: "Could not start this product" }, { status: 400 });
    }

    return NextResponse.json(
      { success: true, product: serializeProduct(started.product) },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
