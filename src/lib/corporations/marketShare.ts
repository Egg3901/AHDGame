/**
 * Per-sector market share helpers.
 *
 * Market share = sector_revenue ÷ effective_market × 100, where
 * effective_market is the larger of the GDP-derived market floor and the
 * (owned + persisted unowned) sum. All inputs are anchor-denominated (₳); the
 * caller is responsible for converting per-corp local revenue to ₳ before
 * passing it in. See sectorCalculations.ts and economy routes for the same
 * normalization pattern.
 */

import type { Db } from "mongodb";
import type { CorporateSector, State, UnownedSector } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  resolveSectorHostCurrencyCode,
  fxRateForSectorHostFromMap,
  type CorpCapitalCurrencyInfo,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import {
  getGdpAnchorRate,
  isKnownGdpAnchorCountry,
  loadWorldPreset,
} from "@/lib/currency/gdpAnchorRate";
import { type CountryId } from "@/lib/constants/countries";
import { SECTOR_MARKET_GDP_FRACTION, SECTOR_TYPE_COUNT } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { getEraUnitScale } from "@/lib/constants/sectorSeedEra";
import {
  computeSectorImpliedUnits,
  computeUnownedHeadroomUnits,
} from "@/lib/market/unownedHeadroom";

/** Bounded market share percentage (0–100) given anchor-denominated inputs. */
export function computeMarketSharePercent(
  sectorRevenueAnchor: number,
  effectiveMarketAnchor: number
): number {
  if (effectiveMarketAnchor <= 0) return 0;
  const pct = (sectorRevenueAnchor / effectiveMarketAnchor) * 100;
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}

/**
 * GDP-derived baseline market size for one (state, sectorType) bucket, in ₳.
 * Mirrors the formula used by attack/economy/sector-detail routes.
 *
 * `preset` selects the era's GDP→₳ normalization (see
 * {@link getGdpAnchorRate}). Omitting it resolves the base config, which is
 * correct for every modern world and WRONG for a 1953 one — callers with a `db`
 * should pass `await loadWorldPreset(db)`.
 */
export function gdpDerivedMarketAnchor(
  stateGdp: number,
  countryId: CountryId,
  preset?: string
): number {
  if (!isKnownGdpAnchorCountry(countryId)) {
    // Defensive: a state/sector can carry a stale or unrecognized countryId
    // (e.g. pre-rename legacy data) even though the type says CountryId.
    // This runs inside per-corp/per-sector turn loops — throwing here takes
    // down the whole phase for every corporation, not just the bad one.
    console.warn(
      `[gdpDerivedMarketAnchor] unrecognized countryId "${countryId}" — falling back to usdExchangeRate=1`
    );
  }
  const usdExchangeRate = getGdpAnchorRate(countryId, preset);
  return Math.round((stateGdp * usdExchangeRate * SECTOR_MARKET_GDP_FRACTION) / SECTOR_TYPE_COUNT);
}

/**
 * Effective market size for a (state, sectorType): if a persisted unowned doc
 * exists, the market = ownedRevenue + persistedUnowned. Otherwise fall back to
 * the GDP-derived baseline. Matches the attack route + sector-detail routes.
 */
export function effectiveMarketAnchor(
  ownedRevenueAnchor: number,
  persistedUnownedRevenueAnchor: number | undefined,
  gdpFallback: number
): number {
  if (persistedUnownedRevenueAnchor !== undefined) {
    return Math.max(0, Math.round(ownedRevenueAnchor + persistedUnownedRevenueAnchor));
  }
  // No persisted unowned doc: fall back to the GDP-derived baseline, but never
  // below the revenue already owned in this bucket — a sector cannot hold more
  // than 100% of its market. Without this floor, a nationalization that consumed
  // the unowned pool left a tiny GDP baseline against a large consolidated
  // revenue, yielding market shares well over 100% (Bug #0775).
  return Math.max(gdpFallback, Math.round(Math.max(0, ownedRevenueAnchor)));
}

