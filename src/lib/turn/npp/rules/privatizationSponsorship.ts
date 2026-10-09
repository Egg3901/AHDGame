/**
 * NPP privatization sponsorship: when and what an AI-governed planned (or
 * formerly planned) economy proposes to carve out of its National Corporations.
 *
 * The marketization dial decides it, never the `commandEconomyEnabled` flag,
 * matching the private-enterprise gate: below COMMAND_CEILING there is no
 * private sector to sell into, dual-track sells small slices occasionally, and
 * the market band sells larger slices more often. Only countries carrying a
 * MARKETIZATION_SCHEDULE entry qualify, so a market economy that happens to own
 * a National Corporation never starts selling it off on its own.
 *
 * Pure: plain rows in, plain plan out. The shell (`proposeNppPrivatizationBill`)
 * loads the rows, writes the bill, and lets the enactment-time anti-monopoly
 * clamp have the final say on each carve fraction.
 */
import { COMMAND_CEILING, DUAL_TRACK_CEILING } from "@/lib/constants/commandEconomy";
import type { CorporationType } from "@/lib/constants/corporations";
import {
  CARVE_FRACTION_MAX,
  CARVE_FRACTION_MIN,
  GOLDEN_SHARE_MAX,
  REPRIVATIZE_COOLDOWN_TURNS,
} from "@/lib/nationalization/constants";

// ── Tunables (all pacing lives here) ────────────────────────────────────────

/**
 * Dual-track band (COMMAND_CEILING..DUAL_TRACK_CEILING): modest, occasional
 * batches. Sector count and carve fraction rise linearly across the band, so a
 * country just past the ceiling sells one 15% slice and one near the market
 * band sells three 30% slices.
 */
export const NPP_PRIVATIZATION_DUAL_TRACK = {
  /** Minimum turns between two NPP privatization bills in one country. */
  intervalTurns: 240,
  minSectors: 1,
  maxSectors: 3,
  minCarveFraction: 0.15,
  maxCarveFraction: 0.3,
} as const;

/** Market band (>= DUAL_TRACK_CEILING): larger, more frequent batches. */
export const NPP_PRIVATIZATION_MARKET = {
  intervalTurns: 96,
  sectors: 6,
  carveFraction: 0.5,
} as const;

/**
 * A sector carved (or proposed for carving) by any privatize bill in the
 * country within this many turns is skipped, so successive batches move on to
 * other holdings instead of shaving the same one forever.
 */
export const NPP_PRIVATIZATION_RESELECT_COOLDOWN_TURNS = 480;

/** State-retained golden share on a spin-out that includes a strategic sector. */
export const NPP_PRIVATIZATION_STRATEGIC_GOLDEN_SHARE = Math.min(0.25, GOLDEN_SHARE_MAX);

/**
 * Sector types an NPP government never puts up for sale on its own initiative.
 * Defence production feeds state arsenals and procurement contracts.
 */
export const NPP_PRIVATIZATION_EXCLUDED_SECTOR_TYPES: ReadonlySet<CorporationType> = new Set([
  "defense",
]);

// ── Pace ────────────────────────────────────────────────────────────────────

export interface NppPrivatizationPace {
  band: "dualTrack" | "market";
  intervalTurns: number;
  maxSectors: number;
  carveFraction: number;
}

/**
 * Pace for a country at `level`, or null when it must not privatize: not a
 * scheduled (planned or formerly planned) country, or still fully command.
 */
export function privatizationPaceForLevel(
  level: number,
  hasMarketizationSchedule: boolean
): NppPrivatizationPace | null {
  if (!hasMarketizationSchedule || !Number.isFinite(level)) return null;
  if (level < COMMAND_CEILING) return null;
  if (level >= DUAL_TRACK_CEILING) {
    return {
      band: "market",
      intervalTurns: NPP_PRIVATIZATION_MARKET.intervalTurns,
      maxSectors: NPP_PRIVATIZATION_MARKET.sectors,
      carveFraction: clampCarve(NPP_PRIVATIZATION_MARKET.carveFraction),
    };
  }
  const t = Math.min(
    1,
    Math.max(0, (level - COMMAND_CEILING) / (DUAL_TRACK_CEILING - COMMAND_CEILING))
  );
  const d = NPP_PRIVATIZATION_DUAL_TRACK;
  return {
    band: "dualTrack",
    intervalTurns: d.intervalTurns,
    // Reaches maxSectors only at the top of the band.
    maxSectors: Math.min(
      d.maxSectors,
      d.minSectors + Math.floor(t * (d.maxSectors - d.minSectors + 1))
    ),
    carveFraction: clampCarve(d.minCarveFraction + t * (d.maxCarveFraction - d.minCarveFraction)),
  };
}

function clampCarve(f: number): number {
  return Math.round(Math.min(CARVE_FRACTION_MAX, Math.max(CARVE_FRACTION_MIN, f)) * 1000) / 1000;
}

// ── Selection ───────────────────────────────────────────────────────────────

export interface PrivatizationCandidateSector {
  id: string;
  corporationId: string;
  sectorType: CorporationType;
  /** Nameplate daily revenue; a sector earning nothing is not worth floating. */
  revenue: number;
  /** Booked daily profit and realized revenue from the plants P&L, when present. */
  plantsProfit?: number | null;
  plantsRevenue?: number | null;
  /** Percent margin (e.g. 12 = 12%), the fallback profitability signal. */
  effectiveProfitMargin?: number | null;
  absorbedAtTurn?: number | null;
  /** True when secured construction property blocks a carve. */
  constructionLocked?: boolean;
}

