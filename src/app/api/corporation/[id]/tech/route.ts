/**
 * GET /api/corporation/[id]/tech — read model for the branching Tech tab (v2).
 *
 * Returns each decade's two lanes (Corporate / Sector) with per-node state
 * (owned, lane-locked, affordable in rd + cash, auto-granted, unlocked method),
 * the committed lane, tier art, and the corp's rd/cash wallet. For private corps
 * the picks + wallet are redacted for non-CEO viewers (tree definition stays).
 * When the gate is off, `enabled: false` and the tab hides itself.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { getGameState } from "@/lib/gameState";
import { getAuthUser } from "@/lib/auth";
import { shouldRedactCorporation } from "@/lib/corporations/redaction";
import { isSectorTechTreesEnabled } from "@/lib/corporations/techTree/featureFlag";
import {
  CORPORATION_TYPE_LABELS,
  RD_INNOVATION_INTERVAL,
  RD_INNOVATION_SCORE_THRESHOLD,
} from "@/lib/constants/corporations";
import { calculateCorpStrengthProjection } from "@/lib/corporations/strengthProjection";
import { getCorpFxRate } from "@/lib/currency/corporationCapital";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import {
  TECH_DECADES,
  TECH_TREE,
  isDecadeReached,
  getDecadeForYear,
  getDecadeLaneNodes,
  getCommittedLane,
  getNodePrereqId,
  getPassedDecadeIds,
  getUnlockedStrategyIds,
  getSectorTechEffects,
  SLOT_PARENT,
  techNodeCashCost,
  tierImageUrl,
  describeTechEffect,
  techEffectCategory,
  TECH_MARGIN_BONUS_CAP_PP,
  type TechCorpView,
  type TechLane,
} from "@/lib/constants/techTree";
import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import type { CorporateSector } from "@/lib/db/types";
import { sectorEconomicScale } from "@/lib/corporations/sectorProfitBasis";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = await getDb();

    const gameState = await getGameState();
    if (!(await isSectorTechTreesEnabled(gameState ?? undefined))) {
      return NextResponse.json({ enabled: false });
    }

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const authUser = await getAuthUser().catch(() => null);
    const isCeo =
      !corporation.ceoVacant &&
      !!authUser?.userId &&
      corporation.userId?.toString() === authUser.userId;
    const redact = shouldRedactCorporation(
      corporation,
      authUser?.userId ?? undefined,
      authUser?.isAdmin === true
    );

    const currentTurn = gameState?.currentTurn ?? 1;
    const startingYear = gameState?.startingYear ?? STARTING_YEAR;
    const currentYear =
      gameState?.currentYear ?? startingYear + Math.floor((currentTurn - 1) / TURNS_PER_YEAR);

    const corpView: TechCorpView = {
      type: corporation.type,
      unlockedTechNodeIds: corporation.unlockedTechNodeIds,
      techDecadeLane: corporation.techDecadeLane,
    };
    const unlocked = new Set(corporation.unlockedTechNodeIds ?? []);
    const passedDecades = new Set(getPassedDecadeIds(currentYear));
    const strategyNameById = new Map(
      (SECTOR_STRATEGIES[corporation.type] ?? []).map((s) => [s.id, s.name])
    );

    // Daily gross revenue → per-node cash cost. Null when redacted.
    let dailyGrossRevenue: number | null = null;
    if (!redact) {
      const sectors = await db
        .collection<CorporateSector>("corporateSectors")
        .find(
          { corporationId: corporation._id },
          { projection: { revenue: 1, capitalStock: 1, strategyId: 1, sectorType: 1 } }
        )
        .toArray();
      // sector.revenue is stored as daily revenue; sum directly (no ×TURNS_PER_DAY).
      // `sectorEconomicScale` is the SAME base `unlockTechNode` charges against —
      // under plants that is max(revenue, capacity nameplate), so a mothballed
      // estate does not quote a 0 cash cost here and then get charged one there
      // (or vice versa). The displayed price and the executor's price must never
      // disagree; that is the whole reason this reads the same helper.
      const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");
      const eraUnitScale = await loadWorldEraUnitScale(db);
      dailyGrossRevenue = sectors.reduce(
        (sum, s) => sum + sectorEconomicScale(s, plantsEnabled, eraUnitScale),
        0
      );
    }
    const rdScore = redact ? null : Math.floor(corporation.rdScore ?? 0);
    const liquidCapital = redact ? null : Math.floor(corporation.liquidCapital ?? 0);

    const buildLane = (
      decadeId: string,
      reached: boolean,
      committed: TechLane | undefined,
      lane: TechLane
    ) => {
      const isPastDecade = passedDecades.has(decadeId);
      return getDecadeLaneNodes(corporation.type, decadeId, lane).map((node) => {
        const owned = unlocked.has(node.id);
        const cashCost = techNodeCashCost(node, dailyGrossRevenue ?? 0);
        // Past decades have both lanes auto-granted — no lane commitment applies.
        const laneLocked = isPastDecade ? false : !!committed && committed !== lane;
        const prereqId = getNodePrereqId(node);
        const prereqMet = !prereqId || unlocked.has(prereqId);
        const strategyEffect = node.effects.find((e) => e.kind === "unlockStrategy");
        return {
          id: node.id,
          name: node.name,
          description: node.description,
          slot: node.slot,
          parentSlot: SLOT_PARENT[node.slot] ?? null,
          cost: node.cost,
          cashCost: redact ? null : cashCost,
          effects: node.effects.map((e) => ({
            category: techEffectCategory(e.kind),
            label: describeTechEffect(e),
          })),
          unlocksStrategy: strategyEffect
            ? (strategyNameById.get((strategyEffect as { strategyId: string }).strategyId) ??
              (strategyEffect as { strategyId: string }).strategyId)
            : null,
          owned: redact ? false : owned,
          autoGranted: !redact && owned && isPastDecade,
          laneLocked: redact ? false : laneLocked,
          prereqMet: redact ? false : prereqMet,
          affordable:
            !redact &&
            isCeo &&
            reached &&
            !owned &&
            !laneLocked &&
            prereqMet &&
            (rdScore ?? 0) >= node.cost &&
            (liquidCapital ?? 0) >= cashCost,
          image: tierImageUrl(lane, corporation.type, decadeId),
        };
      });
    };

    const decades = TECH_DECADES.map((d) => {
      const reached = isDecadeReached(d.id, currentYear);
      const isPastDecade = passedDecades.has(d.id);
      // Past decades have both lanes auto-granted — no lane commitment applies.
      const committed = redact || isPastDecade ? undefined : getCommittedLane(corpView, d.id);
      return {
        id: d.id,
        label: d.label,
        reached,
        autoGrantedDecade: isPastDecade,
        committedLane: committed ?? null,
        lanes: {
          generic: buildLane(d.id, reached, committed, "generic"),
          sector: buildLane(d.id, reached, committed, "sector"),
        },
      };
    });

    // Headline margin = the effective bonus on the corp's PRIMARY sector
    // (Corporate-lane scaled + Sector-lane full), which is the strongest case.
    const agg = redact ? null : getSectorTechEffects(corpView, corporation.type);

    // ── Tech overview metrics ──────────────────────────────────────────────
    const totalNodes = (TECH_TREE[corporation.type] ?? []).length;
    const techsUnlocked = redact ? 0 : (corporation.unlockedTechNodeIds ?? []).length;
    // Nodes the CEO could unlock right now (affordable across every visible lane).
    const unlockableCount = redact
      ? 0
      : decades.reduce(
          (sum, d) =>
            sum +
            d.lanes.generic.filter((n) => n.affordable).length +
            d.lanes.sector.filter((n) => n.affordable).length,
          0
        );
    // Random R&D breakthrough (rdInnovation): every RD_INNOVATION_INTERVAL turns,
    // probability = min(1, rdScore / threshold). Surfaced read-only for awareness.
    const breakthroughChance = redact
      ? null
      : Math.min(1, (corporation.rdScore ?? 0) / RD_INNOVATION_SCORE_THRESHOLD);
    const unlockedStrategyNames = redact
      ? []
      : getUnlockedStrategyIds(corpView).map((id) => strategyNameById.get(id) ?? id);

    // rdDemandFactor: ±15% signal based on tech-ecosystem + sector commodity D/S
    const SECTOR_RD_COMS: Record<string, [string, string?]> = {
      energy: ["coal", "natural_gas"],
      mining: ["iron_ore", "copper"],
      agriculture: ["grain", "produce"],
      manufacturing: ["steel", "industrial_chemicals"],
      technology: ["electronics", "rare_earth"],
      pharmaceuticals: ["pharmaceuticals", "industrial_chemicals"],
      finance: ["consulting_services", "software"],
      media: ["software", "consulting_services"],
      retail: ["consumer_goods", "produce"],
      healthcare: ["pharmaceuticals", "consulting_services"],
      education: ["consulting_services", "software"],
      transportation: ["petroleum", "steel"],
      construction: ["steel", "timber"],
      utilities: ["coal", "natural_gas"],
      telecoms: ["electronics", "software"],
      hospitality: ["produce", "consumer_goods"],
      legal: ["consulting_services", "software"],
    };
    let rdDemandFactor: number | null = null;
    if (!redact) {
      const [sc1, sc2] = SECTOR_RD_COMS[corporation.type] ?? [];
      const comTypes = Array.from(
        new Set(["software", "consulting_services", sc1, sc2].filter(Boolean) as string[])
      );
      const comDocs = (await db
        .collection("commodityPrices")
        .find(
          { commodity: { $in: comTypes } },
          { projection: { commodity: 1, globalSupply: 1, globalDemand: 1 } }
        )
        .toArray()) as unknown as {
        commodity: string;
        globalSupply: number;
        globalDemand: number;
      }[];
      const comMap = new Map(
        comDocs.map((c) => [c.commodity, { supply: c.globalSupply, demand: c.globalDemand }])
      );
      const ds = (c: string) => {
        const b = comMap.get(c);
        return !b || b.supply <= 0 ? 1 : b.demand / b.supply;
      };
      const ratios = [ds("software"), ds("consulting_services")];
      if (sc1) ratios.push(ds(sc1));
      if (sc2) ratios.push(ds(sc2));
      const avg = ratios.reduce((s, v) => s + v, 0) / ratios.length;
      rdDemandFactor =
        Math.round(Math.min(1.15, Math.max(0.85, 1 + (avg - 1) * 0.25)) * 1000) / 1000;
    }

    // FX rate for anchor-normalizing the R&D budget in rdGainPerTurn below.
    const corpFxRate = await getCorpFxRate(db, corporation);

    return NextResponse.json({
      enabled: true,
      sectorType: corporation.type,
      sectorLabel: CORPORATION_TYPE_LABELS[corporation.type] ?? corporation.type,
      currencyCode: corporation.liquidCurrencyCode ?? "USD",
      currentYear,
      currentDecadeId: getDecadeForYear(currentYear).id,
      isCeo,
      redacted: redact,
      rdScore,
      rdBudget: redact ? null : Math.round(corporation.rdBudget ?? 0),
      // Mirror the turn engine / Budget / Operations formula exactly: FX-anchor
      // the R&D budget and subtract decay (calculateCorpStrengthProjection).
      // Previously fed the RAW local-currency rdBudget straight into calcRdGrowth
      // with no anchor and no decay, which inflated the figure ~2.7× for non-USD
      // corps (e.g. JPY ~130× budget through the log curve) and disagreed with
      // every other tab (#903).
      rdGainPerTurn: redact
        ? null
        : Math.round(
            calculateCorpStrengthProjection(corporation, corpFxRate).rdScoreNetChange * 10
          ) / 10,
      liquidCapital,
      unlockedStrategyIds: redact ? [] : getUnlockedStrategyIds(corpView),
      unlockedStrategyNames,
      // Active tech-effect summary (transparency for the capped margin).
      activeMarginPp: agg ? Math.round(agg.marginBonusPp * 10) / 10 : null,
      activeMarginRawPp: agg ? Math.round(agg.marginBonusPpRaw * 10) / 10 : null,
      marginCapPp: TECH_MARGIN_BONUS_CAP_PP,
      // Overview metrics.
      totalNodes,
      techsUnlocked,
      unlockableCount,
      breakthroughChance,
      breakthroughInterval: RD_INNOVATION_INTERVAL,
      rdDemandFactor,
      decades,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
