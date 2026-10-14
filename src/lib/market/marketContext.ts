import type { MarketSystemMode } from "@/lib/market/featureFlag";
import { marketAtLeast } from "@/lib/market/featureFlag";
import type { SectorClearingResult } from "@/lib/market/clearing";
import type { FreightClass } from "@/lib/logistics/freightClass";
import type { EditorialPosition } from "@/lib/mediaEditorial/rules";
import {
  MARKET_REALIZATION_DEVIATION_CAP,
  MARKET_REALIZATION_RAMP_TURNS,
  MARKET_GOVERNOR_GLIDE_TURNS,
  governorGlideAnchorTurn,
  proportionalGovernorGlide,
  type GovernorGlide,
} from "@/lib/market/capital";

/**
 * Per-turn market-rework context threaded into the corporation phase —
 * resolved once from `marketSystemMode` (mirrors LabourContext).
 */
export interface MarketContext {
  /** Tier 1: realized revenue scaled by lagged output prices. */
  realizationEnabled: boolean;
  groupSupplyEnabled?: boolean;
  groupSupplyDiscountsEnabled?: boolean;
  groupSupplyCommittedOutputsBySector?: ReadonlyMap<string, ReadonlyMap<string, number>>;
  groupSupplyCommittedInputsBySector?: ReadonlyMap<string, ReadonlyMap<string, number>>;
  groupSupplyInputsBySector?: ReadonlyMap<
    string,
    ReadonlyMap<
      import("@/lib/constants/commodities").CommodityType,
      import("@/lib/corporations/groups/rules/inputPricing").GroupInputAllocation
    >
  >;
  groupSupplyForecastByRoot?: ReadonlyMap<
    string,
    import("@/lib/corporations/groups/rules/forecast").GroupForecastBasis
  >;
  groupSupplyAvailabilityBySector?: ReadonlyMap<
    string,
    ReadonlyMap<import("@/lib/constants/commodities").CommodityType, number>
  >;
  groupSupplyReceipts?: readonly import("@/lib/corporations/groups/rules/marketCoordination").GroupMarketReceipt[];
  /** Tier 3 / D1: output throttled by the scarcest available input. */
  throughputEnabled: boolean;
  /** Tier 3 / Fix 2: posted-price market clearing. */
  clearingEnabled: boolean;
  /** Tier 4 / Fix 4 v1: capacity gates output; growth builds capital; depreciation. */
  capitalEnabled: boolean;
  /**
   * Tier 5 ("plants", P2 of the buildable-sectors plan): capacity is the
   * AUTHORITATIVE production base and revenue is derived from produced units,
   * instead of capacity merely haircutting a compounding revenue nameplate.
   */
  plantsEnabled: boolean;
  /** Default off: explicit positive overhead replaces the margin residual. */
  explicitPlantCostsEnabled?: boolean;
  /** Commodity treadmill fix stage (0..6); stage 4 adds shortage policy headroom. */
  commodityFixStage?: number;
  /** Halve remaining build time for orders in deep-shortage sectors. */
  shortageBuildSpeedupEnabled?: boolean;
  /** Default off: ownership limits and censorship constrain media delivery. */
  mediaRegulationEnabled?: boolean;
  /** Default off: enacted pre-repeal US fairness doctrine affects outlet reach. */
  mediaFairnessDoctrineEnabled?: boolean;
  /** Existing editorial-market gate, threaded to distinguish it from the law. */
  mediaEditorialEnabled?: boolean;
  /** Selected US media communications policy option, read only while gated on. */
  mediaRegulationPolicyOptionIndex?: number;
  /** Explicit agreements claim these daily input units before an internal rebate. */
  internalSupplyCommittedInputsBySectorId?: ReadonlyMap<string, ReadonlyMap<string, number>>;
  internalSupplyTrades?: readonly (import("./internalSupply/rules").InternalSupplyTrade & {
    commodity: import("@/lib/constants/commodities").CommodityType;
    marketPrice: number;
  })[];
  internalSupplyReceiptsBySectorId?: ReadonlyMap<
    string,
    {
      turn: number;
      received: Partial<Record<import("@/lib/constants/commodities").CommodityType, number>>;
      reserved: Partial<Record<import("@/lib/constants/commodities").CommodityType, number>>;
    }
  >;
  /** Actual own-group reservations, replacing anonymous availability for touched inputs. */
  internalInputAvailabilityBySectorId?: ReadonlyMap<
    string,
    ReadonlyMap<import("@/lib/constants/commodities").CommodityType, number>
  >;
  /** Equal-and-opposite per-turn discount cost, positive on suppliers, negative on buyers. */
  internalSupplyDiscountCostBySectorId?: ReadonlyMap<string, number>;
  /**
   * Pre-pass clearing results per sector id (computed in the corp-phase entry
   * from lagged balances). Absent entries mean "no outputs" → factor 1.
   */
  clearingBySectorId?: ReadonlyMap<string, SectorClearingResult>;
  /**
   * Plants tier: scalar output units each sector should make to meet the
   * corporation's named-buyer reservations. This is a demand floor, not an
   * additional supply stream, and is populated before processSectors runs.
   */
  contractProductionTargetBySectorId?: ReadonlyMap<string, number>;
  /**
   * Advertising sellers that filled the clearing book this turn, keyed by
   * corporation id. Values are the per-turn anchor value of campaign units
   * actually delivered at their reachable clearing price.
   */
  advertisingSellerDeliveredValueAnchorByCorpId?: ReadonlyMap<string, number>;
  /** Exact native-currency amounts reserved for funded political ad sellers. */
  politicalAdSellerPayoutLocalByCorpId?: ReadonlyMap<string, number>;
  /** Delivered media outlets per audience state, normalized by local delivered units. */
  editorialOutletsByState?: ReadonlyMap<
    string,
    readonly {
      corporationId: string;
      stance: EditorialPosition;
      audienceShare: number;
      attentionUnits?: number;
    }[]
  >;
  /**
   * Freight seam: per sector id, the share of its clearing offer (0..1) that
   * last turn's freight network could not place out of its host state, so the
   * offer was cut by it. Set by the corp-phase entry only while freight
   * settlement is active; absent everywhere else, which keeps the telemetry
   * write inert on worlds that do not settle freight.
   */
  deliveryLimitedBySectorId?: ReadonlyMap<string, number>;
  /** Cargo class responsible for the delivery-limited share above. */
  deliveryLimitedClassBySectorId?: ReadonlyMap<string, FreightClass | null>;
  /**
   * Canonical freight billing v1 (issue #897): per sector id, last turn's
   * shipping cost the sector owes for its state's inbound hauls of the
   * commodities it consumes, as DAILY money (the sourcing pass settles the
   * daily commodity ledger). `resolveSectorFreightBillingLegs` spreads it over
   * TURNS_PER_DAY before it touches the hourly cost rail. Set by the corp-phase entry only while
   * `gameConfig.canonicalFreightBillingEnabled` is on; absent everywhere else,
   * so a world with billing off computes and persists nothing.
   */
  freightBillingChargeBySectorId?: ReadonlyMap<string, number>;
  /**
   * The transfer's other half: per sector id, last turn's haul revenue the
   * sector's freight supply earned, daily money like the charge map. Same gate
   * as the charge map.
   */
  freightBillingCreditBySectorId?: ReadonlyMap<string, number>;
  /**
   * Launch-safety governor bounds (tunable live via gameConfig). `cap` is the
   * max fractional deviation the clearing/throughput legs may take from the
   * ledger baseline; `rampTurns` is the window over which that divergence fades
   * in from the flip. Fall back to the module defaults when unset.
   */
  governorCap: number;
  governorRampTurns: number;
  /**
   * World turn the governor ramp is anchored to, from the governor glide
   * (`governorGlideAnchorTurn`). Null = no glide configured: every sector
   * ramps from its own first-turn stamp.
   * Sectors ramp from the earlier of this and their own stamp.
   */
  worldGovernorAnchorTurn?: number | null;
  /** Turn the governor glide completes; null when no glide is configured. */
  governorGlideEndTurn?: number | null;
  /**
   * Proportional glide parameters (`marketGovernorGlideMode: "proportional"`).
   * When set, `worldGovernorAnchorTurn` is null and every governor anchor is
   * resolved per sector from this. See `proportionalGlideAnchorTurn`.
   */
  governorGlide?: GovernorGlide | null;
}

