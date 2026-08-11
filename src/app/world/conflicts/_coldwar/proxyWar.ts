/**
 * Proxy-war model + helpers, shared by Conflicts (West) and Conflicts (East).
 * Pure functions over an explicit `ProxyState`, parameterized by `side` (the
 * bloc the player commands). Ported verbatim from the design; static-faithful.
 */

export type Side = "west" | "east";
export type Sev = "HIGH" | "MEDIUM";

export type Conflict = {
  name: string;
  file: string;
  theater: string;
  started: string;
  sev: Sev;
  superpower: boolean;
  west: { faction: string; flags: string; cp: number };
  east: { faction: string; flags: string; cp: number };
};

export type SupplyLine = { w: number; e: number; wNote: string; eNote: string };

/** Player-adjustable state: per-theater committed CP, per-theater logistics CP, bloc cohesion. */
export type ProxyState = {
  commit: Record<string, number>;
  logi: Record<string, number>;
  cohesion: number;
};

export const SIDE_CONFIG: Record<
  Side,
  {
    total: number;
    cohesionKey: string;
    /** Control % at/above which a superpower theater shows the escalation warning. */
    escalateAt: number;
    /** Control % at/above which committing to a superpower theater drops readiness to DEFCON 2. */
    defcon2At: number;
    jointCommand: string;
    blocLabel: string;
    intro: string;
    escalateText: string;
    /** Title-case direction word for projections, e.g. "West" / "East". */
    pushDir: string;
  }
> = {
  west: {
    total: 6800,
    cohesionKey: "ahd_west_cohesion",
    escalateAt: 45,
    defcon2At: 50,
    jointCommand: "Military Forces",
    blocLabel: "WESTERN",
    intro:
      "Back a side with your bloc's combat power. What you commit to each theater decides the front line — and how far the superpowers are willing to escalate.",
    escalateText:
      "Pushing the Soviets in a theater they hold directly risks raising global readiness toward DEFCON 2.",
    pushDir: "West",
  },
  east: {
    total: 6400,
    cohesionKey: "ahd_east_cohesion",
    escalateAt: 55,
    defcon2At: 60,
    jointCommand: "Warsaw Pact Command",
    blocLabel: "EASTERN",
    intro:
      "Back the progressive forces with the socialist camp's combat power. What you commit to each theater decides the front line — and how far the superpowers are willing to escalate.",
    escalateText:
      "Pressing your advantage in a theater the Americans contest directly risks raising global readiness toward DEFCON 2.",
    pushDir: "East",
  },
};

export const CONFLICTS: Record<string, Conflict> = {
  afg: {
    name: "Soviet–Afghan War",
    file: "C-079-04",
    theater: "Central Asia",
    started: "24 Dec 1979",
    sev: "HIGH",
    superpower: true,
    west: { faction: "Mujahideen", flags: "🇺🇸🇵🇰", cp: 1200 },
    east: { faction: "DRA + 40th Army", flags: "🚩", cp: 3400 },
  },
  nic: {
    name: "Nicaraguan Revolution",
    file: "C-079-07",
    theater: "Central America",
    started: "Jul 1979",
    sev: "MEDIUM",
    superpower: false,
    west: { faction: "Contras", flags: "🇺🇸", cp: 800 },
    east: { faction: "FSLN Junta", flags: "🇨🇺", cp: 950 },
  },
  ago: {
    name: "Angolan Civil War",
    file: "C-075-02",
    theater: "Southern Africa",
    started: "1975",
    sev: "MEDIUM",
    superpower: false,
    west: { faction: "UNITA", flags: "🇿🇦", cp: 1100 },
    east: { faction: "MPLA", flags: "🇨🇺", cp: 1500 },
  },
  horn: {
    name: "Ogaden Conflict",
    file: "C-077-09",
    theater: "Horn of Africa",
    started: "1977",
    sev: "MEDIUM",
    superpower: false,
    west: { faction: "Somalia", flags: "🇸🇴", cp: 700 },
    east: { faction: "Ethiopia", flags: "🇪🇹🇨🇺", cp: 1300 },
  },
};

export const ORDER = ["afg", "nic", "ago", "horn"];

