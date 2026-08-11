import type { Side } from "./proxyWar";

export type Outcome = "victory" | "war" | "climbdown";
export type CrisisKind = "escalate" | "hold" | "channel" | "standdown";

/** The numeric crisis state the pure reducer transforms. */
export type CrisisCore = {
  rung: number;
  nerve: number;
  pc: number;
  defcon: number;
  cred: number;
};

export type StepResult = {
  rung: number;
  nerve: number;
  pc: number;
  defcon: number;
  outcome: Outcome | null;
  /** True when the move was rejected (back-channel with < 10 capital). */
  blocked: boolean;
};

export const RUNG_START = 3;
export const NERVE_START = 68;
export const PC_START = 60;
export const CRED_START = 72;
export const CHANNEL_COST = 10;
export const WAR_NERVE = 38;

/** Credibility multiplier — a divided bloc (low cohesion) lands weaker threats. */
export function credMult(cred: number): number {
  return 0.5 + cred / 100;
}

/**
 * Pure crisis reducer — the whole brinkmanship mechanic, identical on both
 * sides (only the surrounding copy/palette differs). Returns the next numeric
 * state + any terminal outcome; never mutates `core`.
 */
export function step(core: CrisisCore, kind: CrisisKind): StepResult {
  const cf = credMult(core.cred);
  let { rung, nerve, pc, defcon } = core;
  let outcome: Outcome | null = null;

  if (kind === "escalate") {
    rung = Math.min(5, rung + 1);
    defcon = Math.max(1, defcon - 1);
    nerve -= Math.round(15 * cf);
    // War check runs on the pre-clamp nerve: at the nuclear rung, if their
    // nerve still holds above the threshold, neither side blinks.
    if (rung >= 5 && nerve > WAR_NERVE) outcome = "war";
  } else if (kind === "hold") {
    nerve -= Math.round(7 * cf);
  } else if (kind === "channel") {
    if (pc < CHANNEL_COST) {
      return { rung, nerve, pc, defcon, outcome: null, blocked: true };
    }
    pc -= CHANNEL_COST;
    nerve -= 12;
    if (rung > 3) rung -= 1;
    if (defcon < 5) defcon = Math.min(5, defcon + 1);
  } else if (kind === "standdown") {
    rung = Math.max(0, rung - 1);
    if (defcon < 5) defcon = Math.min(5, defcon + 1);
    nerve += 14;
    if (rung <= 0) outcome = "climbdown";
  }

  nerve = Math.max(0, Math.min(100, nerve));
  if (!outcome && nerve <= 0) {
    outcome = "victory";
    if (defcon < 5) defcon = Math.min(5, defcon + 1);
  }

  return { rung, nerve, pc, defcon, outcome, blocked: false };
}

// ── shared presentational helpers ──────────────────────────────────────────────
export function crisisDefconColor(d: number): string {
  if (d <= 1) return "#ff3b3b";
  if (d <= 2) return "#ff5a3c";
  if (d >= 5) return "#86d978";
  return "#ff7849";
}
export function crisisDefconNote(d: number): string {
  if (d <= 1) return "COCKED PISTOL";
  if (d <= 2) return "superpower brink";
  if (d >= 5) return "fade out";
  return "heightened";
}
export function pcColor(pc: number): string {
  return pc < 15 ? "#ff5a3c" : pc < 30 ? "#eab308" : "#f3f1ea";
}
export function nerveColor(nerve: number, defiant: string): string {
  return nerve < 35 ? "#86d978" : nerve < 60 ? "#eab308" : defiant;
}
export function credColor(cred: number): string {
  return cred >= 70 ? "#86d978" : cred >= 50 ? "#eab308" : "#ff5a3c";
}