export interface NppPrivatizationInput {
  level: number;
  hasMarketizationSchedule: boolean;
  currentTurn: number;
  /** Active (non-terminal) NPP-sponsored privatize bills in this country. */
  activeNppPrivatizeBills: number;
  /** Proposal turn of the latest NPP-sponsored privatize bill, if any. */
  lastNppPrivatizeTurn: number | null;
  /** Sector ids named in any recent privatize bill in this country. */
  recentlyProposedSectorIds: ReadonlySet<string>;
  /** Operating sectors held by this country's National Corporations. */
  sectors: readonly PrivatizationCandidateSector[];
  /** Sector types designated strategic in this country. */
  strategicSectorTypes: ReadonlySet<string>;
}

export interface NppPrivatizationProvisionPlan {
  sourceCorporationId: string;
  sectorType: CorporationType;
  strategic: boolean;
  goldenSharePercent: number;
  selections: { sectorId: string; carveFraction: number }[];
}

export type NppPrivatizationPlan =
  | {
      ok: true;
      pace: NppPrivatizationPace;
      provisions: NppPrivatizationProvisionPlan[];
    }
  | {
      ok: false;
      reason: "not_eligible" | "active_bill" | "interval" | "no_candidates";
    };

/**
 * Profit margin as a fraction: the booked plants P&L when it exists, else the
 * percent margin. Unknown profitability ranks as break-even.
 */
export function sectorMarginFraction(s: PrivatizationCandidateSector): number {
  if (
    typeof s.plantsProfit === "number" &&
    Number.isFinite(s.plantsProfit) &&
    typeof s.plantsRevenue === "number" &&
    s.plantsRevenue > 0
  ) {
    return s.plantsProfit / s.plantsRevenue;
  }
  if (typeof s.effectiveProfitMargin === "number" && Number.isFinite(s.effectiveProfitMargin)) {
    return s.effectiveProfitMargin / 100;
  }
  return 0;
}

/** Is this sector eligible to be put up for sale this turn? */
export function isPrivatizationCandidate(
  s: PrivatizationCandidateSector,
  currentTurn: number,
  recentlyProposed: ReadonlySet<string>
): boolean {
  if (NPP_PRIVATIZATION_EXCLUDED_SECTOR_TYPES.has(s.sectorType)) return false;
  if (!(s.revenue > 0) || !Number.isFinite(s.revenue)) return false;
  if (s.constructionLocked) return false;
  if (recentlyProposed.has(s.id)) return false;
  if (s.absorbedAtTurn != null && currentTurn - s.absorbedAtTurn < REPRIVATIZE_COOLDOWN_TURNS) {
    return false;
  }
  return true;
}

export type NppPrivatizationGateInput = Pick<
  NppPrivatizationInput,
  | "level"
  | "hasMarketizationSchedule"
  | "currentTurn"
  | "activeNppPrivatizeBills"
  | "lastNppPrivatizeTurn"
>;

/**
 * Country-level gate, checked before any sector is loaded: eligible band, at
 * most one active NPP privatization bill, and the band's cadence elapsed.
 */
export function nppPrivatizationGate(
  input: NppPrivatizationGateInput
):
  | { ok: true; pace: NppPrivatizationPace }
  | { ok: false; reason: "not_eligible" | "active_bill" | "interval" } {
  const pace = privatizationPaceForLevel(input.level, input.hasMarketizationSchedule);
  if (!pace) return { ok: false, reason: "not_eligible" };
  if (input.activeNppPrivatizeBills > 0) return { ok: false, reason: "active_bill" };
  if (
    input.lastNppPrivatizeTurn != null &&
    input.currentTurn - input.lastNppPrivatizeTurn < pace.intervalTurns
  ) {
    return { ok: false, reason: "interval" };
  }
  return { ok: true, pace };
}

/**
 * Decide whether to sponsor a privatization bill and which sectors it carries.
 * Order: non-strategic before strategic, then loss-makers and thin margins
 * first, then larger holdings, then id for a stable replay. Selected sectors
 * are grouped into one provision (one new corporation) per source corporation
 * and sector type.
 */
export function planNppPrivatization(input: NppPrivatizationInput): NppPrivatizationPlan {
  const gate = nppPrivatizationGate(input);
  if (!gate.ok) return gate;
  const { pace } = gate;

  const ranked = input.sectors
    .filter((s) => isPrivatizationCandidate(s, input.currentTurn, input.recentlyProposedSectorIds))
    .map((s) => ({
      s,
      strategic: input.strategicSectorTypes.has(s.sectorType),
      margin: sectorMarginFraction(s),
    }))
    .sort((a, b) => {
      if (a.strategic !== b.strategic) return a.strategic ? 1 : -1;
      if (a.margin !== b.margin) return a.margin - b.margin;
      if (a.s.revenue !== b.s.revenue) return b.s.revenue - a.s.revenue;
      return a.s.id < b.s.id ? -1 : a.s.id > b.s.id ? 1 : 0;
    })
    .slice(0, pace.maxSectors);
  if (ranked.length === 0) return { ok: false, reason: "no_candidates" };

  const groups = new Map<string, NppPrivatizationProvisionPlan>();
  for (const { s, strategic } of ranked) {
    const key = `${s.corporationId}:${s.sectorType}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        sourceCorporationId: s.corporationId,
        sectorType: s.sectorType,
        strategic,
        goldenSharePercent: strategic ? NPP_PRIVATIZATION_STRATEGIC_GOLDEN_SHARE : 0,
        selections: [],
      };
      groups.set(key, group);
    }
    group.selections.push({ sectorId: s.id, carveFraction: pace.carveFraction });
  }
  return { ok: true, pace, provisions: [...groups.values()] };
}
