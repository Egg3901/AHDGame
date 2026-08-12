/**
 * Command Economy v2 (P2) — pure presenter + shared payload types for the
 * per-country Command Economy dashboard and its three role panels. Pure and
 * client-safe: the API route does the DB reads and calls these to shape the
 * payload; the client renders it and re-uses the same types.
 */

import { CORPORATION_TYPE_LABELS, type CorporationType } from "@/lib/constants/corporations";
import {
  COMMAND_CEILING,
  computePolicyStance,
  NPP_DEFAULT_REFORMISM,
} from "@/lib/constants/commandEconomy";
import { blackMarketPressure } from "@/lib/economy/commandEconomyState";
import { aggregateCapacityUtilisation, planFulfillment } from "@/lib/economy/soe";

export type CommandEconomyRegime = "command" | "dual-track";

/** One state-owned enterprise as shown in the dashboard SOE list / director panel. */
export interface SoeView {
  corpId: string;
  corpName: string;
  sector: CorporationType;
  sectorLabel: string;
  output: number;
  planTarget: number;
  capacity: number;
  /** output / planTarget, clamped [0, 2]. */
  planFulfillment: number;
  efficiency: number;
  cumulativeLosses: number;
  directorId: string | null;
  directorName: string | null;
  /** True when no character directs this SOE (NPP brain runs it). */
  vacant: boolean;
  /** True when the requesting viewer is this SOE's director. */
  viewerIsDirector: boolean;
  /** Director levers (0.5 balanced default surfaced when unset). */
  laborQuality: number;
  investmentRequest: number;
  /** Directed credit Gosbank sent this sector last turn (readout). */
  directedCreditLastTurn: number | null;
}

/** The three live drivers behind the marketization gauge. */
export interface MarketizationDrivers {
  /** 0..1 — shortage / shadow premium / grey-market pressure toward the market. */
  blackMarketPressure: number;
  /**
   * Aggregate SOE CAPACITY UTILISATION (1.0 = running the plant flat out), the
   * quantity the engine actually feeds `marketizationDrift`. Deliberately not
   * plan fulfillment, whose denominator the Gosplan chair sets.
   */
  soePerformance: number;
  /** -1 (orthodox, entrench) .. +1 (reformist, marketize) policy stance. */
  policyStance: number;
}

/** Gosbank state-credit posture + its shortage cost. */
export interface GosbankStanceView {
  creditAggressiveness: number;
  budgetSoftness: number;
  /** Explicit per-sector weighting the chair set, or null for automatic. */
  sectorCredit: Record<string, number> | null;
  /** Per-sector directed credit issued last turn (readout). */
  directedCreditLastTurn: Record<string, number> | null;
  /** Monetized issuance last turn (the money-printing slice). */
  issuanceLastTurn: number | null;
  /**
   * The upkeep slice of last turn's credit: what only bought back worn-out
   * capacity. It does not answer to the aggressiveness lever, so a chair who
   * sets credit to zero and still sees the presses running needs this number
   * to understand why. Null below the plants tier, where there is no upkeep
   * bill because capacity is not a physical stock.
   */
  upkeepLastTurn: number | null;
  monetaryOverhang: number | null;
  shortageIndex: number | null;
  blackMarketPremium: number | null;
  /** Plain-language reading of the current stance's shortage cost. */
  costLabel: string;
}

/** Internal-repression lever state + its two consequences, for the dashboard. */
export interface RepressionView {
  /** 0 (none) … 1 (heavy) internal-repression level in force. */
  level: number;
  /** Black-market pressure before repression (0..1 readout). */
  blackMarketPressureBase: number | null;
  /** Black-market pressure after repression actually fed the drift (0..1). */
  blackMarketPressureEffective: number | null;
  /** Signed per-turn legitimacy cost this turn (-1..0). */
  legitimacyCostPerTurn: number | null;
  /** Plain-language reading of the current repression stance. No dashes / filler. */
  costLabel: string;
}

export interface CommandEconomyViewerRoles {
  isHeadOfGovernment: boolean;
  isPlanner: boolean;
  isBankChair: boolean;
  /** True if the viewer may set the internal-repression lever. */
  canSetRepression: boolean;
  /** corpIds of SOEs the viewer directs. */
  directedCorpIds: string[];
}

export interface CommandEconomyDashboard {
  countryId: string;
  countryName: string;
  enabled: boolean;
  regime: CommandEconomyRegime;
  regimeLabel: string;
  marketizationLevel: number;
  drivers: MarketizationDrivers;
  soes: SoeView[];
  /**
   * Aggregate plan fulfillment across all SOEs: the directors' collective grade
   * against the quotas Gosplan set. No longer a mirror of
   * `drivers.soePerformance`, which is capacity utilisation.
   */
  aggregateFulfillment: number;
  gosbank: GosbankStanceView;
  repression: RepressionView;
  plannerName: string | null;
  bankChairName: string | null;
  viewerRoles: CommandEconomyViewerRoles;
  currentTurn: number | null;
}

