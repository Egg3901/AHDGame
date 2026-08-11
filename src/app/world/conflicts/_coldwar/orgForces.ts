/**
 * Shared force-commitment math for the alliance pages — International
 * Organizations (West, NATO/Warsaw tabs) and Warsaw Pact Command (East).
 * Pure + unit-tested; the boards layer their own chrome on top.
 */

export type Member = {
  flag: string;
  name: string;
  short: string;
  troops: number;
  commit: number;
  div: number;
  air: number;
  tanks: number;
  ships: number;
  warheads: number;
  you?: boolean;
  status?: string;
  year?: number;
  pct?: number;
};

export const UPKEEP_RATE = 0.085;
export const COH_PER_DELTA = 0.26;
export const PC_REGEN = 6;
export const PC_MAX = 80;

export function fmtTroops(k: number): string {
  return k >= 1000 ? (k / 1000).toFixed(k >= 10000 ? 0 : 1) + "M" : Math.round(k) + "K";
}
export function fmtN(n: number): string {
  return n >= 1000 ? n.toLocaleString() : String(n);
}
/** Color for a member's commitment %: green committed → red holdout. */
export function commitColor(p: number): string {
  return p >= 80 ? "#86d978" : p >= 50 ? "#eab308" : p > 0 ? "#ff7849" : "#7a4a4a";
}
/** Alliance cohesion as the viewer commits above / withholds below baseline. */
export function cohesionFrom(base: number, delta: number): number {
  return Math.max(0, Math.min(100, Math.round(base + delta * COH_PER_DELTA)));
}
export function cohColor(coh: number): string {
  return coh >= 70 ? "#86d978" : coh >= 45 ? "#eab308" : "#ff5a3c";
}
/** PC cost of an order: cheap to reinforce, dear to withhold; HoG pays 1.4×. */
export function pcCostFor(delta: number, isHoG: boolean): number {
  let c = 0;
  if (delta > 0) c = Math.round(3 + delta * 0.2);
  else if (delta < 0) c = Math.round(5 + -delta * 0.5);
  if (isHoG && c > 0) c = Math.round(c * 1.4);
  return c;
}
export function upkeepFor(curK: number): number {
  return curK * UPKEEP_RATE;
}

export type CombatPower = { rawCP: number; effCP: number; cohFactor: number; totalCommK: number };

/** Joint combat power: committed personnel + equipment, scaled by cohesion. */
export function combatPower(
  members: Member[],
  getCommit: (m: Member) => number,
  coh: number
): CombatPower {
  const equipCP = members.reduce((a, b) => a + b.tanks / 15 + b.air / 3, 0);
  const totalCommK = members.reduce((a, b) => a + (b.troops * getCommit(b)) / 100, 0);
  const rawCP = Math.round(totalCommK + equipCP);
  const cohFactor = 0.6 + (coh / 100) * 0.4;
  return { rawCP, effCP: Math.round(rawCP * cohFactor), cohFactor, totalCommK };
}

export type CompositionSlice = { short: string; flag: string; pctNum: number; committedK: number };

/** Members sorted by committed personnel desc, with each one's share of the total. */
export function composition(
  members: Member[],
  getCommit: (m: Member) => number
): CompositionSlice[] {
  const withK = members.map((m) => ({
    short: m.short,
    flag: m.flag,
    committedK: (m.troops * getCommit(m)) / 100,
  }));
  const total = withK.reduce((a, b) => a + b.committedK, 0);
  return withK
    .slice()
    .sort((a, b) => b.committedK - a.committedK)
    .map((m) => ({ ...m, pctNum: total ? (m.committedK / total) * 100 : 0 }));
}

/** Accent shade for the i-th composition slice (darkest = least committed). */
export function shadeOf(accent: string, i: number, n: number, floor: string): string {
  const alpha = 0.45 + 0.55 * (1 - i / Math.max(1, n - 1));
  return `color-mix(in srgb, ${accent} ${Math.round(alpha * 100)}%, ${floor})`;
}

export type AggRow = { label: string; value: string; sub: string };

/** The six-up force aggregate cards. */
export function aggregates(members: Member[], getCommit: (m: Member) => number): AggRow[] {
  const totalCommK = members.reduce((a, b) => a + (b.troops * getCommit(b)) / 100, 0);
  return [
    { label: "COMMITTED", value: fmtTroops(Math.round(totalCommK)), sub: "to joint command" },
    { label: "DIVISIONS", value: String(members.reduce((a, b) => a + b.div, 0)), sub: "ground" },
    { label: "AIRCRAFT", value: fmtN(members.reduce((a, b) => a + b.air, 0)), sub: "combat" },
    { label: "TANKS", value: fmtN(members.reduce((a, b) => a + b.tanks, 0)), sub: "MBT" },
    { label: "WARSHIPS", value: String(members.reduce((a, b) => a + b.ships, 0)), sub: "surface" },
    { label: "WARHEADS", value: fmtN(members.reduce((a, b) => a + b.warheads, 0)), sub: "nuclear" },
  ];
}

export type ConseqKind = "up" | "down" | "hold";
/** Direction of the pending commitment change (drives the consequence note color). */
export function conseqKind(delta: number): ConseqKind {
  return delta > 0 ? "up" : delta < 0 ? "down" : "hold";
}