/* ------------------------------------------------------------------ *
 * Plants tier (marketSystemMode >= "plants", buildable-sectors P2 §5 D8)
 *
 * Under plants a sector IS its plants: owned CAPACITY (units/turn), not a
 * revenue nameplate, is the authoritative production base. Market share
 * therefore becomes a capacity ratio:
 *
 *     share = ownedCapacityUnits / (Σ ownedCapacityUnits + headroomUnits)
 *
 * Everything below is unit-denominated, via `impliedOutputUnits` (Σ revenue x
 * supplyRate / basePrice over a supply mix).
 *
 * WHICH MIX depends on what the quantity represents:
 *
 *   - An OWNED sector's units use the sector's OWN `strategyId` mix. A flipped
 *     sector's `capitalStock` was seeded from its own strategy, so converting
 *     an unflipped sibling through the default "standard" mix compared two
 *     different unit bases. For a focused specialist (e.g. a rare-earth miner,
 *     whose standard mix barely supplies the commodity it is built around) that
 *     understated its share by orders of magnitude — a LIVE defect under
 *     plants, not a rounding concern.
 *
 *   - The GDP FLOOR and UNOWNED HEADROOM stay on the default "standard" mix.
 *     Neither is a specific operator: the floor is generic market mass implied
 *     by state GDP, and an unowned sector is unclaimed demand with no strategy
 *     of its own (UnownedSector has no strategyId field). Converting either
 *     through some particular sector's specialism would make the denominator
 *     depend on which sector happened to be asking.
 *
 * Fallbacks, in order, per (state, sectorType) market:
 *   (a) a sector with no `capitalStock` (not yet flipped / lazily migrated)
 *       contributes its revenue-implied units;
 *   (b) an unowned doc with no `headroomUnits` (P1 backfill not run)
 *       contributes headroom computed on the fly from its ₳ revenue;
 *   (c) if the market still yields no usable unit denominator, the whole
 *       bucket falls back to the legacy revenue-based path.
 * ------------------------------------------------------------------ */

/**
 * Convert an ₳ amount into market units on the shared (default-strategy)
 * unit basis. Used for unflipped sectors, missing unowned headroom, and the
 * GDP floor, so all three are comparable with `capitalStock`.
 */
export function marketUnitsFromAnchor(
  sectorType: CorporationType,
  anchorAmount: number,
  unitScale: number
): number {
  return computeUnownedHeadroomUnits(sectorType, anchorAmount, unitScale);
}

/**
 * A sector's owned capacity in units: `capitalStock` when present
 * (authoritative under plants), else fallback (a) — units implied by revenue
 * ON THE SECTOR'S OWN STRATEGY MIX, matching the basis `capitalStock` itself
 * was seeded on (seedCapitalStock uses the sector's strategy rates). Omitting
 * `strategyId` falls back to the default mix.
 */
export function sectorCapacityUnits(
  sectorType: CorporationType,
  capitalStock: number | null | undefined,
  revenueAnchor: number,
  strategyId: string | null | undefined,
  unitScale: number
): number {
  if (typeof capitalStock === "number" && Number.isFinite(capitalStock) && capitalStock > 0) {
    return capitalStock;
  }
  return computeSectorImpliedUnits(sectorType, revenueAnchor, strategyId, unitScale);
}

/** Unowned headroom in units: persisted `headroomUnits`, else fallback (b). */
export function unownedHeadroomUnitsOf(
  sectorType: CorporationType,
  headroomUnits: number | null | undefined,
  revenue: number,
  unitScale: number
): number {
  if (typeof headroomUnits === "number" && Number.isFinite(headroomUnits) && headroomUnits >= 0) {
    return headroomUnits;
  }
  return computeUnownedHeadroomUnits(sectorType, revenue, unitScale);
}

/**
 * Unit-denominated twin of {@link effectiveMarketAnchor}: owned capacity plus
 * unowned headroom when an unowned doc exists, otherwise the GDP-derived floor
 * (converted to units by the caller) but never below what is already owned —
 * the same Bug #0775 floor, in units. Not rounded: capacity is fractional.
 */
export function effectiveMarketUnits(
  ownedCapacityUnits: number,
  headroomUnits: number | undefined,
  gdpFloorUnits: number
): number {
  const owned =
    Number.isFinite(ownedCapacityUnits) && ownedCapacityUnits > 0 ? ownedCapacityUnits : 0;
  if (headroomUnits !== undefined && Number.isFinite(headroomUnits)) {
    return Math.max(0, owned + Math.max(0, headroomUnits));
  }
  const floor = Number.isFinite(gdpFloorUnits) && gdpFloorUnits > 0 ? gdpFloorUnits : 0;
  return Math.max(floor, owned);
}

