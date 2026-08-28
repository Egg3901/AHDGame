import { NextResponse } from "next/server";
import { loadWorkforceSkillByState } from "@/lib/politicalLegislation/workforceSkillLoader";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getGdpAnchorRate, loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import { getEraUnitScale } from "@/lib/constants/sectorSeedEra";
import type {
  State,
  Corporation,
  CorporateSector,
  Character,
  StateMetrics,
  Tariff,
  UnownedSector,
  ImperialCharacter,
  User,
} from "@/lib/db/types";
import { getEffectiveTariffRate, getSplitCaptureMultiplier } from "@/lib/tariffs/tariffEffects";
import { loadActiveFtaPairs } from "@/lib/tariffs/ftaOverrides";
import {
  fxRateForSectorHostFromMap,
  loadFxRatesByCurrency,
  resolveSectorHostCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import {
  CORPORATION_TYPES,
  CORPORATION_TYPE_LABELS,
  SECTOR_MARKET_GDP_FRACTION,
  SECTOR_TYPE_COUNT,
  SPLIT_BASE_CAPTURE_FRACTION,
  UNOWNED_CAPTURE_BONUS_MULTIPLIER,
  ATTACK_OWNED_CONTESTED_FRACTION,
  MS_CAPTURE_DIVISOR,
  calculateWorkers,
  getDominanceAttackEaseMultiplier,
  getUnderdogAttackAmplifier,
} from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import { roundMarketingStrength } from "@/lib/utils/formatters";
import {
  calculateAttackCostAnchor,
  calculateSplitCostAnchor,
  calculateSplitMsCost,
} from "@/lib/corporations/marketActionCosts";
import {
  attackCapacityBasisAnchor,
  attackCostAnchorUnderPlants,
  capacityCaptureUnits,
  resolveWorldYear,
} from "@/lib/corporations/capacityCapture";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { computeUnownedHeadroomUnits } from "@/lib/market/unownedHeadroom";
import { shouldRedactCorporation } from "@/lib/corporations/redaction";
import { effectiveMarketAnchor } from "@/lib/corporations/marketShare";
import { aggregateCountrySectorMix } from "@/lib/economy/sectorMix";
import { loadNationalGdpGrowth } from "@/lib/country/nationalGdpGrowth";
import type { GameState } from "@/lib/db/types/gameState";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

// GET /api/country/[code]/region/[id]/economy — Return the economic sector breakdown for a region including corporate ownership
// Auth: public
// Errors: 400, 404
/**
 * GET /api/country/[code]/region/[id]/economy
 * Returns the economic breakdown for a state: each sector type with total market size,
 * owned portions (by corporations), and unowned remainder.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const stateId = id;

    const db = await getDb();

    // Optionally get current user's corporation for UI hints
    let userCorporationId: string | null = null;
    let userCorporationSectorType: CorporationType | null = null;
    let userMarketingStrength = 0;
    let userSplitEscalation = 0;
    let userCorpCountryId: string | null = null;
    const user = await getAuthUser();

    // Private-corp redaction context (mirrors /api/corporations/[id]). Private
    // corps hide marketingStrength/revenue/workers from anyone who isn't the
    // owner, an admin, or a moderator viewing with ?modView=1.
    const viewerUserId = user?.userId;
    const viewerIsAdmin = user?.isAdmin === true;
    const modViewEnabled =
      !user?.isAdmin &&
      user?.isModerator === true &&
      new URL(request.url).searchParams.get("modView") === "1";

    if (user) {
      const corpProjection = {
        projection: {
          _id: 1,
          type: 1,
          marketingStrength: 1,
          splitEscalation: 1,
          countryId: 1,
        },
      };

      // Check imperial mode first, then fall back to regular character
      const userDoc = await db
        .collection<User>("users")
        .findOne({ _id: new ObjectId(user.userId) });
      let corp: Corporation | null = null;

      if (userDoc?.activeCharacterType === "imperial" && userDoc.activeImperialCharacterId) {
        const imperial = await db
          .collection<ImperialCharacter>("imperialCharacters")
          .findOne({ _id: userDoc.activeImperialCharacterId, userId: new ObjectId(user.userId) });
        if (imperial) {
          corp = await db
            .collection<Corporation>("corporations")
            .findOne(
              { ceoId: imperial._id, ceoType: "imperial", ceoVacant: { $ne: true } },
              corpProjection
            );
        }
      } else {
        const character = await db.collection<Character>("characters").findOne({
          userId: new ObjectId(user.userId),
        });
        if (character) {
          corp = await db
            .collection<Corporation>("corporations")
            .findOne({ ceoId: character._id, ceoVacant: { $ne: true } }, corpProjection);
        }
      }

      if (corp) {
        userCorporationId = corp._id.toString();
        userCorporationSectorType = corp.type;
        userMarketingStrength = corp.marketingStrength ?? 0;
        userSplitEscalation = corp.splitEscalation ?? 0;
        userCorpCountryId = corp.countryId ?? null;
      }
    }

    // The country-wide states read that used to live here existed only to
    // population-weight a national GDP-growth average. That average was the wrong
    // aggregate (see below), so the read went with it.
    const [state, stateMetricsDoc, stateTariffs, stateCapDoc, activeFtaPairs] = await Promise.all([
      db.collection<State>("states").findOne({ _id: stateId, countryId }),
      // SP5: workforce skill spans both pipelines — shared loader.
      loadWorkforceSkillByState(db, [stateId]).then((m) => {
        const value = m.get(stateId);
        return value == null
          ? null
          : ({ education: { workforceSkill: { value } } } as StateMetrics);
      }),
      db.collection<Tariff>("tariffs").find({ countryId }).toArray(),
      db
        .collection("stateResourceCapacity")
        .findOne({ stateId }, { projection: { stateId: 1, resources: 1 } }),
      loadActiveFtaPairs(db),
    ]);
    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }
    const workforceSkill = stateMetricsDoc?.education?.workforceSkill?.value ?? null;

    // Macro header context. Null-safe throughout: missing metrics degrade the
    // header, they never fail the route.
    //
    // This region's own rate comes from its own metrics document.
    const regionGrowthDoc = await db
      .collection<StateMetrics>("macroMetrics")
      .findOne({ _id: stateId }, { projection: { "economic.gdpGrowth.value": 1 } });
    const regionGrowthValue = regionGrowthDoc?.economic?.gdpGrowth?.value;
    const stateGdpGrowth =
      typeof regionGrowthValue === "number" && Number.isFinite(regionGrowthValue)
        ? regionGrowthValue
        : null;

    // The NATIONAL figure is the canonical one, NOT a population-weighted mean of
    // the regions. This page reported 6.56% for RU where the Economy and Central
    // Bank pages both said 5.14%, because population is the wrong weight: the
    // engine compounds each region's GDP by that region's own rate, so only a
    // GDP-weighted aggregate is consistent, and the national doc already is one.
    // See lib/country/nationalGdpGrowth.
    const growthGameState = await db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { currentYear: 1, currentTurn: 1 } });
    const nationalGdpGrowth = await loadNationalGdpGrowth(
      db,
      countryId,
      growthGameState?.currentYear
    );

    // Total market size per sector type based on state GDP. The GDP→₳ rate is
    // era-scoped (refs #3778): a 1953 world normalizes with 1953 rates, not the
    // base config's modern/1979 ones.
    const economyPreset = await loadWorldPreset(db);
    const usdExchangeRate = getGdpAnchorRate(countryId, economyPreset);
    const eraUnitScale = getEraUnitScale(economyPreset);
    // World year for plants build pricing in the attack quote below — resolved
    // the same way the attack-sector route resolves it.
    const worldYear = resolveWorldYear(
      growthGameState?.currentYear,
      growthGameState?.currentTurn
    );
    const totalMarketPerSector = Math.round(
      (state.gdp * usdExchangeRate * SECTOR_MARKET_GDP_FRACTION) / SECTOR_TYPE_COUNT
    );

    // Get all corporate sectors in this state
    const sectors = await db
      .collection<CorporateSector>("corporateSectors")
      .find({ stateId })
      .toArray();

    // Get unowned sectors for this state from DB
    const unownedDocs = await db
      .collection<UnownedSector>("unownedSectors")
      .find({ stateId })
      .toArray();
    const unownedByType = new Map(unownedDocs.map((u) => [u.sectorType, u.revenue]));
    // Plants tier: the state board reframes the unowned pool as UNMET DEMAND in
    // output units, because that is the quantity a player can actually act on
    // (build against) rather than a ₳ pool they can no longer buy into. Headroom
    // is self-healed from revenue for rows predating the backfill — a bare 0
    // there would report a busy market as having no demand at all.
    const plantsMode = marketAtLeast(await getMarketSystemModeForDb(db), "plants");
    const headroomUnitsByType = new Map(
      unownedDocs.map((u) => [
        u.sectorType,
        u.headroomUnits != null && Number.isFinite(u.headroomUnits)
          ? u.headroomUnits
          : computeUnownedHeadroomUnits(u.sectorType, u.revenue ?? 0, eraUnitScale),
      ])
    );

    // Get corporation details for each sector
    const corpIds = [...new Set(sectors.map((s) => s.corporationId))];
    const corporations =
      corpIds.length > 0
        ? await db
            .collection<Corporation>("corporations")
            .find({ _id: { $in: corpIds } })
            .project({
              _id: 1,
              name: 1,
              ceoId: 1,
              ceoType: 1,
              ceoVacant: 1,
              sequentialId: 1,
              brandColor: 1,
              logoUrl: 1,
              marketingStrength: 1,
              countryOwnerId: 1,
              countryId: 1,
              liquidCurrencyCode: 1,
              isPrivate: 1,
              userId: 1,
            })
            .toArray()
        : [];
    const corpMap = new Map(corporations.map((c) => [c._id.toString(), c]));

    // Sector economic fields are stored in the HOST market's currency, not
    // the owner's home currency. Normalize host -> ₳ before aggregating mixed
    // domestic/foreign ownership in this regional market.
    const fxByCurrency = await loadFxRatesByCurrency(db);
    const sectorRevenueAnchorById = new Map<string, number>();
    for (const s of sectors) {
      const owner = corpMap.get(s.corporationId.toString());
      const hostCode = resolveSectorHostCurrencyCode(s, owner);
      const hostRate = fxRateForSectorHostFromMap(s, owner, fxByCurrency);
      sectorRevenueAnchorById.set(
        s._id.toString(),
        readCorpEconomicAnchor(s.revenue, hostCode, hostRate)
      );
    }

    // Get CEO names for display — query both characters and imperialCharacters
    const regularCeoIds: import("mongodb").ObjectId[] = [];
    const imperialCeoIds: import("mongodb").ObjectId[] = [];
    for (const c of corporations) {
      if (!c.ceoId) continue;
      if ((c as Corporation).ceoType === "imperial") {
        imperialCeoIds.push(c.ceoId);
      } else {
        regularCeoIds.push(c.ceoId);
      }
    }

    const ceoProjection = { _id: 1, name: 1, sequentialId: 1, countryId: 1 };
    const [regularCeos, imperialCeos] = await Promise.all([
      regularCeoIds.length > 0
        ? db
            .collection<Character>("characters")
            .find({ _id: { $in: regularCeoIds } })
            .project<{
              _id: import("mongodb").ObjectId;
              name: string;
              sequentialId?: number;
              countryId?: string;
            }>(ceoProjection)
            .toArray()
        : [],
      imperialCeoIds.length > 0
        ? db
            .collection<ImperialCharacter>("imperialCharacters")
            .find({ _id: { $in: imperialCeoIds } })
            .project<{
              _id: import("mongodb").ObjectId;
              name: string;
              sequentialId?: number;
              countryId?: string;
            }>(ceoProjection)
            .toArray()
        : [],
    ]);
    const ceoMap = new Map([...regularCeos, ...imperialCeos].map((c) => [c._id.toString(), c]));

    // Drop orphan sectors (corporationId points to a deleted corp). These show up
    // as "Unknown" defenders in the UI and any Attack Sector click against them
    // dies at the defender lookup in /attack-sector. Filtering here removes them
    // from the owners list so they no longer surface as attackable rows; the
    // unowned-market fallback naturally absorbs the empty slot. A separate
    // migration sweeps the stale rows out of `corporateSectors`.
    const liveSectors = sectors.filter((s) => corpMap.has(s.corporationId.toString()));

    // Group sectors by type
    const sectorsByType = new Map<CorporationType, CorporateSector[]>();
    for (const sector of liveSectors) {
      const list = sectorsByType.get(sector.sectorType) ?? [];
      list.push(sector);
      sectorsByType.set(sector.sectorType, list);
    }

    // Build response for each sector type. Revenue aggregation + market-share
    // ratio both run on ₳-normalized values via sectorRevenueAnchorById so
    // mixed-currency corps in the same state (cross-border ownership) don't
    // distort the totals. Per-row `revenue` stays ₳ too — UI layer formats
    // via wallet preference (no native corp-currency stamped per row because
    // rows can be from different-currency corps).
    const economySectors = CORPORATION_TYPES.map((sectorType) => {
      const typeSectors = sectorsByType.get(sectorType) ?? [];
      const ownedRevenue = typeSectors.reduce(
        (sum, s) => sum + (sectorRevenueAnchorById.get(s._id.toString()) ?? 0),
        0
      );
      // Use the persisted unowned pool when present so admin-spawned market is preserved.
      // If the pool has not been seeded yet, fall back to the GDP-derived market gap —
      // but never below the revenue already owned in this (state, sectorType): a sector
      // can't hold >100% of its market. Without that floor, a nationalization that
      // consumed the unowned pool left a tiny GDP baseline against the consolidated
      // owned revenue, so every participant clamped to 100% (Bug #0775). Shared,
      // tested helper — same invariant the sector-detail + turn paths use.
      // unownedSectors.revenue is ₳-native (Task 9) so it sums safely with the anchor total.
      // Ticket #1145: under plants, market share is a corp's revenue over the
      // cell's TOTAL real revenue — there is no unowned pool in the denominator,
      // and splits are retired (estimatedCapture/splitCost below are already 0),
      // so unowned is 0. Below plants (legacy split worlds) keep the pool so the
      // split quotes further down still work.
      const persistedUnownedRevenue = unownedByType.get(sectorType);
      const effectiveTotalMarket = plantsMode
        ? Math.max(0, ownedRevenue)
        : effectiveMarketAnchor(ownedRevenue, persistedUnownedRevenue, totalMarketPerSector);
      const unownedRevenue = plantsMode ? 0 : Math.max(0, effectiveTotalMarket - ownedRevenue);

      // Attacker's share of this (state, sectorType) cell — used by the
      // underdog amplifier so the preview's capture estimate matches what the
      // attack route will actually produce.
      const userRevenueAnchorInType = userCorporationId
        ? typeSectors
            .filter((s) => s.corporationId.toString() === userCorporationId)
            .reduce((sum, s) => sum + (sectorRevenueAnchorById.get(s._id.toString()) ?? 0), 0)
        : 0;
      const attackerShareInType =
        effectiveTotalMarket > 0
          ? Math.min(100, (userRevenueAnchorInType / effectiveTotalMarket) * 100)
          : 0;

      const owners = typeSectors.map((s) => {
        const corp = corpMap.get(s.corporationId.toString());
        const ceo = corp?.ceoId && !corp.ceoVacant ? ceoMap.get(corp.ceoId.toString()) : null;
        const isNatcorp = !!corp?.countryOwnerId;
        const sectorRevenueAnchor = sectorRevenueAnchorById.get(s._id.toString()) ?? 0;
        const sectorMarketShare =
          effectiveTotalMarket > 0
            ? Math.min(100, Math.round((sectorRevenueAnchor / effectiveTotalMarket) * 10000) / 100)
            : 0;
        const dominanceAttackMult = getDominanceAttackEaseMultiplier(sectorMarketShare);
        const underdogMult = getUnderdogAttackAmplifier(attackerShareInType, sectorMarketShare);
        return {
          sectorId: s._id.toString(),
          corporationId: s.corporationId.toString(),
          corporationName: corp?.name ?? "Unknown",
          corporationSequentialId: corp?.sequentialId,
          displayName: s.displayName ?? null,
          sectorLabel: CORPORATION_TYPE_LABELS[s.sectorType as CorporationType],
          brandColor: corp?.brandColor,
          logoUrl: corp?.logoUrl ?? null,
          ceoName: ceo?.name ?? "Unknown",
          ceoCountryId: ceo?.countryId ?? null,
          ceoSequentialId: ceo?.sequentialId,
          revenue: Math.round(sectorRevenueAnchor),
          marketShare: sectorMarketShare,
          workers: calculateWorkers(sectorRevenueAnchor, workforceSkill),
          targetGrowthRate: s.targetGrowthRate ?? s.currentGrowthRate ?? s.growthRate ?? 0,
          currentGrowthRate: s.currentGrowthRate ?? s.growthRate ?? 0,
          productionLevel: s.productionPolicyLevel ?? 0,
          defenderMarketingStrength: roundMarketingStrength(corp?.marketingStrength ?? 0),
          isNatcorp,
          isNpp: corp?.ceoType === "npp",
          // For-sale listing (₳-anchored price) — surfaces "for sale" badge
          // and asking price on the state economy view.
          forSale: s.forSale
            ? {
                listedAt: s.forSale.listedAt,
                priceAnchor: s.forSale.priceAnchor,
                npvAnchor: s.forSale.npvAnchor,
              }
            : null,
          // Attack-owned estimates (when user has corp, not own sector, and not a natcorp).
          // Cost denominated in ₳ so the UI formatter can convert to whatever
          // currency the attacker's wallet prefers. Dominance multiplier scales
          // the contested fraction so dominant defenders bleed more per attack.
          ...(userCorporationId &&
            userCorporationId !== s.corporationId.toString() &&
            !isNatcorp &&
            (() => {
              // Quote the SAME cost/capture the attack-sector route enforces, or
              // the card advertises a price the route then rejects (#1212: card
              // showed the legacy revenue-based cost while the route charged the
              // plants build-price floor — "Insufficient capital" on an attack
              // the card said was affordable).
              //
              // Under plants the attack is sized against the defender's CAPACITY
              // NAMEPLATE (not restated revenue) and priced at least at the build
              // price of the units received × premium — mirror both here.
              const attackBasisAnchor =
                attackCapacityBasisAnchor(
                  {
                    sectorType: s.sectorType as CorporationType,
                    capitalStock: s.capitalStock,
                    strategyId: s.strategyId,
                  },
                  plantsMode,
                  eraUnitScale
                ) ?? sectorRevenueAnchor;
              const defenderMS = corp?.marketingStrength ?? 0;
              const msSum = userMarketingStrength + defenderMS;
              const attackerShare = msSum > 0 ? userMarketingStrength / msSum : 1;
              const contestedAmount =
                attackBasisAnchor *
                ATTACK_OWNED_CONTESTED_FRACTION *
                dominanceAttackMult *
                underdogMult;
              const actualCapture = Math.min(
                Math.round(contestedAmount * attackerShare),
                Math.max(0, Math.floor(attackBasisAnchor) - 1)
              );
              const legacyCostAnchor = calculateAttackCostAnchor(attackBasisAnchor);
              let attackCost = legacyCostAnchor;
              if (plantsMode) {
                const defenderStock =
                  typeof s.capitalStock === "number" && Number.isFinite(s.capitalStock)
                    ? Math.max(0, s.capitalStock)
                    : 0;
                const rawUnits = capacityCaptureUnits(
                  actualCapture,
                  s.sectorType as CorporationType,
                  s.strategyId,
                  eraUnitScale
                );
                const unitsTaken = Math.min(defenderStock, rawUnits.unitsTaken);
                const unitsReceived =
                  rawUnits.unitsTaken > 0
                    ? rawUnits.unitsReceived * (unitsTaken / rawUnits.unitsTaken)
                    : 0;
                attackCost = attackCostAnchorUnderPlants({
                  legacyCostAnchor,
                  unitsReceived,
                  sectorType: s.sectorType as CorporationType,
                  year: worldYear,
                  eraUnitScale,
                });
              }
              return { attackCost, attackEstimatedCapture: actualCapture };
            })()),
        };
      });

      // Display corps from largest share to smallest so the UI ranks dominant
      // players first. marketShare is rounded to 0.01%; revenue is rounded to
      // whole anchor units, giving finer granularity, so it tiebreaks cleanly
      // when two corps round to the same share. Sort is stable, so identical
      // revenues preserve insertion order.
      owners.sort((a, b) => b.marketShare - a.marketShare || b.revenue - a.revenue);

      // Private corps hide marketingStrength/revenue/workers from non-CEO/admin/mod
      // viewers (canonical allowlist in lib/corporations/redaction). marketShare is
      // kept so the ownership ranking / Sector Targets view still works. Attack
      // cost and estimated capture are KEPT visible — they are derived from
      // revenue, but nulling them hides the Attack button in the UI, making
      // private corps effectively immune to market-share attacks (reported bug).
      // The defender's sensitive data (revenue, workers, MS) is still hidden.
      // Redact after sorting so the revenue tiebreak above stays intact.
      const redactedOwners = owners.map((o) => {
        const corp = corpMap.get(o.corporationId);
        const redact =
          !!corp &&
          shouldRedactCorporation(
            { isPrivate: corp.isPrivate, userId: corp.userId },
            viewerUserId,
            viewerIsAdmin,
            modViewEnabled
          );
        if (!redact) return o;
        return {
          ...o,
          revenue: null as number | null,
          workers: null as number | null,
          defenderMarketingStrength: null as number | null,
        };
      });

      // Unowned SPLITS are retired under plants — capacity is built, rivals are
      // attacked. Still compute split quotes off-plants so legacy worlds work.
      const sectorCountry = countryId;
      const tariffEffectiveRate =
        userCorpCountryId !== null
          ? getEffectiveTariffRate(
              stateTariffs,
              sectorCountry,
              sectorType,
              userCorpCountryId as CountryId,
              undefined,
              activeFtaPairs
            )
          : 0;
      const isDomesticSplitting = userCorpCountryId !== null && sectorCountry === userCorpCountryId;
      const tariffMultiplier = getSplitCaptureMultiplier(tariffEffectiveRate, isDomesticSplitting);
      const captureMultiplier = (1 + userMarketingStrength / MS_CAPTURE_DIVISOR) * tariffMultiplier;
      const estimatedCapture = plantsMode
        ? 0
        : Math.min(
            Math.round(
              unownedRevenue *
                SPLIT_BASE_CAPTURE_FRACTION *
                captureMultiplier *
                UNOWNED_CAPTURE_BONUS_MULTIPLIER
            ),
            Math.round(unownedRevenue)
          );

      const estimatedCapturePercent =
        !plantsMode && effectiveTotalMarket > 0
          ? Math.round((estimatedCapture / effectiveTotalMarket) * 10000) / 100
          : 0;

      return {
        type: sectorType,
        label: CORPORATION_TYPE_LABELS[sectorType],
        totalMarket: effectiveTotalMarket,
        ownedRevenue: Math.round(ownedRevenue),
        unownedRevenue: Math.round(unownedRevenue),
        unownedPercent:
          effectiveTotalMarket > 0
            ? Math.round((unownedRevenue / effectiveTotalMarket) * 10000) / 100
            : 0,
        splitCost: plantsMode ? 0 : calculateSplitCostAnchor(unownedRevenue),
        estimatedCapture,
        estimatedCapturePercent,
        // Plants-tier: unmet demand in output units/day. Null elsewhere.
        headroomUnits: plantsMode
          ? Math.round(
              headroomUnitsByType.get(sectorType) ??
                computeUnownedHeadroomUnits(sectorType, unownedRevenue, eraUnitScale)
            )
          : null,
        tariffEffectiveRate,
        tariffMultiplier,
        owners: redactedOwners,
      };
    });

    // National effective-market totals per sector (₳) for the "X holds ≈Y% of
    // the national market" cross-link line. Same aggregation the national
    // Economic Outlook page renders, so the two surfaces can never disagree.
    const nationalMix = await aggregateCountrySectorMix(db, countryId);
    const nationalSectorTotals = Object.fromEntries(
      nationalMix.map((entry) => [entry.type, entry.totalMarketAnchor])
    );

    // NPP corps are individually attackable unless an admin explicitly disabled it.
    const attackCfg = await db
      .collection("gameConfig")
      .findOne({ _id: "default" } as Record<string, unknown>, {
        projection: { nppCorpsAttackable: 1 },
      });
    const nppAttackable =
      (attackCfg as { nppCorpsAttackable?: boolean } | null)?.nppCorpsAttackable !== false;

    return NextResponse.json({
      nppAttackable,
      plantsMode,
      stateId,
      stateName: state.name,
      stateGdp: state.gdp,
      macro: { stateGdpGrowth, nationalGdpGrowth },
      nationalSectorTotals,
      sectorSpecializations: state.sectorSpecializations
        ? {
            primary: state.sectorSpecializations.primary,
            primaryLabel: CORPORATION_TYPE_LABELS[state.sectorSpecializations.primary],
            primaryBonus: 10,
            secondary: state.sectorSpecializations.secondary,
            secondaryLabel: CORPORATION_TYPE_LABELS[state.sectorSpecializations.secondary],
            secondaryBonus: 5,
          }
        : null,
      totalMarketPerSector,
      sectors: economySectors,
      userCorporationId,
      userCorporationSectorType,
      userMarketingStrength: roundMarketingStrength(userMarketingStrength),
      // Rival attacks retain the escalation cost under plants even though
      // unowned-market splits are retired there.
      attackMsCost: calculateSplitMsCost(userSplitEscalation),
      // MS escalation only mattered for unowned splits; zero under plants so no
      // client can invent a Split CTA from a leftover quote.
      splitMsCost: plantsMode ? 0 : Math.pow(2, userSplitEscalation),
      stateResources: stateCapDoc?.resources ?? null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
