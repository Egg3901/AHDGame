/**
 * Corporation-level market share, aggregated by industry (sector type) across
 * the corporation's home country. Powers the Charts → Market Share view on the
 * corporation page.
 *
 * Reuses the anchor/effective-market primitives in `./marketShare.ts` (the same
 * denominator the per-sector routes and the Discord `marketshare` command use)
 * so every surface agrees. All revenue is FX-normalized to ₳ before comparison.
 */

import type { Db } from "mongodb";
import type { Corporation, CorporateSector, State, UnownedSector } from "@/lib/db/types";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import {
  loadFxRatesByCurrency,
  resolveSectorHostCurrencyCode,
  fxRateForSectorHostFromMap,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import { getEraUnitScale } from "@/lib/constants/sectorSeedEra";
import {
  computeMarketSharePercent,
  effectiveMarketAnchor,
  effectiveMarketUnits,
  gdpDerivedMarketAnchor,
  marketUnitsFromAnchor,
  sectorCapacityUnits,
  unownedHeadroomUnitsOf,
} from "./marketShare";

/** The focal corporation's market position in one industry (home country). */
export interface CorpMarketSharePosition {
  sectorType: CorporationType;
  label: string;
  /** Focal corp's ₳-normalized revenue in this industry. */
  revenueAnchor: number;
  /** Focal corp's share of the addressable market, 0–100. */
  marketSharePercent: number;
  /** 1-based rank among corporations active in this industry. */
  rank: number;
  /** Number of corporations (incl. the focal corp) active in this industry. */
  competitors: number;
  /** Share held by unowned / state-residual capacity, 0–100. */
  unownedPercent: number;
}

/** One industry's national rollup: every corp's basis plus the market total. */
export interface IndustryBasis {
  /** corpId → basis (capacity units under plants, else ₳ revenue). */
  basisByCorp: Map<string, number>;
  /** corpId → ₳ revenue, always, regardless of basis. */
  anchorByCorp: Map<string, number>;
  /** Denominator: the addressable national market on the same basis. */
  basisMarket: number;
}

/**
 * National per-industry rollup for one country. This is the SHARED denominator:
 * `computeCorpMarketShare` and the merger-review concentration test both read
 * it, so a combined post-merger share and a displayed single-corp share can
 * never be measured against different markets.
 */
export async function loadIndustryBasis(
  db: Db,
  countryId: CountryId,
  types: CorporationType[],
  plantsEnabled: boolean = false
): Promise<Map<CorporationType, IndustryBasis>> {
  const out = new Map<CorporationType, IndustryBasis>();
  if (types.length === 0) return out;

  const states = await db
    .collection<State>("states")
    .find({ countryId })
    .project<{ _id: string; gdp: number; countryId: CountryId }>({ _id: 1, gdp: 1, countryId: 1 })
    .toArray();
  if (states.length === 0) return out;
  const stateIds = states.map((s) => s._id);
  const stateById = new Map(states.map((s) => [s._id, s]));

  const [sectorsInScope, unownedInScope, fxByCurrency, preset] = await Promise.all([
    db
      .collection<CorporateSector>("corporateSectors")
      .find({ sectorType: { $in: types }, stateId: { $in: stateIds } })
      .project<
        Pick<
          CorporateSector,
          | "corporationId"
          | "sectorType"
          | "stateId"
          | "revenue"
          | "capitalStock"
          // strategyId is load-bearing for the capacity-unit basis: the
          // sector-level path (marketShare.ts) prices capacity at the sector's
          // OWN mix, so this rollup must project and pass it too or the two
          // denominators disagree for any non-standard strategy.
          | "strategyId"
        >
      >({
        corporationId: 1,
        sectorType: 1,
        stateId: 1,
        revenue: 1,
        capitalStock: 1,
        strategyId: 1,
      })
      .toArray(),
    db
      .collection<UnownedSector>("unownedSectors")
      .find({ sectorType: { $in: types }, stateId: { $in: stateIds } })
      .project<Pick<UnownedSector, "sectorType" | "stateId" | "revenue" | "headroomUnits">>({
        sectorType: 1,
        stateId: 1,
        revenue: 1,
        headroomUnits: 1,
      })
      .toArray(),
    loadFxRatesByCurrency(db),
    loadWorldPreset(db),
  ]);

  // Every in-scope sector is physically located in `countryId` (states are
  // filtered to this country, sectors to those states), so they all share one
  // host-state functional currency — the currency their revenue is stored in
  // regardless of which corp (foreign or domestic) owns them. Resolve the ₳
  // conversion rate once from the host country, not per owning corp.
  const hostCode = resolveSectorHostCurrencyCode({ countryId }, null);
  const hostRate = fxRateForSectorHostFromMap({ countryId }, null, fxByCurrency);
  const anchorFor = (revenue: number): number =>
    readCorpEconomicAnchor(revenue, hostCode, hostRate);
  const unitScale = getEraUnitScale(preset);

  for (const sectorType of types) {
    const typeSectors = sectorsInScope.filter((s) => s.sectorType === sectorType);
    const typeUnowned = unownedInScope.filter((u) => u.sectorType === sectorType);

    // Owned ₳-revenue per state (for the per-state effective market) and per corp
    // (for ranking). Unowned pool per state.
    const ownedAnchorByState = new Map<string, number>();
    const anchorByCorp = new Map<string, number>();
    // Plants tier: the same rollup on the capacity-unit basis.
    const ownedUnitsByState = new Map<string, number>();
    const unitsByCorp = new Map<string, number>();
    for (const sec of typeSectors) {
      const anchor = anchorFor(sec.revenue);
      ownedAnchorByState.set(sec.stateId, (ownedAnchorByState.get(sec.stateId) ?? 0) + anchor);
      const id = sec.corporationId.toString();
      anchorByCorp.set(id, (anchorByCorp.get(id) ?? 0) + anchor);
      if (plantsEnabled) {
        const units = sectorCapacityUnits(
          sectorType,
          sec.capitalStock,
          anchor,
          sec.strategyId,
          unitScale
        );
        ownedUnitsByState.set(sec.stateId, (ownedUnitsByState.get(sec.stateId) ?? 0) + units);
        unitsByCorp.set(id, (unitsByCorp.get(id) ?? 0) + units);
      }
    }
    const unownedByState = new Map<string, number>();
    const headroomUnitsByState = new Map<string, number>();
    for (const u of typeUnowned) {
      unownedByState.set(u.stateId, u.revenue);
      if (plantsEnabled) {
        headroomUnitsByState.set(
          u.stateId,
          unownedHeadroomUnitsOf(sectorType, u.headroomUnits, u.revenue, unitScale)
        );
      }
    }

    // National market = sum of per-state effective markets (same bucketing the
    // per-sector routes use, so shares stay <= 100%).
    let totalMarket = 0;
    let totalMarketUnits = 0;
    for (const s of states) {
      const owned = ownedAnchorByState.get(s._id) ?? 0;
      const gdpFallback = gdpDerivedMarketAnchor(
        stateById.get(s._id)?.gdp ?? 0,
        s.countryId,
        preset
      );
      totalMarket += effectiveMarketAnchor(owned, unownedByState.get(s._id), gdpFallback);
      if (plantsEnabled) {
        totalMarketUnits += effectiveMarketUnits(
          ownedUnitsByState.get(s._id) ?? 0,
          headroomUnitsByState.get(s._id),
          marketUnitsFromAnchor(sectorType, gdpFallback, unitScale)
        );
      }
    }

    // Fallback (c): if no unit denominator could be derived for this industry,
    // report it on the legacy revenue basis.
    const useUnits = plantsEnabled && totalMarketUnits > 0 && Number.isFinite(totalMarketUnits);
    out.set(sectorType, {
      basisByCorp: useUnits ? unitsByCorp : anchorByCorp,
      anchorByCorp,
      basisMarket: useUnits ? totalMarketUnits : totalMarket,
    });
  }

  return out;
}

/**
 * Compute the focal corporation's market-share position for each industry it
 * operates in, scoped to its home country. Read-only aggregation; returns an
 * empty array when the corp has no sectors or its country has no states.
 */
export async function computeCorpMarketShare(
  db: Db,
  corporation: Pick<Corporation, "_id" | "countryId">,
  corpSectors: Pick<CorporateSector, "sectorType">[],
  /**
   * Plants tier: aggregate the national rollup on the capacity-unit basis
   * (owned capitalStock vs unowned headroomUnits) instead of ₳ revenue. Omit
   * for legacy revenue behavior.
   */
  plantsEnabled: boolean = false
): Promise<CorpMarketSharePosition[]> {
  const focalId = corporation._id.toString();
  const types = [...new Set(corpSectors.map((s) => s.sectorType))] as CorporationType[];
  const byType = await loadIndustryBasis(db, corporation.countryId, types, plantsEnabled);

  const positions: CorpMarketSharePosition[] = [];
  for (const sectorType of types) {
    const basis = byType.get(sectorType);
    if (!basis) continue;
    const { basisByCorp, anchorByCorp, basisMarket } = basis;

    let totalOwned = 0;
    for (const a of basisByCorp.values()) totalOwned += a;

    const ranked = [...basisByCorp.entries()].sort((a, b) => b[1] - a[1]);
    const rankIdx = ranked.findIndex(([id]) => id === focalId);
    const focalAnchor = anchorByCorp.get(focalId) ?? 0;
    const focalBasis = basisByCorp.get(focalId) ?? 0;
    const unownedRevenue = Math.max(0, basisMarket - totalOwned);

    positions.push({
      sectorType,
      label: CORPORATION_TYPE_LABELS[sectorType],
      revenueAnchor: Math.round(focalAnchor),
      marketSharePercent:
        Math.round(computeMarketSharePercent(focalBasis, basisMarket) * 100) / 100,
      rank: rankIdx >= 0 ? rankIdx + 1 : ranked.length + 1,
      competitors: ranked.length,
      unownedPercent:
        Math.round(computeMarketSharePercent(unownedRevenue, basisMarket) * 100) / 100,
    });
  }

  positions.sort((a, b) => b.marketSharePercent - a.marketSharePercent);
  return positions;
}