interface BuildSectorMarketShareInputs {
  sectors: CorporateSector[];
  /**
   * @deprecated No longer used. Sector revenue is denominated in its host-state
   * currency, resolved from the sector/state country — not the owning corp — so
   * per-owner FX resolution is unnecessary. Still accepted for call-site
   * compatibility; may be removed once all callers drop it.
   */
  corpById?: ReadonlyMap<string, CorpCapitalCurrencyInfo>;
  /** stateId → state document (gdp + countryId). */
  stateById: ReadonlyMap<string, Pick<State, "_id" | "gdp" | "countryId">>;
  /** Persisted unowned sector pool, ₳-denominated by convention (Task 9). */
  unownedSectors: UnownedSector[];
  /** FX rates so per-corp local revenue normalizes to ₳. */
  exchangeRatesByCurrency: ReadonlyMap<CurrencyCode, number>;
  /**
   * Active world preset, for the era-correct GDP→₳ normalization of the
   * GDP-derived market fallback. `loadWorldPreset(db)` at the caller. Omitting
   * it keeps the modern base config (a no-op outside a 1953 world).
   */
  preset?: string;
  /**
   * Plants tier: switch the share basis from revenue to owned capacity units.
   * Defaults to false — omitting it reproduces the legacy revenue path exactly.
   */
  plantsEnabled?: boolean;
}

/**
 * Build a sectorId → marketSharePercent map across every sector. Used by the
 * turn processor so per-sector growth-cost dominance penalties can be applied
 * consistently with what the player-facing routes display.
 */
export function buildMarketShareBySectorId(
  inputs: BuildSectorMarketShareInputs
): Map<string, number> {
  const { sectors, stateById, unownedSectors, exchangeRatesByCurrency, preset } = inputs;
  const plantsEnabled = inputs.plantsEnabled === true;
  const unitScale = getEraUnitScale(preset);

  // Anchor-normalize each sector's revenue once so we can sum and ratio against
  // it. Sector fields are stored in the sector's HOST-state currency (the market
  // it operates in), not the owning corp's — resolve the FX rate from the
  // sector's country (with the state's country as fallback), not per owning corp.
  const sectorRevenueAnchorById = new Map<string, number>();
  for (const sector of sectors) {
    const hostCountryId =
      (sector.countryId as CountryId | undefined) ??
      (stateById.get(sector.stateId)?.countryId as CountryId | undefined);
    const hostCode = resolveSectorHostCurrencyCode({ countryId: hostCountryId }, null);
    const hostRate = fxRateForSectorHostFromMap(
      { countryId: hostCountryId },
      null,
      exchangeRatesByCurrency
    );
    sectorRevenueAnchorById.set(
      sector._id.toString(),
      readCorpEconomicAnchor(sector.revenue, hostCode, hostRate)
    );
  }

  // Group sectors by (stateId, sectorType) and sum owned revenue.
  type BucketKey = string;
  const bucketKey = (stateId: string, sectorType: CorporationType): BucketKey =>
    `${stateId}::${sectorType}`;
  const ownedRevenueByBucket = new Map<BucketKey, number>();
  for (const sector of sectors) {
    const key = bucketKey(sector.stateId, sector.sectorType as CorporationType);
    const rev = sectorRevenueAnchorById.get(sector._id.toString()) ?? 0;
    ownedRevenueByBucket.set(key, (ownedRevenueByBucket.get(key) ?? 0) + rev);
  }

  const unownedByBucket = new Map<BucketKey, number>();
  for (const u of unownedSectors) {
    unownedByBucket.set(bucketKey(u.stateId, u.sectorType), u.revenue);
  }

  // Plants tier: per-sector capacity units and per-bucket owned-capacity sums,
  // plus unowned headroom in units (persisted, or derived — fallback (b)).
  const sectorUnitsById = new Map<string, number>();
  const ownedUnitsByBucket = new Map<BucketKey, number>();
  const headroomUnitsByBucket = new Map<BucketKey, number>();
  if (plantsEnabled) {
    for (const sector of sectors) {
      const id = sector._id.toString();
      const units = sectorCapacityUnits(
        sector.sectorType as CorporationType,
        sector.capitalStock,
        sectorRevenueAnchorById.get(id) ?? 0,
        sector.strategyId,
        unitScale
      );
      sectorUnitsById.set(id, units);
      const key = bucketKey(sector.stateId, sector.sectorType as CorporationType);
      ownedUnitsByBucket.set(key, (ownedUnitsByBucket.get(key) ?? 0) + units);
    }
    for (const u of unownedSectors) {
      headroomUnitsByBucket.set(
        bucketKey(u.stateId, u.sectorType),
        unownedHeadroomUnitsOf(u.sectorType, u.headroomUnits, u.revenue, unitScale)
      );
    }
  }

  const marketShareBySectorId = new Map<string, number>();
  for (const sector of sectors) {
    const state = stateById.get(sector.stateId);
    if (!state) continue;
    const countryId = (sector.countryId as CountryId | undefined) ?? (state.countryId as CountryId);
    const gdpFallback = gdpDerivedMarketAnchor(state.gdp ?? 0, countryId, preset);
    const key = bucketKey(sector.stateId, sector.sectorType as CorporationType);
    const owned = ownedRevenueByBucket.get(key) ?? 0;
    const unowned = unownedByBucket.get(key);
    const sectorId = sector._id.toString();

    if (plantsEnabled) {
      const sectorType = sector.sectorType as CorporationType;
      const marketUnits = effectiveMarketUnits(
        ownedUnitsByBucket.get(key) ?? 0,
        headroomUnitsByBucket.get(key),
        marketUnitsFromAnchor(sectorType, gdpFallback, unitScale)
      );
      // Fallback (c): no usable unit denominator (e.g. a sector type whose
      // default strategy supplies nothing priceable) → legacy revenue path.
      if (marketUnits > 0 && Number.isFinite(marketUnits)) {
        marketShareBySectorId.set(
          sectorId,
          computeMarketSharePercent(sectorUnitsById.get(sectorId) ?? 0, marketUnits)
        );
        continue;
      }
    }

    const market = effectiveMarketAnchor(owned, unowned, gdpFallback);
    const rev = sectorRevenueAnchorById.get(sectorId) ?? 0;
    marketShareBySectorId.set(sectorId, computeMarketSharePercent(rev, market));
  }
  return marketShareBySectorId;
}