// ── per-side data + copy + chrome ──────────────────────────────────────────────
export type CrisisConfig = {
  pcKey: string;
  cohesionKey: string;
  intro: string;
  pcLabel: string;
  pcSubColor: string;
  /** Lowercase capital noun for the low-reserve message. */
  capitalWord: string;
  rungs: [string, string, string, string, string];
  // identity / accents
  selfName: string;
  selfColor: string;
  oppName: string;
  oppColor: string;
  nerveLabel: string;
  nerveBar: string;
  nerveDefiant: string;
  nerveLowNote: string;
  credLabel: string;
  credLabelColor: string;
  credBar: string;
  credTrackBorder: string;
  credNotes: [string, string, string];
  effHoldColor: string;
  // action wording
  nerveWord: string;
  escalateLever: string;
  standdownObject: string;
  /** Stand-down log sentence, e.g. "The quarantine lifts." */
  standdownLift: string;
  escalateWaverBody: string;
  // log actors
  channelLowActor: string;
  restartActor: string;
  restartColor: string;
  restartText: string;
  emptyWire: string;
  logLabel: string;
  logLabelColor: string;
  // outcomes (icon/colors shared; title + sub per side)
  outcomes: Record<Outcome, { title: string; sub: string }>;
  // chrome
  pageBg: string;
  cardBg: string;
  cardBorder: string;
  stripBg: string;
  stripBorder: string;
  stripLeftText: string;
  stripRightColor: string;
  pcPanelBorder: string;
  pcPanelBg: string;
  pcLabelColor: string;
  ladderBorder: string;
  ladderBg: string;
  ladderLabelColor: string;
  ladderIdleBorder: string;
  ladderIdleText: string;
  ladderFootColor: string;
  panelBorder: string;
  panelBg: string;
  actionsBg: string;
  transBorder: string;
  transBg: string;
  transDashTop: string;
  transRowDash: string;
  transText: string;
  transEmpty: string;
  rerunBg: string;
  rerunBorder: string;
};

