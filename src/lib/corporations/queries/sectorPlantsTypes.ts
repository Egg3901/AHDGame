/**
 * Plant capacity, freight and profit payloads for the sector detail page.
 * `SectorPlantsSection` keeps the physical cost chain and production summary together.
 */
import type { PolicyStackRow } from "@/lib/corporations/plantsPnlBasis";
import type { RetoolHint } from "@/lib/corporations/retoolHint";

/**
 * One named reason capacity did not run this turn. Shares sum, with
 * `other`, to exactly the idle share of capacity - the run meter on the sector
 * page draws straight from these and must reconcile on screen.
 */
export interface PlantIdleCause {
  /** Stable key the UI maps to a label, colour and tooltip. */
  cause:
    | "inputs"
    | "demand"
    | "ramping"
    | "strike"
    | "disaster"
    | "policy"
    | "deposits"
    | "mothballed"
    | "other";
  /** Capacity units that did not run for this reason, units/day. */
  units: number;
}

/** One outstanding capacity build order, already turned into countdown form. */
export interface PlantBuildOrderView {
  /** Index into the persisted `buildQueue` - the cancel command's `orderIndex`. */
  orderIndex: number;
  unitsOrdered: number;
  /** Units delivered into capacity so far (ramps up for a smooth order). */
  unitsDelivered: number;
  /** True when this order ramps in per turn rather than landing all at once. */
  smooth: boolean;
  costPaidAnchor: number;
  startTurn: number;
  onlineTurn: number;
  /** Turns still to run before the capacity fully lands. 0 = lands next turn. */
  turnsRemaining: number;
  /** Fraction of capacity DELIVERED so far, 0-1. */
  progress: number;
}

/**
 * Everything the plants-mode sector page needs that the pre-plants payload had
 * no home for. Present only under `marketSystemMode >= "plants"`; `null`
 * otherwise, which is what keeps every non-plants world rendering the old page
 * byte-for-byte.
 *
 * MONEY UNITS: every `*Anchor` field is ₳ (economic anchor) on the DAILY basis
 * `sector.revenue` uses - NOT the corp-currency basis the `financials` block
 * ships in. The two are deliberately different: the plants block is a physical
 * statement about one plant in one host economy, so it stays in the currency
 * the commodity ledger prices in.
 *
 * UNIT UNITS: every `*Units` field is output units per financial day, the same
 * basis as `capitalStock` / `producedUnits`.
 */