/**
 * Per-sector NATIONAL dominance share: the owning corp's aggregate share of the
 * whole (countryId, sectorType) market, summed across every state.
 *
 * The per-(state, sectorType) share in {@link buildMarketShareBySectorId} is the
 * right grain for a *local* contest (attacks, one region's clearing), but it lets
 * a national champion dodge every antitrust toll by spreading thin: 40% of a
 * sector in all fifty states is a de-facto national monopoly that pays a zero
 * dominance penalty because no single cell crosses the threshold. This map feeds
 * a parallel toll so the turn engine can charge on `max(local, national)` share.
 *
 * Revenue-basis on purpose. It is a ratio (share of a market), so the era unit
 * scale cancels and there is no plants/units branch to keep in sync — antitrust
 * cares about economic weight, not physical capacity. The denominator is the sum
 * of each state's {@link effectiveMarketAnchor} (owned + unowned/GDP floor) over
 * the country, matching the local map's market definition exactly.
 *
 * SOE exemption is applied by the caller (as with the local tolls), not here.
 */
export function buildNationalDominanceShareBySectorId(
  inputs: BuildSectorMarketShareInputs
): Map<string, number> {
  const { sectors, stateById, unownedSectors, exchangeRatesByCurrency, preset } = inputs;

  const bucketKey = (stateId: string, sectorType: CorporationType): string =>
    `${stateId}::${sectorType}`;
  const natKey = (countryId: string, sectorType: CorporationType): string =>
    `${countryId}::${sectorType}`;

  // Sector revenue → ₳ anchor, host-state currency (same resolution as the
  // local map so the two shares are on one basis).
  const anchorById = new Map<string, number>();
  const sectorCountryById = new Map<string, CountryId>();
  for (const sector of sectors) {
    const hostCountryId =
      (sector.countryId as CountryId | undefined) ??
      (stateById.get(sector.stateId)?.countryId as CountryId | undefined);
    const hostCode = resolveSectorHostCurrencyCode({ countryId: hostCountryId }, null);
    const hostRate = fxRateForSectorHostFromMap(
      { countryId: hostCountryId },
      null,
      exchangeRatesByCurrency
    );
    anchorById.set(
      sector._id.toString(),
      readCorpEconomicAnchor(sector.revenue, hostCode, hostRate)
    );
    if (hostCountryId) sectorCountryById.set(sector._id.toString(), hostCountryId);
  }

  // Owned + unowned revenue per (state, sectorType) bucket.
  const ownedByBucket = new Map<string, number>();
  for (const sector of sectors) {
    const key = bucketKey(sector.stateId, sector.sectorType as CorporationType);
    ownedByBucket.set(
      key,
      (ownedByBucket.get(key) ?? 0) + (anchorById.get(sector._id.toString()) ?? 0)
    );
  }
  const unownedByBucket = new Map<string, number>();
  for (const u of unownedSectors) {
    unownedByBucket.set(bucketKey(u.stateId, u.sectorType), u.revenue);
  }

  // National market = Σ over the country's states of each bucket's effective
  // market. Each (state, sectorType) contributes once — track visited buckets.
  const nationalMarketByKey = new Map<string, number>();
  const seenBucket = new Set<string>();
  for (const sector of sectors) {
    const state = stateById.get(sector.stateId);
    if (!state) continue;
    const sectorType = sector.sectorType as CorporationType;
    const bKey = bucketKey(sector.stateId, sectorType);
    if (seenBucket.has(bKey)) continue;
    seenBucket.add(bKey);
    const countryId = (sector.countryId as CountryId | undefined) ?? (state.countryId as CountryId);
    const gdpFallback = gdpDerivedMarketAnchor(state.gdp ?? 0, countryId, preset);
    const market = effectiveMarketAnchor(
      ownedByBucket.get(bKey) ?? 0,
      unownedByBucket.get(bKey),
      gdpFallback
    );
    const nKey = natKey(countryId, sectorType);
    nationalMarketByKey.set(nKey, (nationalMarketByKey.get(nKey) ?? 0) + market);
  }
  // Unowned buckets in a state that has NO owned sector of that type still add
  // to the national market (unclaimed demand a champion could be dominating
  // around). Add any bucket not already counted above.
  for (const u of unownedSectors) {
    const bKey = bucketKey(u.stateId, u.sectorType);
    if (seenBucket.has(bKey)) continue;
    seenBucket.add(bKey);
    const state = stateById.get(u.stateId);
    const countryId = (state?.countryId as CountryId | undefined) ?? ("US" as CountryId);
    const gdpFallback = state ? gdpDerivedMarketAnchor(state.gdp ?? 0, countryId, preset) : 0;
    const market = effectiveMarketAnchor(0, u.revenue, gdpFallback);
    const nKey = natKey(countryId, u.sectorType);
    nationalMarketByKey.set(nKey, (nationalMarketByKey.get(nKey) ?? 0) + market);
  }

  // Corp's national revenue per (corp, country, sectorType).
  const corpNatRevByKey = new Map<string, number>();
  const corpNatKey = (corpId: string, countryId: string, sectorType: CorporationType): string =>
    `${corpId}::${countryId}::${sectorType}`;
  for (const sector of sectors) {
    const corpId = sector.corporationId?.toString();
    if (!corpId) continue;
    const countryId = sectorCountryById.get(sector._id.toString());
    if (!countryId) continue;
    const key = corpNatKey(corpId, countryId, sector.sectorType as CorporationType);
    corpNatRevByKey.set(
      key,
      (corpNatRevByKey.get(key) ?? 0) + (anchorById.get(sector._id.toString()) ?? 0)
    );
  }

  const nationalShareBySectorId = new Map<string, number>();
  for (const sector of sectors) {
    const corpId = sector.corporationId?.toString();
    const countryId = sectorCountryById.get(sector._id.toString());
    if (!corpId || !countryId) {
      nationalShareBySectorId.set(sector._id.toString(), 0);
      continue;
    }
    const sectorType = sector.sectorType as CorporationType;
    const corpRev = corpNatRevByKey.get(corpNatKey(corpId, countryId, sectorType)) ?? 0;
    const market = nationalMarketByKey.get(natKey(countryId, sectorType)) ?? 0;
    nationalShareBySectorId.set(sector._id.toString(), computeMarketSharePercent(corpRev, market));
  }
  return nationalShareBySectorId;
}