export const SUPPLY: Record<string, SupplyLine> = {
  afg: {
    w: 45,
    e: 95,
    wNote: "covert pipeline via Pakistan, contested passes",
    eNote: "direct land border with the USSR",
  },
  nic: { w: 90, e: 55, wNote: "US backyard, open sea lanes", eNote: "long Cuban sea-lift" },
  ago: {
    w: 60,
    e: 72,
    wNote: "staged through South Africa",
    eNote: "Cuban sealift + Soviet airlift",
  },
  horn: { w: 55, e: 78, wNote: "limited Red Sea access", eNote: "Soviet/Cuban airbridge to Addis" },
};

const other = (s: Side): Side => (s === "west" ? "east" : "west");
const supplyBase = (id: string, s: Side): number => (s === "west" ? SUPPLY[id].w : SUPPLY[id].e);

/** Cohesion (0–100) scales joint-command supply between ×0.55 and ×1.00. */
export function supplyMult(cohesion: number): number {
  return 0.55 + (cohesion / 100) * 0.45;
}

/** The player side's committed CP for a theater (override, else baseline). */
export function playerCP(commit: Record<string, number>, id: string, side: Side): number {
  const o = commit[id];
  return o != null ? o : CONFLICTS[id][side].cp;
}

export function logiCP(logi: Record<string, number>, id: string): number {
  return logi[id] || 0;
}

/** Player supply % for a theater: base × cohesion, +8% per 200 CP logistics, capped at 85. */
export function playerSupply(state: ProxyState, id: string, side: Side): number {
  return Math.min(
    85,
    Math.round(supplyBase(id, side) * supplyMult(state.cohesion)) +
      Math.floor(logiCP(state.logi, id) / 200) * 8
  );
}

/** Uncommitted player CP: bloc total minus all committed + logistics CP. */
export function reserve(state: ProxyState, side: Side): number {
  let used = 0;
  for (const id of ORDER) used += playerCP(state.commit, id, side) + logiCP(state.logi, id);
  return SIDE_CONFIG[side].total - used;
}

/** Player front-line control %: effective player CP / total effective CP. */
export function control(state: ProxyState, id: string, side: Side): number {
  const opp = other(side);
  const p = (playerCP(state.commit, id, side) * playerSupply(state, id, side)) / 100;
  const o = (CONFLICTS[id][opp].cp * supplyBase(id, opp)) / 100;
  return Math.round((p / (p + o)) * 100);
}

export function sevStyle(s: Sev): { c: string; bg: string } {
  return s === "HIGH"
    ? { c: "#ef8a8a", bg: "rgba(239,68,68,.14)" }
    : { c: "#eab308", bg: "rgba(234,179,8,.12)" };
}

const PLAYER_ADV: Record<Side, { color: string; bg: string; border: string }> = {
  west: { color: "#9cc0f5", bg: "rgba(59,130,246,.1)", border: "rgba(59,130,246,.3)" },
  east: { color: "#f0a0a0", bg: "rgba(220,38,38,.1)", border: "rgba(220,38,38,.3)" },
};
const OPP_ADV: Record<Side, { color: string; bg: string; border: string }> = {
  west: { color: "#f0a0a0", bg: "rgba(220,38,38,.08)", border: "rgba(220,38,38,.3)" },
  east: { color: "#9cc0f5", bg: "rgba(59,130,246,.08)", border: "rgba(59,130,246,.3)" },
};
// "Western" as the player, but "West" as the opponent (the design's copy);
// East is "East" in both roles.
const PLAYER_NAME: Record<Side, string> = { west: "Western", east: "East" };
const OPP_NAME: Record<Side, string> = { west: "West", east: "East" };

/** Control % → outcome band, labelled/colored from the player side's perspective. */
export function outcome(
  p: number,
  side: Side
): { label: string; color: string; bg: string; border: string } {
  const opp = other(side);
  if (p >= 66)
    return {
      label: `${PLAYER_NAME[side]}-backed victory likely`,
      color: "#86d978",
      bg: "rgba(134,217,120,.1)",
      border: "rgba(134,217,120,.3)",
    };
  if (p >= 55) return { label: `${PLAYER_NAME[side]}-backed advantage`, ...PLAYER_ADV[side] };
  if (p > 45)
    return {
      label: "Contested stalemate",
      color: "#d9bd6b",
      bg: "rgba(212,175,55,.1)",
      border: "rgba(212,175,55,.3)",
    };
  if (p > 34) return { label: `${OPP_NAME[opp]}-backed advantage`, ...OPP_ADV[side] };
  return {
    label: `${OPP_NAME[opp]}-backed victory likely`,
    color: "#ff5a3c",
    bg: "rgba(255,90,60,.1)",
    border: "rgba(255,90,60,.3)",
  };
}
