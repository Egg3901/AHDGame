import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getCurrentTurn } from "@/lib/currentTurn";
import { getGameState } from "@/lib/gameState";
import { handleRouteError } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { startProductSchema } from "@/lib/api/schemas/corporations";
import { getProductKind } from "@/lib/products/catalog";
import { isCorporationProductsEnabled } from "@/lib/products/featureFlag";
import {
  manufacturingKindRequirements,
  manufacturingStrategyLabels,
  validateManufacturingProductStart,
} from "@/lib/products/manufacturing";
import {
  MEDIA_STUDIO_EXPLAINER,
  coverageAddressableShare,
  mediaKindProfile,
  mediaModelProfile,
  validateMediaProductStart,
} from "@/lib/products/media";
import { PRODUCT_POST_LAUNCH_TURNS, effectsForStage } from "@/lib/products/lifecycle";
import { isSectorTechTreesEnabled } from "@/lib/corporations/techTree/featureFlag";
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
  const effects = effectsForStage({
    stage: product.stage,
    launchQuality: product.launchQuality ?? null,
    productBrand: product.productBrand,
  });
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
    developmentSpendAnchor: product.developmentSpendAnchor,
    developmentAdvertisingAnchor: product.developmentAdvertisingAnchor,
    developmentAdvertisingTurns: product.developmentAdvertisingTurns,
    ...(product.launchQuality !== undefined ? { launchQuality: product.launchQuality } : {}),
    ...(product.productBrand !== undefined ? { productBrand: product.productBrand } : {}),
    demandMultiplier: effects.demandMultiplier,
    priceDefenseMultiplier: effects.priceDefenseMultiplier,
    amortizationPerTurnAnchor:
      PRODUCT_POST_LAUNCH_TURNS > 0
        ? Math.round((product.developmentSpendAnchor / PRODUCT_POST_LAUNCH_TURNS) * 100) / 100
        : 0,
  };
}

function serializeKind(kind: ProductKindDefinition) {
  const manufacturing = manufacturingKindRequirements(kind.id);
  const mediaProfile = mediaKindProfile(kind.id);
  return {
    id: kind.id,
    family: kind.family,
    label: kind.label,
    outputCommodity: kind.outputCommodity,
    ...(kind.operatingModels ? { operatingModels: [...kind.operatingModels] } : {}),
    ...(kind.minDecade ? { minDecade: kind.minDecade } : {}),
    ...(kind.requiredTechnologyIds
      ? { requiredTechnologyIds: [...kind.requiredTechnologyIds] }
      : {}),
    ...(mediaProfile
      ? {
          cadence: {
            developmentTurns: mediaProfile.schedule.developmentTurns,
            launchTurns: mediaProfile.schedule.launchTurns,
            growthTurns: mediaProfile.schedule.growthTurns,
            matureTurns: mediaProfile.schedule.matureTurns,
            declineTurns: mediaProfile.schedule.declineTurns,
            tail: mediaProfile.tail,
            tailBlurb: mediaProfile.tailBlurb,
          },
        }
      : {}),
    ...(manufacturing
      ? {
          requirements: {
            sectorTypes: [...manufacturing.sectorTypes],
            strategyIds: [...manufacturing.strategyIds],
            strategyLabels: manufacturingStrategyLabels(kind.id),
            ...(manufacturing.minDecade ? { minDecade: manufacturing.minDecade } : {}),
          },
        }
      : {}),
  };
}

function serializeModelProfile(model: string) {
  const profile = mediaModelProfile(model);
  if (!profile) return null;
  const kinds = queryProductCatalog({
    family: "media_entertainment",
    operatingModels: [model],
  }).map((kind) => ({
    id: kind.id,
    label: kind.label,
  }));
  return {
    model: profile.model,
    corporationTypes: [...profile.corporationTypes],
    coverage: {
      pattern: profile.coverage.pattern,
      addressableShare: coverageAddressableShare(profile.model),
      blurb: profile.coverage.blurb,
    },
    ...(profile.minDecade ? { minDecade: profile.minDecade } : {}),
    ...(profile.technologyIdBySector
      ? { technologyIdBySector: { ...profile.technologyIdBySector } }
      : {}),
    cadenceBlurb: profile.cadenceBlurb,
    tailBlurb: profile.tailBlurb,
    kinds,
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
        { enabled: false, family, isCeo, operatingModels: [], activeProduct: null, catalog: [] },
        { headers: NO_STORE }
      );
    }

    const [owned, active, gameState] = await Promise.all([
      listOperatingModels(db, corporationId),
      getActiveProduct(db, corporationId),
      getGameState(db),
    ]);
    const ownedModels = owned.map((model) => model.operatingModel);
    const catalog = family
      ? queryProductCatalog({
          family,
          operatingModels: ownedModels,
          unlockedTechnologyIds: corporation.unlockedTechNodeIds,
          currentYear: gameState?.currentYear,
        }).map(serializeKind)
      : [];
    const modelProfiles =
      family === "media_entertainment"
        ? ownedModels
            .map((model) => serializeModelProfile(model))
            .filter((profile) => profile !== null)
        : [];

    return NextResponse.json(
      {
        enabled: true,
        family,
        isCeo,
        operatingModels: ownedModels,
        activeProduct: active ? serializeProduct(active) : null,
        catalog,
        ...(family === "media_entertainment"
          ? { modelProfiles, explainer: { ...MEDIA_STUDIO_EXPLAINER } }
          : {}),
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

    // Industrial products additionally need a compatible plant running a
    // compatible process in the right era with the right research. The
    // messages name the blocker so the Studio can show it directly.
    if (kind.family === "industrial_manufacturing") {
      const [sectors, gameState] = await Promise.all([
        db
          .collection("corporateSectors")
          .find(
            { corporationId: corporation._id },
            { projection: { sectorType: 1, strategyId: 1, capacity: 1, mothballed: 1 } }
          )
          .toArray(),
        getGameState(db),
      ]);
      const compatibility = validateManufacturingProductStart({
        kindId: kind.id,
        corporationTypes: [corporation.type, corporation.secondaryType].filter(
          (type): type is string => typeof type === "string"
        ),
        plants: sectors.map((sector) => ({
          sectorType: (sector as { sectorType?: unknown }).sectorType,
          strategyId: (sector as { strategyId?: unknown }).strategyId,
          capacity: (sector as { capacity?: unknown }).capacity,
          mothballed: (sector as { mothballed?: unknown }).mothballed,
        })),
        currentYear: gameState?.currentYear,
        unlockedTechnologyIds: corporation.unlockedTechNodeIds,
        techTreesEnabled: await isSectorTechTreesEnabled(
          gameState ? { sectorTechTreesEnabled: gameState.sectorTechTreesEnabled } : undefined
        ),
      });
      if (!compatibility.ok) {
        return NextResponse.json({ error: compatibility.message }, { status: 400 });
      }
    }

    // Media products additionally need an owned operating model fitting the
    // corporation, in the right era with the right research. The messages
    // name the blocker so the Studio can show it directly.
    if (kind.family === "media_entertainment") {
      const gameState = await getGameState(db);
      const media = validateMediaProductStart({
        kindId: kind.id,
        corporationType: corporation.type,
        operatingModels: owned.map((model) => model.operatingModel),
        currentYear: gameState?.currentYear,
        unlockedTechnologyIds: corporation.unlockedTechNodeIds,
      });
      if (!media.ok) {
        return NextResponse.json({ error: media.message }, { status: 400 });
      }
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