/**
 * Compute market share for a single sector by querying the DB for siblings in
 * the same (state, sectorType). Used by one-off API routes (growth /
 * adjust-growth) where building the global lookup would be wasteful.
 *
 * Returns 0 when the state cannot be found — the caller's growth-cost preview
 * then matches the legacy formula instead of incorrectly penalizing.
 */
export async function fetchSectorMarketSharePercent(
  db: Db,
  sector: Pick<
    CorporateSector,
    "_id" | "stateId" | "sectorType" | "revenue" | "countryId" | "capitalStock" | "strategyId"
  >,
  // Retained for call-site compatibility; sector revenue is now denominated in
  // its host-state currency, so the owning corp's FX context is no longer used.
  _owningCorp: CorpCapitalCurrencyInfo,
  /**
   * Share basis override. Leave undefined and the tier is resolved from the db
   * handle this function already holds.
   *
   * This used to default to `false` ("omit for legacy revenue behavior") and
   * every one of the seven call sites omitted it — including `buildCapacity`,
   * the plants-native growth path, and `monopolyTrigger`, which decides
   * nationalization. So on a plants world every share in the game was computed
   * on the legacy revenue basis and nothing indicated it. A default that no
   * caller ever overrides is not a default, it is a silent wrong answer, so the
   * function now works it out itself.
   */
  plantsEnabledOverride?: boolean
): Promise<number> {
  const { loadFxRatesByCurrency } = await import("@/lib/currency/corporationCapital");
  const plantsEnabled =
    plantsEnabledOverride ?? marketAtLeast(await getMarketSystemModeForDb(db), "plants");

  const [state, siblingSectors, unownedDoc, fxByCurrency, preset] = await Promise.all([
    db
      .collection<State>("states")
      .findOne({ _id: sector.stateId }, { projection: { _id: 1, gdp: 1, countryId: 1 } }),
    db
      .collection<CorporateSector>("corporateSectors")
      .find({ stateId: sector.stateId, sectorType: sector.sectorType })
      .toArray(),
    db
      .collection<UnownedSector>("unownedSectors")
      .findOne({ stateId: sector.stateId, sectorType: sector.sectorType }),
    loadFxRatesByCurrency(db),
    loadWorldPreset(db),
  ]);

  if (!state) return 0;
  const countryId = (sector.countryId as CountryId | undefined) ?? (state.countryId as CountryId);
  const gdpFallback = gdpDerivedMarketAnchor(state.gdp ?? 0, countryId, preset);
  const unitScale = getEraUnitScale(preset);

  // Every sibling sector is in the same state (same host country), so they all
  // share one host-state functional currency — the currency their revenue is
  // stored in regardless of owner. Resolve the ₳ rate once from the host country.
  const hostCode = resolveSectorHostCurrencyCode({ countryId }, null);
  const hostRate = fxRateForSectorHostFromMap({ countryId }, null, fxByCurrency);

  const sectorType = sector.sectorType as CorporationType;
  let ownedAnchor = 0;
  let thisSectorAnchor = 0;
  let ownedUnits = 0;
  let thisSectorUnits = 0;
  for (const s of siblingSectors) {
    const anchor = readCorpEconomicAnchor(s.revenue, hostCode, hostRate);
    ownedAnchor += anchor;
    const units = plantsEnabled
      ? sectorCapacityUnits(sectorType, s.capitalStock, anchor, s.strategyId, unitScale)
      : 0;
    ownedUnits += units;
    if (s._id.toString() === sector._id.toString()) {
      thisSectorAnchor = anchor;
      thisSectorUnits = units;
    }
  }
  // Fallback: if the focal sector wasn't in the siblings query result (race),
  // normalize it directly at the same host rate.
  if (thisSectorAnchor === 0) {
    thisSectorAnchor = readCorpEconomicAnchor(sector.revenue, hostCode, hostRate);
    ownedAnchor += thisSectorAnchor;
    if (plantsEnabled) {
      thisSectorUnits = sectorCapacityUnits(
        sectorType,
        sector.capitalStock,
        thisSectorAnchor,
        sector.strategyId,
        unitScale
      );
      ownedUnits += thisSectorUnits;
    }
  }

  if (plantsEnabled) {
    const marketUnits = effectiveMarketUnits(
      ownedUnits,
      unownedDoc
        ? unownedHeadroomUnitsOf(
            sectorType,
            unownedDoc.headroomUnits,
            unownedDoc.revenue,
            unitScale
          )
        : undefined,
      marketUnitsFromAnchor(sectorType, gdpFallback, unitScale)
    );
    // Fallback (c): no usable unit denominator → legacy revenue path.
    if (marketUnits > 0 && Number.isFinite(marketUnits)) {
      return computeMarketSharePercent(thisSectorUnits, marketUnits);
    }
  }

  const market = effectiveMarketAnchor(ownedAnchor, unownedDoc?.revenue, gdpFallback);
  return computeMarketSharePercent(thisSectorAnchor, market);
}

