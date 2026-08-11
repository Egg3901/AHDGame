import type { Side } from "./proxyWar";

/** A concession the player can table — builds trust, costs political/Party capital. */
export type Concession = {
  id: string;
  name: string;
  tag: string;
  detail: string;
  trust: number;
  cost: number;
  major: boolean;
};

/** The other superpower's gated reaction as goodwill climbs. */
export type Response = { gate: number; icon: string; text: string };

// ── pure mechanic (shared by both sides; unit-tested) ──────────────────────────
export const GW_START = 10;
export const PC_START = 60;
export const STAND_GOODWILL = 55;
export const STAND_COST = 15;
export const STAND_DROP = 40;
export const LOG_MAX = 5;

export type Posture = { label: string; color: string };

export function posture(gw: number): Posture {
  if (gw < 25) return { label: "BELLIGERENT", color: "#ef8a8a" };
  if (gw < 50) return { label: "GUARDED", color: "#d9bd6b" };
  if (gw < 72) return { label: "RECEPTIVE", color: "#9cc0f5" };
  return { label: "CONCILIATORY", color: "#86d978" };
}

export function goodwillAfterTable(gw: number, trust: number): number {
  return Math.min(100, gw + trust);
}
export function goodwillAfterStand(gw: number): number {
  return Math.max(0, gw - STAND_DROP);
}
export function canStandDown(gw: number, defcon: number, pc: number): boolean {
  return gw >= STAND_GOODWILL && defcon < 5 && pc >= STAND_COST;
}
export function nextDefcon(defcon: number): number {
  return Math.min(5, defcon + 1);
}
export function defconMeta(d: number): { color: string; note: string } {
  if (d <= 2) return { color: "#ff5a3c", note: "superpower brink" };
  if (d >= 5) return { color: "#86d978", note: "fade out" };
  return { color: "#ff7849", note: "heightened" };
}
export function pcColor(pc: number): string {
  return pc < 15 ? "#ff5a3c" : pc < 30 ? "#eab308" : "#f3f1ea";
}

// ── per-side data + copy + chrome ──────────────────────────────────────────────
export type DetenteConfig = {
  pcKey: string;
  intro: string;
  pcLabel: string;
  /** Lowercase currency name for messages, e.g. "political capital". */
  pcCurrency: string;
  pcSubColor: string;
  postureLabel: string;
  respLabel: string;
  respLabelColor: string;
  respBorder: string;
  respBg: string;
  /** Color of a reciprocated (revealed) response line. */
  respRevColor: string;
  appeaseText: string;
  /** The player's own delegation (transcript author when tabling). */
  self: { name: string; color: string };
  /** The other superpower (transcript author on stand-down). */
  other: { name: string; color: string };
  concLabelColor: string;
  concBorder: string;
  concBg: string;
  concSubColor: string;
  tagBg: string;
  tagColor: string;
  trustOkColor: string;
  standReciprocator: string;
  standGateNote: string;
  standPcNote: string;
  // chrome
  pageBg: string;
  cardBg: string;
  cardBorder: string;
  stripBg: string;
  stripBorder: string;
  stripLeftColor: string;
  stripLeftText: string;
  stripRightColor: string;
  stripRightText: string;
  headerLabelColor: string;
  progBorder: string;
  progBg: string;
  progMuted: string;
  progTrackBorder: string;
  pcPanelBorder: string;
  pcPanelBg: string;
  pcLabelColor: string;
  resetBg: string;
  resetBorder: string;
  transBorder: string;
  transBg: string;
  transDashTop: string;
  transRowDash: string;
  transLabelColor: string;
  transText: string;
  transEmpty: string;
  standOffBg: string;
  standOffBorder: string;
  standBoxOffBorder: string;
  standBoxOffBg: string;
  concessions: Concession[];
  responses: Response[];
};