/** Baseline economy — every market-rework mechanic off. */
export const MARKET_DISABLED: MarketContext = {
  realizationEnabled: false,
  throughputEnabled: false,
  clearingEnabled: false,
  capitalEnabled: false,
  plantsEnabled: false,
  governorCap: MARKET_REALIZATION_DEVIATION_CAP,
  governorRampTurns: MARKET_REALIZATION_RAMP_TURNS,
};

export function buildMarketContext(
  mode: MarketSystemMode,
  governor?: {
    cap?: number | null;
    rampTurns?: number | null;
    currentTurn?: number | null;
    glideStartTurn?: number | null;
    glideTurns?: number | null;
    /** "proportional" switches the glide formula; anything else keeps the floor glide. */
    glideMode?: string | null;
    /** Proportional glide only: the floor glide's share frozen at switch-over. */
    glideFloor?: number | null;
  }
): MarketContext {
  const cap =
    typeof governor?.cap === "number" && governor.cap >= 0 && governor.cap <= 1
      ? governor.cap
      : MARKET_REALIZATION_DEVIATION_CAP;
  const rampTurns =
    typeof governor?.rampTurns === "number" && governor.rampTurns >= 1
      ? governor.rampTurns
      : MARKET_REALIZATION_RAMP_TURNS;
  const proportional =
    governor?.glideMode === "proportional" && typeof governor?.currentTurn === "number"
      ? proportionalGovernorGlide(
          governor.currentTurn,
          governor.glideStartTurn,
          governor.glideTurns,
          rampTurns,
          governor.glideFloor
        )
      : null;
  return {
    realizationEnabled: marketAtLeast(mode, "realization"),
    throughputEnabled: marketAtLeast(mode, "clearing"),
    clearingEnabled: marketAtLeast(mode, "clearing"),
    capitalEnabled: marketAtLeast(mode, "capital"),
    plantsEnabled: marketAtLeast(mode, "plants"),
    governorCap: cap,
    governorRampTurns: rampTurns,
    governorGlide: proportional,
    worldGovernorAnchorTurn:
      !proportional && typeof governor?.currentTurn === "number"
        ? governorGlideAnchorTurn(
            governor.currentTurn,
            governor.glideStartTurn,
            governor.glideTurns,
            rampTurns
          )
        : null,
    governorGlideEndTurn:
      typeof governor?.glideStartTurn === "number" && Number.isFinite(governor.glideStartTurn)
        ? governor.glideStartTurn +
          (typeof governor.glideTurns === "number" && governor.glideTurns >= 1
            ? governor.glideTurns
            : MARKET_GOVERNOR_GLIDE_TURNS)
        : null,
  };
}