/**
 * Batched market share for a set of sectors — one set of DB queries covering all
 * the (state, sectorType) buckets the sectors span, then a single pure pass.
 * Returns sectorId → share percent (0–100) for each input sector. Used where a
 * caller needs several sectors' shares at once (e.g. the privatization wizard's
 * per-sector carve cap) without N separate FX loads.
 */
export async function fetchMarketSharePercentForSectors(
  db: Db,
  targetSectors: Pick<
    CorporateSector,
    "_id" | "stateId" | "sectorType" | "revenue" | "countryId" | "corporationId"
  >[],
  /** Plants tier: capacity-unit share basis. Omit for legacy revenue behavior. */
  plantsEnabled: boolean = false
): Promise<Map<string, number>> {
  if (targetSectors.length === 0) return new Map();
  const { loadFxRatesByCurrency } = await import("@/lib/currency/corporationCapital");

  const stateIds = [...new Set(targetSectors.map((s) => s.stateId))];
  const types = [...new Set(targetSectors.map((s) => s.sectorType))];

  // Sibling sectors across the spanned buckets (a superset; buildMarketShareBySectorId
  // buckets precisely by (state, sectorType), so non-target buckets don't pollute).
  const [siblingSectors, unownedDocs, states, fxByCurrency, preset] = await Promise.all([
    db
      .collection<CorporateSector>("corporateSectors")
      .find({ stateId: { $in: stateIds }, sectorType: { $in: types } })
      .toArray(),
    db
      .collection<UnownedSector>("unownedSectors")
      .find({ stateId: { $in: stateIds }, sectorType: { $in: types } })
      .toArray(),
    db
      .collection<State>("states")
      .find({ _id: { $in: stateIds } }, { projection: { _id: 1, gdp: 1, countryId: 1 } })
      .toArray(),
    loadFxRatesByCurrency(db),
    loadWorldPreset(db),
  ]);

  const shareByAll = buildMarketShareBySectorId({
    sectors: siblingSectors,
    stateById: new Map(states.map((s) => [s._id, s])),
    unownedSectors: unownedDocs,
    exchangeRatesByCurrency: fxByCurrency,
    preset,
    plantsEnabled,
  });

  const result = new Map<string, number>();
  for (const s of targetSectors) {
    result.set(s._id.toString(), shareByAll.get(s._id.toString()) ?? 0);
  }
  return result;
}