export const DETENTE: Record<Side, DetenteConfig> = {
  west: {
    pcKey: "ahd_west_pc",
    intro:
      "Step back from the brink. Table concessions to build trust with Moscow — enough goodwill, and both sides will stand down a level of readiness. Concede too much, though, and it reads as weakness at home.",
    pcLabel: "POLITICAL CAPITAL",
    pcCurrency: "political capital",
    pcSubColor: "#6f8a5a",
    postureLabel: "SOVIET POSTURE",
    respLabel: "☭ MOSCOW RESPONDS",
    respLabelColor: "#ef8a8a",
    respBorder: "rgba(220,38,38,.3)",
    respBg: "rgba(220,38,38,.04)",
    respRevColor: "#f2dede",
    appeaseText:
      "Major concessions tabled — hawks at home call it appeasement. Watch domestic approval.",
    self: { name: "WASHINGTON", color: "#6fa8dc" },
    other: { name: "MOSCOW", color: "#ef8a8a" },
    concLabelColor: "#7ba3ec",
    concBorder: "rgba(59,130,246,.3)",
    concBg: "rgba(59,130,246,.04)",
    concSubColor: "#6b6b7a",
    tagBg: "rgba(59,130,246,.12)",
    tagColor: "#7ba3ec",
    trustOkColor: "#9cc0f5",
    standReciprocator:
      "Moscow will reciprocate. Stand down one level of readiness for 40 goodwill + 15 PC.",
    standGateNote: "Build summit goodwill to 55 before Moscow will step down.",
    standPcNote: "Not enough political capital to seal the agreement (15 PC).",
    pageBg: "radial-gradient(120% 80% at 50% 0%,#15151d,#0b0b11 60%)",
    cardBg: "#14141c",
    cardBorder: "#2a2a3d",
    stripBg: "repeating-linear-gradient(45deg,#10141a,#10141a 10px,#0d1015 10px,#0d1015 20px)",
    stripBorder: "#1c2630",
    stripLeftColor: "#6fa8dc",
    stripLeftText: "◆ SUPERPOWER SUMMIT · DIRECT NEGOTIATION",
    stripRightColor: "#566776",
    stripRightText: "GENEVA CHANNEL · WASHINGTON ⇄ MOSCOW",
    headerLabelColor: "#6b6b7a",
    progBorder: "#2a2a3d",
    progBg: "#11111a",
    progMuted: "#7a7a8c",
    progTrackBorder: "#2a2a3d",
    pcPanelBorder: "#2a2a3d",
    pcPanelBg: "#1d1d2a",
    pcLabelColor: "#6b6b7a",
    resetBg: "#14141c",
    resetBorder: "#2a2a3d",
    transBorder: "#2a2416",
    transBg: "#0a0906",
    transDashTop: "#4a3f1e",
    transRowDash: "#211c0e",
    transLabelColor: "#ffc14d",
    transText: "#d9aa55",
    transEmpty: "#5a4f30",
    standOffBg: "#16161f",
    standOffBorder: "#2a2a3d",
    standBoxOffBorder: "#2a2a3d",
    standBoxOffBg: "#11111a",
    concessions: [
      {
        id: "hotline",
        name: "Open the hotline",
        tag: "GESTURE",
        detail: "A direct teletype line to the Kremlin — cheap, reversible trust.",
        trust: 12,
        cost: 4,
        major: false,
      },
      {
        id: "culture",
        name: "Cultural & grain trade",
        tag: "GESTURE",
        detail: "Exchanges, Olympic talks, grain sales — visible goodwill.",
        trust: 10,
        cost: 5,
        major: false,
      },
      {
        id: "vienna",
        name: "Mutual force reduction",
        tag: "FORCES",
        detail: "Thin both Central European fronts (MBFR, Vienna). −home garrison.",
        trust: 18,
        cost: 8,
        major: false,
      },
      {
        id: "withdraw",
        name: "Withdraw proxy advisors",
        tag: "PROXY",
        detail: "Pull advisors from a theater — cedes ground on the Conflicts board.",
        trust: 16,
        cost: 6,
        major: false,
      },
      {
        id: "salt",
        name: "SALT II warhead ceiling",
        tag: "ARMS",
        detail: "Cap both arsenals. Big trust — but freezes your strategic edge.",
        trust: 24,
        cost: 11,
        major: true,
      },
      {
        id: "sphere",
        name: "Recognize a sphere of influence",
        tag: "MAJOR",
        detail: "Concede a swing state to Moscow. Huge trust — and huge risk.",
        trust: 30,
        cost: 14,
        major: true,
      },
    ],
    responses: [
      { gate: 25, icon: "📞", text: "Kremlin reopens the hotline; the tone in Geneva softens." },
      { gate: 40, icon: "🪖", text: "USSR proposes reciprocal troop cuts in Central Europe." },
      { gate: 55, icon: "📜", text: "Moscow tables a draft SALT II protocol for signature." },
      { gate: 72, icon: "🤝", text: "Brezhnev signals readiness for a full Vienna summit." },
    ],
  },
  east: {
    pcKey: "ahd_east_pc",
    intro:
      "Step back from the brink. Table concessions to build trust with Washington — enough goodwill, and both sides will stand down a level of readiness. Concede too much, though, and the hardliners in the Politburo call it capitulation.",
    pcLabel: "PARTY CAPITAL",
    pcCurrency: "Party capital",
    pcSubColor: "#7a6a72",
    postureLabel: "AMERICAN POSTURE",
    respLabel: "🦅 WASHINGTON RESPONDS",
    respLabelColor: "#7ba3ec",
    respBorder: "rgba(59,130,246,.3)",
    respBg: "rgba(59,130,246,.04)",
    respRevColor: "#dfe6f2",
    appeaseText:
      "Major concessions tabled — the hardliners in the Politburo call it capitulation. Watch your standing.",
    self: { name: "MOSCOW", color: "#ef8a8a" },
    other: { name: "WASHINGTON", color: "#6fa8dc" },
    concLabelColor: "#ef8a8a",
    concBorder: "rgba(220,38,38,.3)",
    concBg: "rgba(220,38,38,.04)",
    concSubColor: "#8a5a66",
    tagBg: "rgba(220,38,38,.12)",
    tagColor: "#ef8a8a",
    trustOkColor: "#f0a0a0",
    standReciprocator:
      "Washington will reciprocate. Stand down one level of readiness for 40 goodwill + 15 PC.",
    standGateNote: "Build summit goodwill to 55 before Washington will step down.",
    standPcNote: "Not enough Party capital to seal the agreement (15 PC).",
    pageBg: "radial-gradient(120% 80% at 50% 0%,#1d1316,#0b0b11 60%)",
    cardBg: "#14111a",
    cardBorder: "#3a2030",
    stripBg: "repeating-linear-gradient(45deg,#221016,#221016 10px,#1c0d12 10px,#1c0d12 20px)",
    stripBorder: "#3a1620",
    stripLeftColor: "#ef8a8a",
    stripLeftText: "☭ SUPERPOWER SUMMIT · DIRECT NEGOTIATION",
    stripRightColor: "#8a5a66",
    stripRightText: "GENEVA CHANNEL · MOSCOW ⇄ WASHINGTON",
    headerLabelColor: "#8a5a66",
    progBorder: "#3a2030",
    progBg: "#1a0f14",
    progMuted: "#7a6a72",
    progTrackBorder: "#2a1620",
    pcPanelBorder: "#3a2030",
    pcPanelBg: "#1a0f14",
    pcLabelColor: "#8a5a66",
    resetBg: "#14111a",
    resetBorder: "#3a2030",
    transBorder: "#2a1620",
    transBg: "#0a0608",
    transDashTop: "#4a2630",
    transRowDash: "#1c1014",
    transLabelColor: "#ef8a8a",
    transText: "#cf9aa2",
    transEmpty: "#5a3038",
    standOffBg: "#16121a",
    standOffBorder: "#3a2030",
    standBoxOffBorder: "#3a2030",
    standBoxOffBg: "#1a0f14",
    concessions: [
      {
        id: "hotline",
        name: "Open the hotline",
        tag: "GESTURE",
        detail: "A direct line to the White House — cheap, reversible trust.",
        trust: 12,
        cost: 4,
        major: false,
      },
      {
        id: "grain",
        name: "Grain & cultural exchange",
        tag: "GESTURE",
        detail: "Buy American grain, allow exchanges — visible goodwill.",
        trust: 10,
        cost: 5,
        major: false,
      },
      {
        id: "vienna",
        name: "Mutual force reduction",
        tag: "FORCES",
        detail: "Thin both Central European fronts (MBFR, Vienna). −readiness.",
        trust: 18,
        cost: 8,
        major: false,
      },
      {
        id: "afghan",
        name: "Withdraw from Afghanistan",
        tag: "PROXY",
        detail: "Pull the 40th Army back — cedes ground on the Conflicts board.",
        trust: 16,
        cost: 6,
        major: false,
      },
      {
        id: "salt",
        name: "SALT II warhead ceiling",
        tag: "ARMS",
        detail: "Cap both arsenals. Big trust — but freezes your strategic buildup.",
        trust: 24,
        cost: 11,
        major: true,
      },
      {
        id: "sphere",
        name: "Recognize a US sphere of influence",
        tag: "MAJOR",
        detail: "Concede a swing state to Washington. Huge trust — and huge risk.",
        trust: 30,
        cost: 14,
        major: true,
      },
    ],
    responses: [
      {
        gate: 25,
        icon: "📞",
        text: "The White House reopens the hotline; the tone in Geneva softens.",
      },
      {
        gate: 40,
        icon: "🪖",
        text: "Washington proposes reciprocal troop cuts in Central Europe.",
      },
      { gate: 55, icon: "📜", text: "The U.S. tables a draft SALT II protocol for signature." },
      { gate: 72, icon: "🤝", text: "Carter signals readiness for a full Vienna summit." },
    ],
  },
};