export const CRISIS: Record<Side, CrisisConfig> = {
  west: {
    pcKey: "ahd_west_pc",
    cohesionKey: "ahd_west_cohesion",
    intro:
      "Reconnaissance has confirmed a Soviet combat brigade in Cuba. Moscow denies it is offensive. The world is watching to see who blinks — and your threats carry only as much weight as the alliance behind them.",
    pcLabel: "POLITICAL CAPITAL",
    pcSubColor: "#7a7a8c",
    capitalWord: "political capital",
    rungs: [
      "Diplomatic protest",
      "Show of force",
      "Naval quarantine",
      "Full mobilization",
      "Nuclear alert · DEFCON 1",
    ],
    selfName: "WASHINGTON",
    selfColor: "#6fa8dc",
    oppName: "MOSCOW",
    oppColor: "#ef8a8a",
    nerveLabel: "☭ SOVIET NERVE",
    nerveBar: "linear-gradient(90deg,#991b1b,#dc2626)",
    nerveDefiant: "#ef8a8a",
    nerveLowNote: "the Politburo is losing its nerve — one more push",
    credLabel: "▮ ALLIANCE CREDIBILITY",
    credLabelColor: "#7ba3ec",
    credBar: "linear-gradient(90deg,#1d4ed8,#3b82f6)",
    credTrackBorder: "#23232f",
    credNotes: [
      "a united alliance — your threats are believed",
      "cohesion fraying — your bluff lands softer",
      "a divided bloc — Moscow doubts you will follow through",
    ],
    effHoldColor: "#9cc0f5",
    nerveWord: "Soviet",
    escalateLever: "DEFCON",
    standdownObject: "quarantine",
    standdownLift: "The quarantine lifts.",
    escalateWaverBody: "the Politburo is split",
    channelLowActor: "STATE DEPT",
    restartActor: "NMCC",
    restartColor: "#ffc14d",
    restartText: "crisis clock reset — Soviet brigade confirmed in Cuba once more.",
    emptyWire: "— Moscow awaits your response —",
    logLabel: "▌SITUATION ROOM LOG",
    logLabelColor: "#ffc14d",
    outcomes: {
      victory: {
        title: "Moscow Blinks",
        sub: "The brigade is reclassified and quietly withdrawn. Western prestige soars; readiness stands down.",
      },
      war: {
        title: "The Balloon Goes Up",
        sub: "Neither side blinked at the nuclear rung. DEFCON 1 — this is the failure state the whole game is built to avoid.",
      },
      climbdown: {
        title: "Washington Backs Down",
        sub: "The quarantine is lifted with nothing to show. Moscow is emboldened; swing states read the retreat.",
      },
    },
    pageBg: "radial-gradient(120% 80% at 50% 0%,#1d1518,#0b0b11 60%)",
    cardBg: "#14141c",
    cardBorder: "#3a2420",
    stripBg: "repeating-linear-gradient(45deg,#231410,#231410 10px,#1d1009 10px,#1d1009 20px)",
    stripBorder: "#3a2416",
    stripLeftText: "◆ FLASH · CRITIC — NATIONAL COMMAND AUTHORITY ONLY",
    stripRightColor: "#8a6a52",
    pcPanelBorder: "#2a2a3d",
    pcPanelBg: "#1d1d2a",
    pcLabelColor: "#6b6b7a",
    ladderBorder: "#2a2a3d",
    ladderBg: "#11111a",
    ladderLabelColor: "#6b6b7a",
    ladderIdleBorder: "#2a2a3d",
    ladderIdleText: "#6b6b7a",
    ladderFootColor: "#6b6b7a",
    panelBorder: "#2a2a3d",
    panelBg: "#11111a",
    actionsBg: "#16161f",
    transBorder: "#2a2416",
    transBg: "#0a0906",
    transDashTop: "#4a3f1e",
    transRowDash: "#211c0e",
    transText: "#d9aa55",
    transEmpty: "#5a4f30",
    rerunBg: "#1d1d2a",
    rerunBorder: "#2a2a3d",
  },
  east: {
    pcKey: "ahd_east_pc",
    cohesionKey: "ahd_east_cohesion",
    intro:
      'The Americans have "discovered" a combat brigade that has sat in Cuba for years. Washington is making it a test of will. Hold your nerve — but your threats carry only as much weight as the socialist camp standing behind them.',
    pcLabel: "PARTY CAPITAL",
    pcSubColor: "#7a6a72",
    capitalWord: "Party capital",
    rungs: [
      "Diplomatic note",
      "Show of force",
      "Naval readiness",
      "Full mobilization",
      "Nuclear alert · DEFCON 1",
    ],
    selfName: "STAVKA",
    selfColor: "#ef8a8a",
    oppName: "WASHINGTON",
    oppColor: "#6fa8dc",
    nerveLabel: "🦅 AMERICAN NERVE",
    nerveBar: "linear-gradient(90deg,#1d4ed8,#3b82f6)",
    nerveDefiant: "#7ba3ec",
    nerveLowNote: "Congress is losing its nerve — one more push",
    credLabel: "▮ SOCIALIST CAMP CREDIBILITY",
    credLabelColor: "#ef8a8a",
    credBar: "linear-gradient(90deg,#991b1b,#dc2626)",
    credTrackBorder: "#2a1620",
    credNotes: [
      "a united socialist camp — your threats are believed",
      "camp cohesion fraying — your bluff lands softer",
      "a divided camp — Washington doubts you will follow through",
    ],
    effHoldColor: "#f0a0a0",
    nerveWord: "American",
    escalateLever: "readiness",
    standdownObject: "alert",
    standdownLift: "The alert is lifted.",
    escalateWaverBody: "Congress is split",
    channelLowActor: "MID",
    restartActor: "STAVKA",
    restartColor: "#ff7849",
    restartText: "crisis clock reset — the Americans renew their demands over the Cuban brigade.",
    emptyWire: "— Washington awaits your response —",
    logLabel: "▌STAVKA SITUATION LOG",
    logLabelColor: "#ff7849",
    outcomes: {
      victory: {
        title: "Washington Blinks",
        sub: 'The Americans quietly accept the brigade as a "training unit." Soviet prestige soars across the Third World; readiness stands down.',
      },
      war: {
        title: "The Balloon Goes Up",
        sub: "Neither side blinked at the nuclear rung. DEFCON 1 — this is the failure state the whole game is built to avoid.",
      },
      climbdown: {
        title: "Moscow Backs Down",
        sub: "The alert is lifted with nothing gained. Washington is emboldened; the fraternal states note the retreat.",
      },
    },
    pageBg: "radial-gradient(120% 80% at 50% 0%,#1d1316,#0b0b11 60%)",
    cardBg: "#14111a",
    cardBorder: "#3a2030",
    stripBg: "repeating-linear-gradient(45deg,#2a1410,#2a1410 10px,#220f0a 10px,#220f0a 20px)",
    stripBorder: "#3a2416",
    stripLeftText: "☭ ВНЕ ОЧЕРЕДИ · STAVKA — SUPREME COMMAND ONLY",
    stripRightColor: "#8a6a52",
    pcPanelBorder: "#3a2030",
    pcPanelBg: "#1a0f14",
    pcLabelColor: "#8a5a66",
    ladderBorder: "#3a2030",
    ladderBg: "#1a0f14",
    ladderLabelColor: "#8a5a66",
    ladderIdleBorder: "#3a2030",
    ladderIdleText: "#8a5a66",
    ladderFootColor: "#8a5a66",
    panelBorder: "#3a2030",
    panelBg: "#1a0f14",
    actionsBg: "#16121a",
    transBorder: "#2a1620",
    transBg: "#0a0608",
    transDashTop: "#4a2630",
    transRowDash: "#1c1014",
    transText: "#cf9aa2",
    transEmpty: "#5a3038",
    rerunBg: "#1a0f14",
    rerunBorder: "#3a2030",
  },
};
