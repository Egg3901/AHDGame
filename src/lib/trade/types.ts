import type { CountryId } from "@/lib/constants/countries";
import type { CommodityType } from "@/lib/constants/commodities";

/**
 * The effect an active embargo has on a single exporter→importer→commodity
 * flow, as consumed by the clearing engine. "block" removes the pair entirely
 * (affinity 0); "cap" limits the flow to at most `capUnits`.
 */
export interface TradeEmbargoEffect {
  mode: "block" | "cap";
  /** Upper bound on the flow in commodity UNITS. Required when mode === "cap". */
  capUnits?: number;
}

/** Inputs needed to compute affinity for one exporter→importer pair. */
export interface AffinityInputs {
  exporter: CountryId;
  importer: CountryId;
  commodity: CommodityType;
  /** True if the pair is covered by an active free-trade agreement. */
  ftaCovered: boolean;
  /** True if both countries share an international-org bloc (EU/NATO/custom). */
  sharedBloc: boolean;
  /**
   * Importer's effective tariff rate on this commodity, expressed as a fraction
   * (0.10 = 10%). Caller is responsible for FTA-neutralizing it first, exactly
   * as the existing tariff system does. Negative/NaN treated as 0.
   */
  importerTariffRate: number;
  /** True if an active embargo blocks this directed pair entirely. */
  blocked: boolean;
}

/** Per-commodity clearing inputs, all quantities in commodity UNITS. */
export interface ClearingInput {
  /** Countries participating (typically COUNTRY_ORDER). */
  countries: CountryId[];
  /** National supply in units, keyed by country. Missing = 0. */
  supply: Partial<Record<CountryId, number>>;
  /** National demand in units, keyed by country. Missing = 0. */
  demand: Partial<Record<CountryId, number>>;
  /**
   * Affinity weight for an exporter→importer pair (≥ 0). 0 means no trade
   * (blocked or zero gravity). Self-pairs (e === i) are never queried.
   */
  affinity: (exporter: CountryId, importer: CountryId) => number;
  /**
   * Optional per-pair upper bound in units (embargo "cap"). Return undefined
   * for no cap. Applied during allocation.
   */
  capUnits?: (exporter: CountryId, importer: CountryId) => number | undefined;
}

/** Per-country clearing outcome for one commodity, in units. */
export interface CountryClearing {
  /** Units this country exported (sum of its outbound flow). */
  exports: number;
  /** Units this country imported (sum of its inbound flow). */
  imports: number;
  /** exports − imports. */
  net: number;
  /**
   * Residual that did not clear: positive = leftover surplus that found no
   * buyer, negative = unmet deficit. Zero for balanced countries.
   */
  uncleared: number;
}

/** Result of clearing one commodity, all quantities in units. */
export interface ClearingResult {
  /** flow[exporter][importer] in units; exporter ≠ importer. */
  flow: Record<string, Record<string, number>>;
  /** Per-country exports/imports/net/uncleared. */
  perCountry: Record<string, CountryClearing>;
  /** Total units that changed hands = min(Σ surplus, Σ deficit) minus any cap loss. */
  clearedVolume: number;
}
