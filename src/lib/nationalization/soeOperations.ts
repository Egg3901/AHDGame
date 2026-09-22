/**
 * Turn-time SOE behavior (spec §11): apply public-service mandate contributions
 * to state metrics and back operating losses from the treasury. Builders are
 * pure (testable without DB); `processSoeOperations` orchestrates the writes.
 */
import type { Db, AnyBulkWriteOperation } from "mongodb";
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
import { sumCorporateSectorConstructionInProgress } from "@/lib/bonds/corporateCredit";
import type { CorpSnapshot, SoeBackingSnapshot } from "@/lib/turn/corporation/types";
import type { ActionAuditInput } from "@/lib/db/types/actionAuditLog";
import { isStateOwned } from "./nationalCorporation";
import { findMergedRegionMetricsMany } from "@/lib/macroMetrics/merge";
import { isMacroMetricPath } from "@/lib/macroMetrics/paths";
import { boardDeltaForLegacyEffect } from "@/lib/politicalLegislation/legacyEffectBridge";
import { applyBoardValueDeltasByRegion } from "@/lib/politicalLegislation/boardWrite";
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
    filter: { _id: Corporation["_id"] };
    update: { $set: { rdScore: number; updatedAt: Date } };
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
 * FUNDING. `spend` is capped at `revenue × FULL_FUND_FRACTION` — the corp's own
 * per-turn revenue — so it is affordable from operations by construction. The
 * cost is charged as an operating expense in
 * {@link estimateNationalizedOperatingIncome}, which drives BOTH the treasury
 * remittance and the budget page's State Enterprises line, so the treasury funds
 * R&D by remitting less (never silently, never for free). It is deliberately NOT
 * debited from `liquidCapital`: SOE operating profit is remitted to the treasury
 * each turn and never banked as corp cash, so a `liquid >= spend` gate could
 * never pass for a normally-operating SOE and pinned every player-run corp at
 * rdScore 0 regardless of budget (ticket #1072). Returns one op per corp whose
 * score moves.
 */
export function buildRdModernizationOps(
  corps: Array<Pick<Corporation, "_id" | "rdScore" | "rdBudgetPerTurn">>,
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
    // Capped at the corp's own revenue, so spend is self-affordable from
    // operations — see the FUNDING note above.
    const spend = Math.round(Math.min(budget, fullFundBudget));
    const intensity = fullFundBudget > 0 ? Math.min(1, spend / fullFundBudget) : 0;
    const target = intensity * NATCORP_RD_MOMENTUM_MAX;
    const gap = target - momentum;
    const delta =
      gap >= 0
        ? Math.min(gap, NATCORP_RD_RAMP_UP_PER_TURN)
        : Math.max(gap, -NATCORP_RD_DECAY_PER_TURN);
    const next = Math.round(clamp(momentum + delta, 0, NATCORP_RD_MOMENTUM_MAX) * 100) / 100;
    if (next === momentum) continue; // nothing to write

    ops.push({
      updateOne: {
        filter: { _id: c._id },
        update: { $set: { rdScore: next, updatedAt: now } },
      },
    });
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
 *     coverable = min(totalShortfall, max(0, −realizedOperatingLossThisTurn))
 *
 * The residual — cash the corp spent on build orders — stays as negative
 * `liquidCapital`. An SOE that overbuilds stays negative until it earns its way
 * out (or a caretaker cancels the order and recovers the refundable CIP; there
 * is no automatic caretaker cancellation today, so in practice it simply stays
 * negative and cannot place further builds, which is the intended pressure).
 *
 * `realizedOperatingLossThisTurn` is the REALIZED per-corporation operating
 * loss for this turn, read from the corporation turn's own snapshots
 * (`CorpSnapshot.income`, ₳/turn — the same figure that moved `liquidCapital`
 * and that `corporationHistory.income` persists), NOT an estimate. That figure
 * already includes every cost line the turn actually charged — idle / mothball
 * upkeep, the regulatory burden, growth — which is what makes the upkeep-heavy
 * construction SOE (#2043) coverable: the old margin estimator below is blind
 * to upkeep by construction (`operatingCost` excludes it), so it reported a
 * fraction of the true loss and the enterprise carried the rest forever.
 *
 * The margin estimator survives ONLY as an explicit fallback
 * (`estimateSoeOperatingLossAnchor`) for callers that have no realized snapshot
 * map — direct unit tests, ad-hoc callers. It is never preferred when the
 * realized figure is available.
 *
 * WHAT NEITHER LEG SEES — the full list, because a partial one reads as a
 * complete one:
 *   - bond coupon interest and bond maturity face value (bondTurn)
 *   - corporate tax and dividend payouts (sectorCalculations)
 *
 * The debt and tax lines are DELIBERATELY out of scope: this covers the
 * OPERATING loss, and an SOE whose hole is interest- or tax-driven is therefore
 * not covered here and can stay negative. That is a known gap, not an
 * oversight — closing it is not a one-line change:
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
 * CIP (outstanding `constructionInProgressAnchor`) NEVER enters cover math. It
 * is read only to NAME the residual: after covering, whatever shortfall
 * remains is reconciled against held CIP, never funded by it. Covering at most
 * one turn of realized loss also means legacy holes are NOT forgiven and
 * landed build spending (already out of CIP into the paid capacity basis) is
 * NOT covered as free growth.
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
  /**
   * This turn's realized operating loss (₳, positive = loss), from the
   * corporation turn's snapshots. When present it IS the coverable basis;
   * when absent the margin estimate below is used as an explicit fallback.
   */
  realizedLossAnchor?: number;
}): number {
  const shortfall = Math.max(0, args.shortfallAnchor);
  if (!args.plantsEnabled || shortfall <= 0) return shortfall;
  const realized = args.realizedLossAnchor;
  if (typeof realized === "number" && Number.isFinite(realized)) {
    return Math.min(shortfall, Math.max(0, realized));
  }
  return Math.min(shortfall, estimateSoeOperatingLossAnchor(args));
}

/**
 * Fallback operating-loss estimate used ONLY when no realized per-corp loss is
 * available (see `coverableSoeShortfallAnchor`). Built from the plants-aware
 * sector profit basis (realized-preferring revenue less maintenance, no growth
 * charge) net of corp-level overhead, converted from the daily basis those
 * fields are stored on to one turn.
 *
 * Blind by construction to idle / mothball upkeep (`plantsUpkeepCost` in
 * sectorTurn) and the regulatory burden the turn processor charges — both live
 * outside `operatingCost`. Prefer the realized snapshot whenever it exists;
 * this exists so a missing map degrades to a conservative partial cover, never
 * to zero cover by accident and never to a full-hole comp.
 *
 * Returns ₳ (positive = loss, 0 = no estimated loss).
 */
export function estimateSoeOperatingLossAnchor(args: {
  corporation: Corporation;
  sectors: readonly CorporateSector[];
  corpOverheadAnchor: number;
  fxByCurrency: ReadonlyMap<CurrencyCode, number>;
}): number {
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
  return Math.max(0, -operatingResultPerTurn);
}

/**
 * Per-corporation treasury-backing reconciliation for one turn (₳ anchor).
 * `cipHeldAnchor` only NAMES the residual — capital construction is never
 * coverable and never enters cover math.
 */
export interface SoeCorpBacking {
  corpId: Corporation["_id"];
  /** Owning country whose treasury covered the loss. */
  countryId: CountryId;
  /** Total negative-liquidCapital hole at backing time. */
  shortfallAnchor: number;
  /** This turn's operating loss (positive = loss). */
  realizedLossAnchor: number;
  /** `snapshot` = this turn's corporation-turn snapshot; `estimate` = margin fallback. */
  realizedSource: "snapshot" | "estimate";
  /** What the treasury paid (₳). `min(shortfall, realizedLoss)` under plants. */
  coveredAnchor: number;
  /** What the treasury paid, in the corp's own currency (rounded). */
  coveredLocal: number;
  /** Outstanding construction-in-progress held off-cover (₳). Explains the residual. */
  cipHeldAnchor: number;
  /** `shortfallAnchor − coveredAnchor` (₳). */
  residualAnchor: number;
}

/**
 * Orchestrate SOE operations for the turn. Reads all state-owned corps, their
 * sectors, and the metrics of every state they operate in; applies mandate
 * contributions (scaled by SOE share of each state-sector) and backs any
 * negative liquidCapital from the treasury. Money math is ₳-anchor internal.
 *
 * `realizedIncomeAnchorByCorpId` carries this turn's realized per-corp
 * operating result (₳/turn, `CorpSnapshot.income`) keyed by corp id string.
 * When present for a corp it IS the coverable basis; when absent the margin
 * estimate is used as an explicit fallback (and recorded as such).
 *
 * WRITE ORDER (loud failure, #2043): every per-corp cover amount is computed
 * PURE first; then each owning treasury is debited; only then are the corp
 * credits bulk-written. A treasury failure therefore THROWS before any corp is
 * credited — never free money. The boundary is deliberate: a failure BETWEEN
 * the treasury debits and the corp bulk-write leaves debits without matching
 * credits on the treasury ledger (visible, auditable), and a retry recomputes
 * the same cover from the still-negative corp cash — so an operator rerun
 * after such a mid-pass failure must account for already-issued debits first.
 * Turn-level rerun atomicity beyond this window belongs to the turn framework,
 * like every other treasury leg in this turn.
 */
export async function processSoeOperations(
  db: Db,
  now: Date,
  /** Game year — era-prices the state capex grant. Absent ⇒ the anchor year. */
  currentYear?: number | null,
  /** This turn's realized per-corp operating income (₳/turn) by corp id. Absent ⇒ estimate fallback. */
  realizedIncomeAnchorByCorpId?: ReadonlyMap<string, number>
): Promise<{ soeCorps: number; backing: SoeCorpBacking[] }> {
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
  if (soeCorps.length === 0) return { soeCorps: 0, backing: [] };

  const corpIds = soeCorps.map((c) => c._id);
  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find(
      { corporationId: { $in: corpIds } },
      { projection: { buildQueue: 0, plantsPnl: 0, soldByCommodity: 0 } }
    )
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
  await applyBoardValueDeltasByRegion(db, boardDeltasByState);

  // Per-turn modernization (R&D): advance each SOE's decaying, scale-aware
  // momentum from its CEO-set budget (relative to its own revenue). The spend is
  // capped at the corp's revenue and charged through operating income (remittance
  // + budget line), not against liquidCapital — see buildRdModernizationOps.
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
  // up to this turn's REALIZED operating loss under plants. See
  // `coverableSoeShortfallAnchor`: cash drained into build orders is the
  // director's problem, not the treasury's. CIP only names the residual.
  //
  // LOUD ORDERING: the whole pass is computed pure first; treasury debits run
  // second; corp credits bulk-write last. A treasury failure throws before any
  // corp is credited (never free money), and the still-negative cash makes the
  // next attempt recompute the identical cover.
  const backing: SoeCorpBacking[] = [];
  for (const corp of soeCorps) {
    const liquid = Number.isFinite(corp.liquidCapital) ? corp.liquidCapital : 0;
    if (liquid >= 0) continue;
    const corpId = corp._id.toString();
    const countryId = (corp.countryOwnerId ?? corp.countryId) as CountryId;
    const code = resolveCorpLiquidCurrencyCode(corp);
    const rate = fxRateForCorpFromMap(corp, fxByCurrency);
    const shortfallAnchor = -corpCapitalToAnchor(liquid, code, rate);
    // Corp-level overhead is stored in the corp's own currency (daily basis),
    // same convention as estimateNationalizedOperatingIncome.
    const corpOverheadAnchor =
      readCorpEconomicAnchor(corp.marketingBudget ?? 0, code, rate) +
      readCorpEconomicAnchor(corp.logisticsBudget ?? 0, code, rate) +
      readCorpEconomicAnchor(corp.ceoSalary ?? 0, code, rate);
    const corpSectors = sectorsByCorpId.get(corpId) ?? [];
    const realizedIncome = realizedIncomeAnchorByCorpId?.get(corpId);
    let realizedLossAnchor: number;
    let realizedSource: "snapshot" | "estimate";
    if (typeof realizedIncome === "number" && Number.isFinite(realizedIncome)) {
      realizedLossAnchor = Math.max(0, -realizedIncome);
      realizedSource = "snapshot";
    } else {
      realizedLossAnchor = estimateSoeOperatingLossAnchor({
        corporation: corp,
        sectors: corpSectors,
        corpOverheadAnchor,
        fxByCurrency,
      });
      realizedSource = "estimate";
    }
    // Below plants the whole hole is covered, exactly as before.
    const coveredAnchor = plantsEnabled
      ? coverableSoeShortfallAnchor({
          corporation: corp,
          sectors: corpSectors,
          shortfallAnchor,
          corpOverheadAnchor,
          fxByCurrency,
          plantsEnabled,
          realizedLossAnchor,
        })
      : shortfallAnchor;
    const coveredLocal = Math.round(anchorToCorpCapital(coveredAnchor, code, rate));
    backing.push({
      corpId: corp._id,
      countryId,
      shortfallAnchor,
      realizedLossAnchor,
      realizedSource,
      coveredAnchor,
      coveredLocal,
      // Explanatory ONLY: held CIP names the residual, it never funds it.
      cipHeldAnchor: sumCorporateSectorConstructionInProgress(corpSectors, corp._id),
      residualAnchor: shortfallAnchor - coveredAnchor,
    });
  }

  const backingOps: AnyBulkWriteOperation<Corporation>[] = [];
  for (const b of backing) {
    if (!(b.coveredAnchor > 0)) continue; // nothing operating-related to comp
    // The OWNING treasury covers the loss — the same key the remittance,
    // the state capex grant, and both budget estimators use. A firm
    // nationalised abroad keeps its domicile on `countryId`, so debiting
    // that would drain a treasury for an enterprise it does not own while
    // the owner's books show the profit estimate (ticket #1269). The debit is
    // unconditional: an unaffordable cover pushes the treasury negative
    // (national debt) rather than being withheld — soft-budget semantics.
    await coverSoeOperatingLoss(db, b.countryId, b.coveredAnchor, fxByCurrency, now);
    // Credit only what the treasury actually paid. Below plants that is the
    // whole hole (liquidCapital → 0, as before); under plants an over-built SOE
    // is left negative by the residual it spent on capacity.
    backingOps.push({
      updateOne: {
        filter: { _id: b.corpId },
        update: plantsEnabled
          ? { $inc: { liquidCapital: b.coveredLocal }, $set: { updatedAt: now } }
          : { $set: { liquidCapital: 0, updatedAt: now } },
      },
    });
  }
  if (backingOps.length > 0) {
    await db.collection<Corporation>("corporations").bulkWrite(backingOps);
  }

  return { soeCorps: soeCorps.length, backing };
}

/**
 * Fold SOE backing credits and profit-remittance debits into the turn's
 * in-memory corp state BEFORE `corporationHistory` persistence, so history
 * rows chart post-backing cash instead of the pre-backing snapshot.
 *
 * PURE (no DB): the DB legs already landed inside `processSoeOperations` /
 * `processSoeRemittance`; this only syncs the two in-memory mirrors the
 * history writer reads (`corpSnapshots[].liquidCapital` + `soeBacking`, and
 * the `corpById` docs). Corp docs in the map are turn-start stale, so they are
 * synced TO the folded snapshot cash, not incremented — incrementing a stale
 * base would double-count the turn's operating income.
 */
export function foldSoeCashDeltas(args: {
  corpSnapshots: CorpSnapshot[];
  corpById: Map<string, Corporation>;
  backing: readonly SoeCorpBacking[];
  remittedLocalByCorpId: ReadonlyMap<string, number>;
}): void {
  const snapshotByCorpId = new Map(args.corpSnapshots.map((s) => [s.corpId.toString(), s]));
  const syncCorpCash = (key: string, snap: CorpSnapshot | undefined, deltaLocal: number): void => {
    const corp = args.corpById.get(key);
    if (!corp) return;
    corp.liquidCapital = snap
      ? snap.liquidCapital
      : (Number.isFinite(corp.liquidCapital) ? corp.liquidCapital : 0) + deltaLocal;
  };
  for (const b of args.backing) {
    const key = b.corpId.toString();
    const snap = snapshotByCorpId.get(key);
    if (snap) {
      snap.liquidCapital += b.coveredLocal;
      const reconciliation: SoeBackingSnapshot = {
        shortfallAnchor: b.shortfallAnchor,
        realizedLossAnchor: b.realizedLossAnchor,
        realizedSource: b.realizedSource,
        coveredAnchor: b.coveredAnchor,
        cipHeldAnchor: b.cipHeldAnchor,
        residualAnchor: b.residualAnchor,
      };
      snap.soeBacking = reconciliation;
    }
    syncCorpCash(key, snap, b.coveredLocal);
  }
  for (const [key, amount] of args.remittedLocalByCorpId) {
    if (!(amount > 0)) continue;
    const snap = snapshotByCorpId.get(key);
    if (snap) snap.liquidCapital -= amount;
    syncCorpCash(key, snap, -amount);
  }
}

/**
 * Deterministic aggregate audit row for the SOE backing + remittance sweep,
 * in the existing turn-audit shape (`corp.soe_backing_sweep`). PURE: rounded
 * totals only, no clock, no randomness — the same input always yields the same
 * entry. Returns null when neither leg moved anything, so callers emit no row.
 */
export function buildSoeBackingAuditEntry(args: {
  backing: readonly SoeCorpBacking[];
  remittedCorps: number;
}): ActionAuditInput | null {
  let corpsBacked = 0;
  let corpsWithResidual = 0;
  let snapshotCorps = 0;
  let coveredAnchor = 0;
  let residualAnchor = 0;
  for (const b of args.backing) {
    if (b.coveredAnchor > 0) corpsBacked += 1;
    if (b.residualAnchor > 0) corpsWithResidual += 1;
    if (b.realizedSource === "snapshot") snapshotCorps += 1;
    coveredAnchor += b.coveredAnchor;
    residualAnchor += b.residualAnchor;
  }
  if (corpsBacked === 0 && args.remittedCorps === 0) return null;
  return {
    source: "turn",
    category: "corp",
    action: "corp.soe_backing_sweep",
    phase: "corporationTurn",
    subject: { type: "corpBatch", name: "soe backing sweep" },
    outcome: "ok",
    meta: {
      corpsBacked,
      corpsWithResidual,
      realizedFromSnapshot: snapshotCorps,
      realizedFromEstimate: args.backing.length - snapshotCorps,
      coveredAnchor: Math.round(coveredAnchor),
      residualAnchor: Math.round(residualAnchor),
      remittedCorps: args.remittedCorps,
    },
  };
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
    const unitPrice = capacityPricePerUnit(
      sector.sectorType,
      priceYear,
      unitScale,
      sector.strategyId ?? null
    );
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
