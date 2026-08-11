/**
 * Turn-time SOE behavior (spec §11): apply public-service mandate contributions
 * to state metrics and back operating losses from the treasury. Builders are
 * pure (testable without DB); `processSoeOperations` orchestrates the writes.
 */
import type { Db, AnyBulkWriteOperation, Filter } from "mongodb";
import type { Corporation, CorporateSector, StateMetrics } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import {
  loadFxRatesByCurrency,
  corpCapitalToAnchor,
  anchorToCorpCapital,
  fxRateForCorpFromMap,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { getMetricDefinition } from "@/lib/constants/metricDefinitions";
import type { MetricCategoryId } from "@/lib/db/types/stateMetrics";
import { isStateOwned } from "./nationalCorporation";
import { findMergedRegionMetricsMany } from "@/lib/macroMetrics/merge";
import { isMacroMetricPath } from "@/lib/macroMetrics/paths";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import { boardDeltaForLegacyEffect } from "@/lib/politicalLegislation/legacyEffectBridge";
import { applyBoardDelta } from "@/lib/politicalLegislation/boardWrite";
import {
  getMandateContributions,
  resolveSectorMandate,
  type MandateContribution,
} from "./soeMandates";
import { coverSoeOperatingLoss, debitTreasurySoeCapex } from "./treasury";
import {
  resolveSectorHostCurrencyCode,
  fxRateForSectorHostFromMap,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { sectorDailyProfitAnchor } from "@/lib/corporations/sectorProfitBasis";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { capacityPricePerUnit, CAPACITY_ANCHOR_YEAR } from "@/lib/constants/capacityEconomy";
import { CAPITAL_DEPRECIATION_PER_TURN } from "@/lib/market/capital";
import { TURNS_PER_DAY } from "@/lib/constants/turnTime";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";
import {
  NATCORP_RD_MOMENTUM_MAX,
  NATCORP_RD_FULL_FUND_REVENUE_FRACTION,
  NATCORP_RD_DECAY_PER_TURN,
  NATCORP_RD_RAMP_UP_PER_TURN,
} from "./constants";

interface MetricOpInput {
  countryId: CountryId;
  stateId: string;
  contributions: MandateContribution[];
  currentMetrics: StateMetrics;
  now: Date;
}

type MetricBulkOp = {
  updateOne: {
    filter: { _id: string };
    update: { $set: Record<string, number | Date> };
  };
};

/**
 * Convert the POLITICAL half of a state's mandate contributions into board
 * deltas.
 *
 * Most mandate targets are political — `healthcare.physicianRate`,
 * `infrastructure.roadCondition`, `governance.publicTrust` — so once the
 * political store stopped being written this half of the mechanic went inert:
 * the merged doc no longer carried those values, `buildMandateMetricOps`
 * skipped them on the absent-metric check, and a state-owned hospital network
 * quietly stopped improving healthcare.
 *
 * VALUE, not residual. An SOE's mandate contribution is ONGOING OPERATING
 * PRESSURE, re-applied every turn for as long as the state owns the sector. On
 * the board that composes correctly with the dynamics phase: each turn's push
 * is drifted back toward the law-implied target, so the metric settles at a
 * steady elevation proportional to the SOE's share, and relaxes back on its own
 * once the sector is sold or shut down. A residual would instead bank every
 * turn's contribution permanently and never let go.
 */
export function buildMandateBoardDeltas(
  contributions: MandateContribution[]
): Array<{ familyId: string; scoreDelta: number }> {
  const out: Array<{ familyId: string; scoreDelta: number }> = [];
  for (const c of contributions) {
    const [category, metricId] = c.metricPath.split(".");
    const hit = boardDeltaForLegacyEffect(category, metricId, c.delta);
    if (hit) out.push(hit);
  }
  return out;
}

/** Build the clamped `$set` ops for one state's MACRO mandate contributions. */
export function buildMandateMetricOps(input: MetricOpInput): MetricBulkOp[] {
  const set: Record<string, number | Date> = {};
  for (const c of input.contributions) {
    const [category, field] = c.metricPath.split(".");
    const cat = (input.currentMetrics as unknown as Record<string, unknown>)[category] as
      Record<string, { value?: number }> | undefined;
    const current = cat?.[field]?.value;
    if (typeof current !== "number") continue; // metric absent on this state — skip
    const def = getMetricDefinition(category as MetricCategoryId, field);
    const min = def?.minValue ?? 0;
    const max = def?.maxValue ?? 100;
    const next = Math.max(min, Math.min(max, current + c.delta));
    set[`${c.metricPath}.value`] = next;
  }
  if (Object.keys(set).length === 0) return [];
  set.lastUpdated = input.now;
  return [{ updateOne: { filter: { _id: input.stateId }, update: { $set: set } } }];
}

type RdModernizationOp = {
  updateOne: {
    filter: { _id: Corporation["_id"]; liquidCapital?: { $gte: number } };
    update: { $set: { rdScore: number; updatedAt: Date }; $inc?: { liquidCapital: number } };
  };
};

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/**
 * Per-turn NatCorp modernization: `rdScore` is a *momentum* on the 0–MAX
 * innovation scale that each turn tracks a funding-driven target and bleeds
 * toward it at a flat decay rate. The CEO's per-turn budget is a ceiling — the
 * corp spends only up to the full-fund cost (a fraction of its own per-turn
 * revenue), so modernization is scale-proportional: a giant corp needs a giant
 * budget to hold a high score, and momentum lapses to 0 over a year if unfunded.
 *
 * intensity   = min(1, spend / (revenue × FULL_FUND_FRACTION))   // 0–1
 * target      = intensity × MAX
 * next        = clamp(momentum + clamp(target−momentum, −DECAY, +RAMP_UP), 0, MAX)
 *
 * Spend is debited only when affordable (guarded `$gte`), so the treasury never
 * silently funds R&D. Returns one op per corp whose score moves or that spends.
 */
export function buildRdModernizationOps(
  corps: Array<Pick<Corporation, "_id" | "rdScore" | "liquidCapital" | "rdBudgetPerTurn">>,
  revenueByCorp: Map<string, number>,
  now: Date
): RdModernizationOp[] {
  const ops: RdModernizationOp[] = [];
  for (const c of corps) {
    const momentum =
      Math.round(clamp(Number(c.rdScore ?? 0), 0, NATCORP_RD_MOMENTUM_MAX) * 100) / 100;
    const budget = Math.max(0, Math.round(c.rdBudgetPerTurn ?? 0));
    const revenue = Math.max(0, revenueByCorp.get(c._id.toString()) ?? 0);
    const fullFundBudget = revenue * NATCORP_RD_FULL_FUND_REVENUE_FRACTION;
    const desiredSpend = Math.min(budget, fullFundBudget);
    const liquid = Number.isFinite(c.liquidCapital) ? (c.liquidCapital as number) : 0;
    const affordable = desiredSpend > 0 && liquid >= desiredSpend;
    const spend = affordable ? Math.round(desiredSpend) : 0;
    const intensity = fullFundBudget > 0 ? Math.min(1, spend / fullFundBudget) : 0;
    const target = intensity * NATCORP_RD_MOMENTUM_MAX;
    const gap = target - momentum;
    const delta =
      gap >= 0
        ? Math.min(gap, NATCORP_RD_RAMP_UP_PER_TURN)
        : Math.max(gap, -NATCORP_RD_DECAY_PER_TURN);
    const next = Math.round(clamp(momentum + delta, 0, NATCORP_RD_MOMENTUM_MAX) * 100) / 100;
    if (next === momentum && spend === 0) continue; // nothing to write

    const op: RdModernizationOp = {
      updateOne: {
        filter: spend > 0 ? { _id: c._id, liquidCapital: { $gte: spend } } : { _id: c._id },
        update: { $set: { rdScore: next, updatedAt: now } },
      },
    };
    if (spend > 0) op.updateOne.update.$inc = { liquidCapital: -spend };
    ops.push(op);
  }
  return ops;
}

/**
 * P3b — SOE capex discipline (plants tier).
 *
 * Below plants, treasury backing zeroes ANY negative `liquidCapital`: whatever
 * hole an SOE is in, the state fills it. That was defensible when the only way
 * an SOE could go negative was by LOSING MONEY OPERATING — the soft budget
 * constraint the mechanic is meant to model. Under plants it is not: a director
 * can place a build order for an arbitrarily large amount of capacity, drain the
 * corp's cash into construction-in-progress, and have the treasury comp the
 * whole thing on the same turn. Capacity would be free for every state
 * enterprise in the game.
 *
 * So the shortfall is SPLIT. The treasury covers this turn's realized OPERATING
 * loss and nothing more:
 *
 *     coverable = min(totalShortfall, max(0, −operatingResultThisTurn))
 *
 * The residual — cash the corp spent on build orders — stays as negative
 * `liquidCapital`. An SOE that overbuilds stays negative until it earns its way
 * out (or a caretaker cancels the order and recovers the refundable CIP; there
 * is no automatic caretaker cancellation today, so in practice it simply stays
 * negative and cannot place further builds, which is the intended pressure).
 *
 * `operatingResultThisTurn` is an APPROXIMATION built from what this function
 * can reach: the plants-aware sector profit basis (realized-preferring revenue
 * less maintenance, no growth charge) net of corp-level overhead
 * (marketing / logistics / CEO salary), converted from the daily basis those
 * fields are stored on to one turn.
 *
 * WHAT IT DOES NOT SEE — the full list, because a partial one reads as a
 * complete one:
 *   - idle / mothball upkeep (`plantsUpkeepCost` in sectorTurn)
 *   - the regulatory burden the turn processor charges
 *   - bond coupon interest and bond maturity face value (bondTurn)
 *   - corporate tax and dividend payouts (sectorCalculations)
 *
 * The first two under-state the loss, so the split is conservative in the
 * enterprise's favour on those. The debt and tax lines are DELIBERATELY out of
 * scope: this covers the OPERATING loss, and an SOE whose hole is interest- or
 * tax-driven is therefore not covered here and can stay negative. That is a
 * known gap, not an oversight — closing it is not a one-line change:
 *   - coupon interest on a corp with `countryOwnerId` is ALREADY government-
 *     covered (natcorps skip the coupon cost entirely in bondTurn), so adding
 *     an interest term here would double-cover the common case; only
 *     `ownershipState: "stateOwned"` SOEs without `countryOwnerId` actually pay
 *     coupons, and
 *   - this function reads no bond documents at all, so covering debt service
 *     means new per-corp plumbing and a deliberate decision about how far the
 *     soft budget constraint reaches.
 * Revisit as its own change, with a stated rule, rather than widening the
 * approximation by accident.
 *
 * Returns ₳. Non-plants callers get the full shortfall, exactly as before.
 */
export function coverableSoeShortfallAnchor(args: {
  corporation: Corporation;
  sectors: readonly CorporateSector[];
  shortfallAnchor: number;
  corpOverheadAnchor: number;
  fxByCurrency: ReadonlyMap<CurrencyCode, number>;
  plantsEnabled: boolean;
}): number {
  const shortfall = Math.max(0, args.shortfallAnchor);
  if (!args.plantsEnabled || shortfall <= 0) return shortfall;
  let dailyProfitAnchor = 0;
  for (const sector of args.sectors) {
    const code = resolveSectorHostCurrencyCode(sector, args.corporation);
    const rate = fxRateForSectorHostFromMap(sector, args.corporation, args.fxByCurrency);
    // REALIZED margin, not the seeded one. `sector.profitMargin` is a constant
    // nothing ever writes (12 for every state enterprise in the world, 35 for
    // every private one); under plants the turn processor DERIVES the margin
    // from the physical cost lines and persists it as `effectiveProfitMargin`
    // (see `sectorTurn` — "under plants this field is an OUTPUT, not an
    // input"). Reading the frozen constant here made this function report a
    // healthy PROFIT for enterprises that were in fact running at a large
    // physical loss, so `operatingLoss` came out 0 and the treasury covered
    // NOTHING — the SOE simply carried the whole loss forward, every turn,
    // forever. Measured on the 96-turn plants A/B (`ab5_plants`): the Soviet
    // manufacturing enterprise's sectors reported `profitMargin` 12 against a
    // derived `effectiveProfitMargin` of −52, an estimated +₳4.2M/turn against
    // a real ≈−₳2M/turn, and −173,259,460 of accumulated uncovered loss. All
    // 38 command SOEs and all 5 loss-making NatCorps were insolvent this way.
    //
    // The anti-exploit scope is UNCHANGED: `derivedMarginPct` is
    // `1 − operatingCost/revenue` and `operatingCost` excludes growth/build
    // spend entirely, so capex is still not coverable — this makes the
    // OPERATING half honest, it does not widen what "operating" means.
    const realizedMarginPct = sector.effectiveProfitMargin;
    const marginSector =
      typeof realizedMarginPct === "number" && Number.isFinite(realizedMarginPct)
        ? { ...sector, profitMargin: realizedMarginPct }
        : sector;
    dailyProfitAnchor += sectorDailyProfitAnchor(marginSector, {
      currencyCode: code,
      fxRate: rate,
      plantsEnabled: true,
      growthCost: { kind: "stored" },
    }).dailyProfitAnchor;
  }
  const operatingResultPerTurn =
    (dailyProfitAnchor - Math.max(0, args.corpOverheadAnchor)) / TURNS_PER_DAY;
  const operatingLoss = Math.max(0, -operatingResultPerTurn);
  return Math.min(shortfall, operatingLoss);
}

/**
 * Orchestrate SOE operations for the turn. Reads all state-owned corps, their
 * sectors, and the metrics of every state they operate in; applies mandate
 * contributions (scaled by SOE share of each state-sector) and backs any
 * negative liquidCapital from the treasury. Money math is ₳-anchor internal.
 */
export async function processSoeOperations(
  db: Db,
  now: Date,
  /** Game year — era-prices the state capex grant. Absent ⇒ the anchor year. */
  currentYear?: number | null
): Promise<{ soeCorps: number }> {
  // Match `isStateOwned` semantics at the DB layer: a state-owned corp has
  // `countryOwnerId` set OR `ownershipState: "stateOwned"`. The seeded NatCorps
  // (e.g. the UK NHS) and pre-Phase-1 backfilled corps carry `countryOwnerId`
  // but NOT `ownershipState`, so filtering on `ownershipState` alone would miss
  // them entirely. The post-filter keeps the canonical reader as the final word.
  const corps = await db
    .collection<Corporation>("corporations")
    .find({
      $or: [{ countryOwnerId: { $exists: true } }, { ownershipState: "stateOwned" }],
    })
    .toArray();
  const soeCorps = corps.filter((c) => isStateOwned(c));
  if (soeCorps.length === 0) return { soeCorps: 0 };

  const corpIds = soeCorps.map((c) => c._id);
  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find({ corporationId: { $in: corpIds } })
    .toArray();

  const stateIds = Array.from(new Set(sectors.map((s) => s.stateId)));
  // Legacy-shaped per-region view so the presence checks in
  // buildMandateMetricOps see the doc they were written against. Mandate
  // targets that used to live on the political half are now board families and
  // are handled by the board branch below.
  const [mergedMetrics, fxByCurrency] = await Promise.all([
    findMergedRegionMetricsMany(db, { _id: { $in: stateIds } }),
    loadFxRatesByCurrency(db),
  ]);
  const metricsById = new Map<string, StateMetrics>(
    mergedMetrics.map((m) => [String(m._id), m] as const)
  );
  const corpById = new Map(soeCorps.map((c) => [c._id.toString(), c]));

  // Group contributions per state (a state may host sectors from primary + split-offs).
  const contributionsByState = new Map<string, MandateContribution[]>();
  for (const sector of sectors) {
    const corp = corpById.get(sector.corporationId.toString());
    if (!corp) continue;
    const mandate = resolveSectorMandate(corp, sector);
    const soeShare = computeSoeShareOfStateSector(sector, sectors);
    const contributions = getMandateContributions(
      corp.countryId as CountryId,
      sector,
      mandate,
      soeShare
    );
    if (contributions.length === 0) continue;
    const list = contributionsByState.get(sector.stateId) ?? [];
    list.push(...contributions);
    contributionsByState.set(sector.stateId, list);
  }

  // Merge same-metric contributions within a state (sum deltas) before clamping,
  // then route each half to its own store: macro paths (unemployment relief,
  // food security) stay an absolute clamped `$set` on macroMetrics; political
  // paths become board deltas.
  const metricOps: MetricBulkOp[] = [];
  const boardDeltasByState = new Map<string, Array<{ familyId: string; scoreDelta: number }>>();
  for (const [stateId, contributions] of contributionsByState) {
    const metrics = metricsById.get(stateId);
    if (!metrics) continue;
    const merged = mergeContributions(contributions);
    metricOps.push(
      ...buildMandateMetricOps({
        countryId: (metrics.countryId ?? "US") as CountryId,
        stateId,
        contributions: merged.filter((c) => isMacroMetricPath(c.metricPath)),
        currentMetrics: metrics,
        now,
      })
    );
    const board = buildMandateBoardDeltas(merged.filter((c) => !isMacroMetricPath(c.metricPath)));
    if (board.length > 0) boardDeltasByState.set(stateId, board);
  }
  if (metricOps.length > 0) {
    await db
      .collection<StateMetrics>("macroMetrics")
      .bulkWrite(metricOps as AnyBulkWriteOperation<StateMetrics>[]);
  }
  for (const [stateId, deltas] of boardDeltasByState) {
    for (const d of deltas) {
      await applyBoardDelta(
        db,
        { _id: stateId } as Filter<PoliticalMetricsDoc>,
        d.familyId,
        d.scoreDelta,
        "value"
      );
    }
  }

  // Per-turn modernization (R&D): advance each SOE's decaying, scale-aware
  // momentum from its CEO-set budget (relative to its own revenue). Runs before
  // treasury-backing so the affordability guard — not the treasury — bounds it.
  const revenueByCorp = new Map<string, number>();
  for (const s of sectors) {
    const k = s.corporationId.toString();
    revenueByCorp.set(
      k,
      (revenueByCorp.get(k) ?? 0) + (Number.isFinite(s.revenue) ? s.revenue : 0)
    );
  }
  const rdOps = buildRdModernizationOps(soeCorps, revenueByCorp, now);
  if (rdOps.length > 0) {
    await db
      .collection<Corporation>("corporations")
      .bulkWrite(rdOps as AnyBulkWriteOperation<Corporation>[]);
  }

  const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");
  const sectorsByCorpId = new Map<string, CorporateSector[]>();
  for (const s of sectors) {
    const k = s.corporationId.toString();
    sectorsByCorpId.set(k, [...(sectorsByCorpId.get(k) ?? []), s]);
  }

  // ── State capex grant (the non-command SOE capacity channel) ───────────────
  //
  // Command economies fund SOE capacity through the Gosbank (directed credit,
  // floored at replacement in `commandEconomyTurn`). A nationalized corp in a
  // MARKET economy has no such channel: it is excluded from the private,
  // cash-rationed NPP reinvestment path (a state enterprise does not fund
  // capacity out of its own operating cash) and the treasury backstop below
  // deliberately refuses to pay for build orders. So its plant decayed one-way.
  //
  // This is that channel, and it is a BUDGETED LINE, not a free grant: the
  // owning treasury is debited (`debitTreasurySoeCapex`, the same signed
  // `treasuryBalance` every other government flow moves) and the same amount
  // shows up as an expenditure in `estimateCountryOwnedBudgetNetLocal`, which
  // drives the budget page's State Enterprises line.
  //
  // Bounded by construction — see `soeCapacityReplacementCostAnchor`: it buys
  // back exactly the units that wore out this turn, at the standing list price
  // (`capacityBookAnchor` is raised by the cash actually paid, so no exit can
  // mint against it), leaving `capitalStock` flat. It can never fund growth,
  // and it never touches `liquidCapital`, so an SOE cannot divert it into a
  // build order of its own choosing. The P3b exploit stays closed.
  if (plantsEnabled) {
    await applyStateCapexGrants(db, soeCorps, sectorsByCorpId, fxByCurrency, currentYear, now);
  }

  // Treasury-backing: an SOE with negative liquidCapital is covered — but only
  // up to its realized OPERATING loss under plants. See
  // `coverableSoeShortfallAnchor`: cash drained into build orders is the
  // director's problem, not the treasury's.
  const backingOps: AnyBulkWriteOperation<Corporation>[] = [];
  for (const corp of soeCorps) {
    const liquid = Number.isFinite(corp.liquidCapital) ? corp.liquidCapital : 0;
    if (liquid >= 0) continue;
    const code = resolveCorpLiquidCurrencyCode(corp);
    const rate = fxRateForCorpFromMap(corp, fxByCurrency);
    const shortfallAnchor = -corpCapitalToAnchor(liquid, code, rate);
    // Corp-level overhead is stored in the corp's own currency (daily basis),
    // same convention as estimateNationalizedOperatingIncome.
    const corpOverheadAnchor =
      readCorpEconomicAnchor(corp.marketingBudget ?? 0, code, rate) +
      readCorpEconomicAnchor(corp.logisticsBudget ?? 0, code, rate) +
      readCorpEconomicAnchor(corp.ceoSalary ?? 0, code, rate);
    const coveredAnchor = coverableSoeShortfallAnchor({
      corporation: corp,
      sectors: sectorsByCorpId.get(corp._id.toString()) ?? [],
      shortfallAnchor,
      corpOverheadAnchor,
      fxByCurrency,
      plantsEnabled,
    });
    if (coveredAnchor <= 0) continue; // nothing operating-related to comp
    await coverSoeOperatingLoss(db, corp.countryId as CountryId, coveredAnchor, fxByCurrency, now);
    // Credit only what the treasury actually paid. Below plants that is the
    // whole hole (liquidCapital → 0, as before); under plants an over-built SOE
    // is left negative by the residual it spent on capacity.
    const coveredLocal = anchorToCorpCapital(coveredAnchor, code, rate);
    backingOps.push({
      updateOne: {
        filter: { _id: corp._id },
        update: plantsEnabled
          ? { $inc: { liquidCapital: coveredLocal }, $set: { updatedAt: now } }
          : { $set: { liquidCapital: 0, updatedAt: now } },
      },
    });
  }
  if (backingOps.length > 0) {
    await db.collection<Corporation>("corporations").bulkWrite(backingOps);
  }

  return { soeCorps: soeCorps.length };
}

function mergeContributions(contributions: MandateContribution[]): MandateContribution[] {
  const byPath = new Map<string, number>();
  for (const c of contributions)
    byPath.set(c.metricPath, (byPath.get(c.metricPath) ?? 0) + c.delta);
  return Array.from(byPath, ([metricPath, delta]) => ({ metricPath, delta }));
}

/**
 * SOE share of its (state, sectorType): this sector's revenue over the total
 * SOE revenue for that (state, sectorType) across all SOE sectors. v1 proxy for
 * "share of the state sector" — full market-share (incl. private + unowned)
 * resolution is a later refinement; SOE-internal share keeps the contribution
 * bounded and monotonic in SOE footprint.
 */
function computeSoeShareOfStateSector(
  sector: CorporateSector,
  allSoeSectors: CorporateSector[]
): number {
  let total = 0;
  for (const s of allSoeSectors) {
    if (s.stateId === sector.stateId && s.sectorType === sector.sectorType) {
      total += Math.max(0, s.revenue);
    }
  }
  if (total <= 0) return 0;
  return Math.max(0, sector.revenue) / total;
}

// ── State capex grant (plants tier) ─────────────────────────────────────────

/** One sector's share of a state capex grant. */
export interface SoeCapexSectorBuy {
  sectorId: CorporateSector["_id"];
  /** Capacity units bought back — exactly this turn's depreciation. */
  unitsAdded: number;
  /** ₳ paid for them at the standing list price. */
  costAnchor: number;
  /** `capacityBookAnchor` after the purchase (prior paid basis + what was paid). */
  nextBookAnchor: number;
}

/**
 * Plan one state enterprise's capex grant: buy back exactly the capacity each
 * of its sectors lost to depreciation this turn, at the standing list price.
 *
 * PURE. `grantAnchor` is the ₳ the treasury owes and equals
 * {@link soeCapacityReplacementCostAnchor} over the same sectors by
 * construction — the invariant that makes the grant provably incapable of
 * growing the enterprise: units bought == units worn out, so `capitalStock` is
 * flat and no amount of build-order queueing changes what the state pays.
 *
 * A sector with no capital stock is skipped (nothing to replace — founding is a
 * policy decision, not maintenance), as is one with no priced capacity.
 */
export function buildSoeCapexGrant(
  sectors: readonly CorporateSector[],
  year: number | null | undefined,
  unitScale: number
): { grantAnchor: number; buys: SoeCapexSectorBuy[] } {
  const priceYear = typeof year === "number" && Number.isFinite(year) ? year : CAPACITY_ANCHOR_YEAR;
  const buys: SoeCapexSectorBuy[] = [];
  let grantAnchor = 0;
  for (const sector of sectors) {
    const stock =
      typeof sector.capitalStock === "number" && Number.isFinite(sector.capitalStock)
        ? Math.max(0, sector.capitalStock)
        : 0;
    if (stock <= 0) continue;
    const unitPrice = capacityPricePerUnit(sector.sectorType, priceYear, unitScale);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) continue;
    const unitsAdded = stock * CAPITAL_DEPRECIATION_PER_TURN;
    if (!(unitsAdded > 0)) continue;
    const costAnchor = unitsAdded * unitPrice;
    // Same convention as the directed-credit purchase: the paid basis is an
    // absolute `$set` seeded from the list-price fallback, so a row with no
    // recorded basis is stamped at its honest value instead of just this
    // tranche. Exits settle at what was PAID, never at list.
    const priorBook =
      typeof sector.capacityBookAnchor === "number" &&
      Number.isFinite(sector.capacityBookAnchor) &&
      sector.capacityBookAnchor >= 0
        ? sector.capacityBookAnchor
        : stock * unitPrice;
    buys.push({
      sectorId: sector._id,
      unitsAdded,
      costAnchor,
      nextBookAnchor: priorBook + costAnchor,
    });
    grantAnchor += costAnchor;
  }
  return { grantAnchor, buys };
}

/**
 * Apply the state capex grant to every state-owned corp that has no OTHER state
 * capacity channel, debiting each owning treasury for what it bought.
 *
 * Corps carrying a command-economy `soe` overlay are skipped: the Gosbank
 * already funds their replacement through directed credit (floored at exactly
 * this quantity in `commandEconomyTurn`), and paying twice would let a planned
 * economy's plant grow on maintenance money.
 */
async function applyStateCapexGrants(
  db: Db,
  soeCorps: readonly Corporation[],
  sectorsByCorpId: ReadonlyMap<string, CorporateSector[]>,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>,
  currentYear: number | null | undefined,
  now: Date
): Promise<void> {
  const ops: AnyBulkWriteOperation<CorporateSector>[] = [];
  const grantByCountry = new Map<CountryId, number>();
  const grantUnitScale = await loadWorldEraUnitScale(db);
  for (const corp of soeCorps) {
    if (corp.soe) continue; // command economy — funded by directed credit
    const countryId = (corp.countryOwnerId ?? corp.countryId) as CountryId | undefined;
    if (!countryId) continue;
    const { grantAnchor, buys } = buildSoeCapexGrant(
      sectorsByCorpId.get(corp._id.toString()) ?? [],
      currentYear,
      grantUnitScale
    );
    if (!(grantAnchor > 0)) continue;
    for (const buy of buys) {
      ops.push({
        updateOne: {
          filter: { _id: buy.sectorId },
          update: {
            $inc: { capitalStock: buy.unitsAdded },
            $set: { capacityBookAnchor: buy.nextBookAnchor, updatedAt: now },
          },
        },
      });
    }
    grantByCountry.set(countryId, (grantByCountry.get(countryId) ?? 0) + grantAnchor);
  }
  if (ops.length === 0) return;
  await db.collection<CorporateSector>("corporateSectors").bulkWrite(ops);
  for (const [countryId, grantAnchor] of grantByCountry) {
    await debitTreasurySoeCapex(db, countryId, grantAnchor, fxByCurrency, now);
  }
}