/**
 * Compute defender + attacker market shares in a single (state, sectorType)
 * cell with one set of DB queries. Used by attack routes that need both shares
 * to apply the underdog amplifier on top of the dominance multiplier. Returns
 * 0 for the attacker share when the attacker has no presence in the cell.
 */
export async function fetchAttackerDefenderShares(
  db: Db,
  targetSector: Pick<
    CorporateSector,
    "_id" | "stateId" | "sectorType" | "countryId" | "revenue" | "capitalStock" | "strategyId"
  >,
  // Retained for call-site compatibility; sector revenue is now denominated in
  // its host-state currency, so the defender corp's FX context is no longer used.
  _defenderCorp: CorpCapitalCurrencyInfo,
  attackerCorpId: import("mongodb").ObjectId,
  /** Plants tier: capacity-unit share basis. Omit for legacy revenue behavior. */
  plantsEnabled: boolean = false
): Promise<{ defenderSharePercent: number; attackerSharePercent: number }> {
  const { loadFxRatesByCurrency } = await import("@/lib/currency/corporationCapital");

  const [state, siblingSectors, unownedDoc, fxByCurrency, preset] = await Promise.all([
    db
      .collection<State>("states")
      .findOne({ _id: targetSector.stateId }, { projection: { _id: 1, gdp: 1, countryId: 1 } }),
    db
      .collection<CorporateSector>("corporateSectors")
      .find({ stateId: targetSector.stateId, sectorType: targetSector.sectorType })
      .toArray(),
    db
      .collection<UnownedSector>("unownedSectors")
      .findOne({ stateId: targetSector.stateId, sectorType: targetSector.sectorType }),
    loadFxRatesByCurrency(db),
    loadWorldPreset(db),
  ]);

  if (!state) return { defenderSharePercent: 0, attackerSharePercent: 0 };
  const countryId =
    (targetSector.countryId as CountryId | undefined) ?? (state.countryId as CountryId);
  const gdpFallback = gdpDerivedMarketAnchor(state.gdp ?? 0, countryId, preset);
  const unitScale = getEraUnitScale(preset);

  // Every sibling is in the same state (same host country), so they share one
  // host-state functional currency — resolve the ₳ rate once from the country.
  const hostCode = resolveSectorHostCurrencyCode({ countryId }, null);
  const hostRate = fxRateForSectorHostFromMap({ countryId }, null, fxByCurrency);

  const sectorType = targetSector.sectorType as CorporationType;
  let ownedAnchor = 0;
  let defenderAnchor = 0;
  let attackerAnchor = 0;
  let ownedUnits = 0;
  let defenderUnits = 0;
  let attackerUnits = 0;
  const attackerIdStr = attackerCorpId.toString();
  for (const s of siblingSectors) {
    const anchor = readCorpEconomicAnchor(s.revenue, hostCode, hostRate);
    ownedAnchor += anchor;
    const units = plantsEnabled
      ? sectorCapacityUnits(sectorType, s.capitalStock, anchor, s.strategyId, unitScale)
      : 0;
    ownedUnits += units;
    if (s._id.toString() === targetSector._id.toString()) {
      defenderAnchor = anchor;
      defenderUnits = units;
    }
    if (s.corporationId.toString() === attackerIdStr) {
      attackerAnchor += anchor;
      attackerUnits += units;
    }
  }
  // Race fallback: if the target sector wasn't yet visible in the siblings
  // query, normalize its revenue directly at the same host rate.
  if (defenderAnchor === 0) {
    defenderAnchor = readCorpEconomicAnchor(targetSector.revenue, hostCode, hostRate);
    ownedAnchor += defenderAnchor;
    if (plantsEnabled) {
      defenderUnits = sectorCapacityUnits(
        sectorType,
        targetSector.capitalStock,
        defenderAnchor,
        targetSector.strategyId,
        unitScale
      );
      ownedUnits += defenderUnits;
    }
  }

  if (plantsEnabled) {
    const marketUnits = effectiveMarketUnits(
      ownedUnits,
      unownedDoc
        ? unownedHeadroomUnitsOf(
            sectorType,
            unownedDoc.headroomUnits,
            unownedDoc.revenue,
            unitScale
          )
        : undefined,
      marketUnitsFromAnchor(sectorType, gdpFallback, unitScale)
    );
    // Fallback (c): no usable unit denominator → legacy revenue path.
    if (marketUnits > 0 && Number.isFinite(marketUnits)) {
      return {
        defenderSharePercent: computeMarketSharePercent(defenderUnits, marketUnits),
        attackerSharePercent: computeMarketSharePercent(attackerUnits, marketUnits),
      };
    }
  }

  const market = effectiveMarketAnchor(ownedAnchor, unownedDoc?.revenue, gdpFallback);
  return {
    defenderSharePercent: computeMarketSharePercent(defenderAnchor, market),
    attackerSharePercent: computeMarketSharePercent(attackerAnchor, market),
  };
}