export interface SectorPlantsSection {
  /** Persisted whole facilities owned by this sector. */
  plantCount: number;
  /** Installed capacity, units/day. Null before the sector's first plants turn. */
  capacityUnits: number | null;
  /** Units the plants actually made this turn. Null until a plants turn has run. */
  producedUnits: number | null;
  /** Units that found a buyer. Null until a plants turn has run. */
  soldUnits: number | null;
  /** producedUnits − soldUnits, floored at 0. */
  unsoldUnits: number | null;
  /** capacityUnits − producedUnits, floored at 0. */
  idleUnits: number | null;
  /** soldUnits / producedUnits, 0-1. Null when nothing was produced. */
  fillRate: number | null;
  /** Named reasons behind `idleUnits`. Sums to `idleUnits`. */
  idleCauses: PlantIdleCause[];
  mothballed: boolean;
  /** Outstanding build orders, oldest first. */
  buildQueue: PlantBuildOrderView[];
  /** ₳ paid for capacity that is not productive yet. */
  constructionInProgressAnchor: number;
  /** Capacity lost per turn with no investment, as a fraction (0.001 = 0.1%/turn). */
  depreciationPerTurn: number;
  /** Turns a new build in this sector takes to come online. */
  buildTurns: number;
  workers: number;
  /** Headcount this capacity would employ if every role could be filled. */
  workersDesired: number;
  /** Actual workers divided by desired workers, after the hiring ramp. */
  labourStaffingFactor: number;
  /** NPC unionization pressure, 0-100. */
  unionizationPct: number;
  /** Workers needed per unit/day of capacity at this era. */
  laborIntensity: number;
  /** Launch-safety governor state - the "market support" pill. */
  governor: {
    /** True while the ramp is still running (the governor is still holding). */
    active: boolean;
    startTurn: number | null;
    rampTurns: number;
    /** Turns until the governor is fully faded out. 0 when done. */
    turnsRemaining: number;
    /** Max fractional deviation the governor still allows. */
    cap: number;
  };
  /** Untapped demand in this (state, sectorType) market, units/day. */
  headroomUnits: number;
  /**
   * Weighted expansion appetite across the output mix, including latent demand.
   * It can remain positive while one output has no unmet demand. It is not an
   * all-output sell-through limit. Use measuredDemandGapUnits for automatic
   * sizing; headroomUnits measures claimable market share.
   *
   * 0 while `roomHeldByOwnIdle`: this sector's own idle capacity reaches the
   * market before any new build would.
   */
  demandGapUnits: number;
  /** Measured room for every output after known queues; excludes latent demand. */
  measuredDemandGapUnits?: number | null;
  /**
   * True when this sector's own demand throttle bound last turn. Its idle
   * capacity is what buyers' room fills first (output can climb by the probe
   * margin each turn while sales keep up), so the room to BUILD reads 0 rather
   * than quoting the market gap beside a plant that is itself held back
   * (ticket 1370).
   */
  roomHeldByOwnIdle?: boolean;
  /**
   * Share of this market nobody has built into, in percent: the unowned pool
   * over owned capacity plus that pool. The same pool `headroomUnits` bounds a
   * build by, so the two numbers the panel shows side by side reconcile.
   * Absent when owned capacity is unknown.
   */
  unclaimedSharePct?: number;
  /**
   * Set when the demand throttle holds this plant down because the valuable
   * part of its output is oversupplied and another strategy for the same
   * sector would sell into a shortage here (ticket 1370 follow-up). Advisory.
   */
  retoolHint: RetoolHint | null;
  currentTurn: number;
  /**
   * Everything the build dialog needs to price an order CLIENT-SIDE. Build cost
   * is exactly linear in units, so shipping the per-unit breakdown once lets the
   * stepper update instantly instead of round-tripping the preview endpoint on
   * every keystroke - and it is the same `computeBuildCost` the command charges.
   */
  activeCapacityPercent?: number;
  capacityRecovery?: { coldUpkeepFraction: number; coldUpkeepDailyAnchor: number };
  investment?: {
    overheadDailyAnchor: number;
    /** One turn of company running costs; null when liabilities or current costs are unknown. */
    operatingReserveAnchor?: number | null;
    taxRatePercent: number;
    freightNetCostDailyAnchor?: number;
    inventoryRevenueDailyAnchor?: number;
    bondReference?: import("@/lib/corporations/investment/rules").InvestmentBondReference | null;
  };
  buildQuote: {
    financing?: import("@/lib/banking/rules/constructionRequest").ConstructionFinanceView;
    /** Base ₳ per unit at this era, before the multipliers below. */
    unitPriceAnchor: number;
    expansionMultiplier?: number;
    dominanceMultiplier: number;
    rateMultiplier: number;
    acumenMultiplier: number;
    techMultiplier: number;
    hostPriceMultiplier: number;
    /** unitPriceAnchor × every multiplier - the ₳ of CONSTRUCTION per unit. */
    perUnitAnchor: number;
    /**
     * C9: cross-currency transaction fee rate the server also charges on top of
     * the construction cost (`corpToSectorCountrySpread`, SECTOR_FX_SPREAD),
     * 0 when the corp and the host country share a currency.
     *
     * It is strictly proportional to the construction cost, so the client can
     * quote it exactly rather than guessing - which is the point. Quoting
     * `perUnitAnchor × units` alone under-quoted every foreign build and let the
     * dialog offer an order the server then refused for insufficient capital.
     */
    fxSpreadRate: number;
    /** perUnitAnchor × (1 + fxSpreadRate) - the ₳ per unit actually charged. */
    perUnitChargedAnchor: number;
    /** Corp's spendable capital, normalized to ₳ so the dialog can gate on it. */
    corpCapitalAnchor: number;
    /** Largest whole order the corp can afford, fee included. */
    maxAffordableUnits: number;
  };
  /**
   * The modifiers behind `pnl.policyAnchor`, already in money and summing to it
   * exactly. Empty when there is no stack to explain, or on the fallback path
   * where the credit cannot be separated from the residual.
   */
  policyStack: PolicyStackRow[];
  /**
   * The physical profit and loss, ₳/day. Reconciles by construction:
   * `profit = revenue - inputs - labour - upkeep - compliance + policy
   * - otherOperating - growthAndBuild - freightCost`, with freight earnings
   * included in revenue. The physical lines come from `plantsPnl`; freight
   * settles separately. Absent that row it falls back to inverting
   * the margin, where `otherOperating` is the solved residual that makes the
   * same identity hold.
   */
  pnl: {
    revenueAnchor: number;
    inputsAnchor: number;
    labourAnchor: number;
    upkeepAnchor: number;
    complianceAnchor: number;
    /**
     * The policy/tech modifier stack as money: tariffs, subsidies, state
     * metrics, regional conditions, tech bonuses, strategy transition, the SOE
     * and nationalization terms. POSITIVE is a credit that lowers cost.
     *
     * Under plants this is the ONLY channel by which any of those modifiers
     * reaches profit, so showing it is the difference between a player seeing
     * their subsidy and a player seeing an unexplained residual. 0 on the
     * fallback path, where the credit is still buried in `otherOperatingAnchor`
     * and cannot be separated.
     */
    policyAnchor: number;
    /** The same stack in percentage points of revenue, after the soft cap. */
    policyPp: number;
    otherOperatingAnchor: number;
    freightCostAnchor?: number;
    freightIncomeAnchor?: number;
    growthAndBuildAnchor: number;
    profitAnchor: number;
    /** Part of `otherOperatingAnchor` attributable to active crises. */
    financialEventsAnchor: number;
    /** revenue / soldUnits - what a unit actually fetched. */
    avgSalePriceAnchor: number | null;
    /** profit / producedUnits - the per-unit margin the dialog pays back on. */
    profitPerUnitAnchor: number | null;
  };
  /**
   * The three-number headline (ticket #1027 family): what the sector page leads
   * with so a player never again reads "43% margin" and "no money coming in" on
   * the same screen. Everything here is computed from the same telemetry the
   * pnl block reads, so the headline can never disagree with the money chain
   * below it.
   */
  truth: {
    /**
     * Share of output that found a buyer, 0-1. The engine's weighted
     * `soldFraction` when clearing wrote one, else the same soldUnits /
     * producedUnits ratio as `fillRate`. Null before the first plants turn.
     */
    soldFraction: number | null;
    /**
     * Per-output breakdown behind the blended headline. A multi-output sector
     * can clear one commodity fully and another barely; the blend alone reads
     * as though the short commodity is the one not selling. Empty when
     * clearing has not written the per-commodity split.
     */
    soldByCommodity: { commodity: string; fraction: number }[];
    /**
     * Share of offered output (0..1) that no freight network could place last
     * turn. The other half of the shortfall `soldFraction` reports: on screen
     * the two look identical and they mean opposite things, because a demand
     * shortfall says cut output while a delivery shortfall says buy freight or
     * build somewhere else. 0 when the engine wrote nothing.
     */
    deliveryLimitedFraction: number;
    deliveryLimitedFreightClass: "bulk" | "special" | "grid" | null;
    /**
     * Consecutive turns the sector cleared under half its output (see
     * strandedPlant.ts). Drives the stranded-plant warning on the sector page
     * once it reaches STRANDED_WARN_TURNS.
     */
    lowFillTurns: number;
    /**
     * Inventory of unsold storable output (design-realization-legs §6): the
     * toggle state plus the pile. Null-ish zeros before the first inventory
     * turn.
     */
    inventory: {
      stockpileUnsold: boolean;
      heldUnits: number;
      heldValueAnchor: number;
      byCommodity: { commodity: string; units: number }[];
      drainedUnits: number;
      spoiledUnits: number;
    };
    /**
     * Realized revenue per unit PRODUCED (not per unit sold): what a unit
     * coming off the line actually brought in, unsold units included at zero.
     * Null when nothing was produced.
     */
    receivedPerUnitAnchor: number | null;
    /**
     * Operating cost per unit produced: inputs, wages, upkeep on idle
     * capacity, compliance and other opex (the full `maintenanceNet + labour`
     * bill), spread over every unit made. Null when nothing was produced.
     */
    costPerUnitAnchor: number | null;
    /**
     * Net margin: realized profit over realized revenue, in percent, with the
     * whole bill (unsold output included) netted out of profit. This is the
     * full-cost counterpart to the stored `effectiveProfitMargin`, which
     * excludes upkeep, compliance, inventory carry, growth and freight.
     * Floored at -999.9 for a sector that sold nothing but paid
     * its bill; null when there was neither revenue nor cost.
     */
    fillAdjustedMarginPct: number | null;
    /**
     * Break-even against construction in progress: how the money already sunk
     * into unbuilt capacity relates to what the sector clears per turn.
     * `turns` is set only for status "turns".
     */
    breakEven: {
      status: "profitable_now" | "turns" | "not_at_current_fills";
      turns: number | null;
    };
  };
}