/** Raw SOE record the route passes in (already loaded from the corp doc). */
export interface RawSoe {
  corpId: string;
  corpName: string;
  sector: CorporationType;
  output: number;
  planTarget: number;
  capacity: number;
  efficiency: number;
  cumulativeLosses: number;
  directorId: string | null;
  directorName: string | null;
  laborQuality: number | null | undefined;
  investmentRequest: number | null | undefined;
  directedCreditLastTurn: number | null;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function regimeFromLevel(level: number): CommandEconomyRegime {
  return level < COMMAND_CEILING ? "command" : "dual-track";
}

export function regimeLabel(regime: CommandEconomyRegime): string {
  return regime === "command" ? "Command economy" : "Dual-track";
}

/** Shape one raw SOE into its view, flagging the viewer's own directorship. */
export function presentSoe(raw: RawSoe, viewerCharacterId: string | null): SoeView {
  const output = num(raw.output);
  const planTarget = num(raw.planTarget);
  return {
    corpId: raw.corpId,
    corpName: raw.corpName,
    sector: raw.sector,
    sectorLabel: CORPORATION_TYPE_LABELS[raw.sector] ?? raw.sector,
    output,
    planTarget,
    capacity: num(raw.capacity),
    planFulfillment: planFulfillment({ output, planTarget }),
    efficiency: num(raw.efficiency, 1),
    cumulativeLosses: num(raw.cumulativeLosses),
    directorId: raw.directorId,
    directorName: raw.directorName ?? null,
    vacant: !raw.directorId,
    viewerIsDirector:
      !!raw.directorId && !!viewerCharacterId && raw.directorId === viewerCharacterId,
    laborQuality: num(raw.laborQuality, 0.5),
    investmentRequest: num(raw.investmentRequest, 0),
    directedCreditLastTurn: raw.directedCreditLastTurn,
  };
}

/**
 * Plain-language reading of a Gosbank stance's shortage cost. No dashes / filler.
 */
export function gosbankCostLabel(
  overhang: number | null,
  shortageIndex: number | null,
  creditAggressiveness: number
): string {
  const o = num(overhang);
  const s = num(shortageIndex);
  if (s >= 60 || o >= 60) {
    return "Shelves are emptying. The overhang is high and shortages are acute. Ease credit or let weak plants fold to relieve it.";
  }
  if (s >= 30 || o >= 30) {
    return creditAggressiveness >= 0.6
      ? "Heavy credit is building an overhang. Growth is up but shortages are rising."
      : "Some overhang is building. Shortages are moderate.";
  }
  return "The plan is broadly cleared. Little overhang and shortages are mild.";
}

/**
 * Plain-language reading of the internal-repression stance. Names the tradeoff:
 * repression forces the black market down and buys time against reform, but the
 * shortage is untouched and the legitimacy bill grows with it. No dashes / filler.
 */
export function repressionCostLabel(
  level: number,
  shortageIndex: number | null,
  legitimacyCostPerTurn: number | null
): string {
  const rep = num(level);
  const s = num(shortageIndex);
  const cost = Math.abs(num(legitimacyCostPerTurn));
  if (rep < 0.1) {
    return "Repression is off. The second economy runs freely and its pressure feeds reform.";
  }
  if (s >= 40 && rep >= 0.5) {
    return `Heavy repression atop deep shortage. The black market is forced down, but legitimacy is bleeding about ${cost.toFixed(2)} a turn and the shelves are still empty. This is a pressure cooker.`;
  }
  if (rep >= 0.5) {
    return "Firm repression is holding the black market down and slowing reform. Keep the shortage low or the legitimacy cost will climb.";
  }
  return "Light repression trims the black market at a small legitimacy cost. Deliver the goods and it stays cheap.";
}

/**
 * Build the marketization drivers from the persisted macro readouts + SOEs.
 * `reformism` is the government reform lean (P3 wires a live value; default 0).
 */
export function computeMarketizationDrivers(inputs: {
  shortageIndex: number | null;
  blackMarketPremium: number | null;
  secondEconomyShare: number | null;
  soes: ReadonlyArray<{ output: number; capacity: number }>;
  creditAggressiveness: number;
  budgetSoftness: number;
  reformism?: number;
}): MarketizationDrivers {
  const pressure = blackMarketPressure(
    num(inputs.shortageIndex),
    num(inputs.blackMarketPremium),
    num(inputs.secondEconomyShare)
  );
  // Capacity utilisation, matching what `commandEconomyTurn` actually feeds the
  // drift. The dashboard mirrors the ENGINE'S driver, not the director's grade,
  // so the gauge cannot disagree with the dial it is explaining.
  const soePerformance = aggregateCapacityUtilisation(inputs.soes);
  const policyStance = computePolicyStance(
    typeof inputs.reformism === "number" ? inputs.reformism : NPP_DEFAULT_REFORMISM,
    inputs.creditAggressiveness,
    inputs.budgetSoftness
  );
  return { blackMarketPressure: pressure, soePerformance, policyStance };
}
