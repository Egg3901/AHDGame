import type { Side } from "./proxyWar";

/** Accent palette for one bloc (blue = West, red = East), used in either role. */
export type Accent = {
  /** Label / heading text color. */
  text: string;
  /** CP number color. */
  cp: string;
  /** Belligerent card border + background. */
  border: string;
  bg: string;
  /** Control-bar fill color (list + supply rows). */
  bar: string;
  /** Front-line gradient (player = left/90deg, opponent = right/270deg). */
  gradient: string;
  /** Belligerent-card label, e.g. "WEST-BACKED". */
  label: string;
  /** Short bloc name, e.g. "WEST". */
  short: string;
  /** Stronger (.45) border for active controls (e.g. the commit button). */
  borderStrong: string;
};

/**
 * Every palette token that differs between Conflicts (West) and Conflicts
 * (East). The board picks `SIDE_THEME[side]`; the view components render from
 * it, so West and East share one set of components. `player` = the bloc the
 * viewer commands; `opponent` = the other bloc.
 */
export type SideTheme = {
  pageBg: string;
  cardBorder: string;
  cardBg: string;
  stripBg: string;
  stripBorder: string;
  stripLeftColor: string;
  stripRightColor: string;
  stripLeftText: string;
  stripRightText: string;
  headerLabelColor: string;
  ledgerBorder: string;
  ledgerBg: string;
  ledgerDot: string;
  ledgerLabelColor: string;
  ledgerLabelText: string;
  ledgerSubColor: string;
  ledgerTrackBorder: string;
  ledgerBarFill: string;
  ledgerNote: string;
  ledgerNoteColor: string;
  cohBorder: string;
  cohBg: string;
  cohLabelColor: string;
  cohLabelText: string;
  cohSliderAccent: string;
  cohMutedColor: string;
  cohCommand: string;
  listHeaderColor: string;
  listTheaterColor: string;
  listSelBorder: string;
  listSelBg: string;
  listBorder: string;
  listBg: string;
  listTrackBorder: string;
  panelBorder: string;
  panelBg: string;
  dossierStripe: string;
  dossierStripeBorder: string;
  dossierLabelColor: string;
  theaterBadgeBg: string;
  theaterBadgeBorder: string;
  innerBorder: string;
  innerBg: string;
  barTrack: string;
  frontTrackBorder: string;
  deployBorder: string;
  deployBg: string;
  stepBorder: string;
  stepBg: string;
  withdrawBg: string;
  withdrawBorder: string;
  reinforceOkBg: string;
  reinforceOffBg: string;
  player: Accent;
  opponent: Accent;
};

const BLUE: Accent = {
  text: "#7ba3ec",
  cp: "#9cc0f5",
  border: "rgba(59,130,246,.3)",
  bg: "rgba(59,130,246,.06)",
  bar: "#3b82f6",
  gradient: "linear-gradient(90deg,#1d4ed8,#3b82f6)",
  label: "WEST-BACKED",
  short: "WEST",
  borderStrong: "rgba(59,130,246,.45)",
};
const RED: Accent = {
  text: "#ef8a8a",
  cp: "#f0a0a0",
  border: "rgba(220,38,38,.3)",
  bg: "rgba(220,38,38,.06)",
  bar: "#dc2626",
  gradient: "linear-gradient(90deg,#991b1b,#dc2626)",
  label: "EAST-BACKED",
  short: "EAST",
  borderStrong: "rgba(220,38,38,.45)",
};
// Opponent gradients face the other way (right side of the front-line bar).
const BLUE_OPP_GRAD = "linear-gradient(270deg,#1d4ed8,#3b82f6)";
const RED_OPP_GRAD = "linear-gradient(270deg,#991b1b,#dc2626)";

export const SIDE_THEME: Record<Side, SideTheme> = {
  west: {
    pageBg: "radial-gradient(120% 80% at 50% 0%,#15151d,#0b0b11 60%)",
    cardBorder: "#2a2a3d",
    cardBg: "#14141c",
    stripBg: "repeating-linear-gradient(45deg,#1a1610,#1a1610 10px,#16130d 10px,#16130d 20px)",
    stripBorder: "#2a2416",
    stripLeftColor: "#a9863a",
    stripRightColor: "#6f6a52",
    stripLeftText: "◆ EYES ONLY · ACTIVE THEATERS",
    stripRightText: "TURN 1 · WK 01 JAN 1979 · WESTERN COMMAND",
    headerLabelColor: "#6b6b7a",
    ledgerBorder: "rgba(59,130,246,.3)",
    ledgerBg: "linear-gradient(90deg,rgba(59,130,246,.08),rgba(20,20,28,0))",
    ledgerDot: "#3b82f6",
    ledgerLabelColor: "#7ba3ec",
    ledgerLabelText: "WESTERN BLOC · COMBAT POWER",
    ledgerSubColor: "#7a7a8c",
    ledgerTrackBorder: "#23232f",
    ledgerBarFill: "linear-gradient(90deg,#1d4ed8,#3b82f6)",
    ledgerNote: "drawn from cohesion-adjusted forces · ⚙ Military Forces",
    ledgerNoteColor: "#6b6b7a",
    cohBorder: "#2a2a3d",
    cohBg: "#16161f",
    cohLabelColor: "#7ba3ec",
    cohLabelText: "WESTERN BLOC COHESION",
    cohSliderAccent: "#3b82f6",
    cohMutedColor: "#6b6b7a",
    cohCommand: "Military Forces",
    listHeaderColor: "#6b6b7a",
    listTheaterColor: "#7a7a8c",
    listSelBorder: "rgba(59,130,246,.45)",
    listSelBg: "rgba(59,130,246,.08)",
    listBorder: "#2a2a3d",
    listBg: "#1a1a25",
    listTrackBorder: "#23232f",
    panelBorder: "#2a2a3d",
    panelBg: "#11111a",
    dossierStripe:
      "repeating-linear-gradient(135deg,#1b1410,#1b1410 11px,#181109 11px,#181109 22px)",
    dossierStripeBorder: "#2a2416",
    dossierLabelColor: "#a9863a",
    theaterBadgeBg: "#1d1d2a",
    theaterBadgeBorder: "#2a2a3d",
    innerBorder: "#2a2a3d",
    innerBg: "#16161f",
    barTrack: "#23232f",
    frontTrackBorder: "#2a2a3d",
    deployBorder: "rgba(59,130,246,.3)",
    deployBg: "linear-gradient(180deg,rgba(59,130,246,.08),rgba(17,17,26,.35))",
    stepBorder: "#2a2a3d",
    stepBg: "#1d1d2a",
    withdrawBg: "#14141c",
    withdrawBorder: "#2a2a3d",
    reinforceOkBg: "rgba(134,217,120,.1)",
    reinforceOffBg: "#16161f",
    player: BLUE,
    opponent: { ...RED, gradient: RED_OPP_GRAD },
  },
  east: {
    pageBg: "radial-gradient(120% 80% at 50% 0%,#1d1316,#0b0b11 60%)",
    cardBorder: "#3a2030",
    cardBg: "#14111a",
    stripBg: "repeating-linear-gradient(45deg,#2a1014,#2a1014 10px,#220d11 10px,#220d11 20px)",
    stripBorder: "#3a1620",
    stripLeftColor: "#ef8a8a",
    stripRightColor: "#8a5a66",
    stripLeftText: "☭ СОВ. СЕКРЕТНО · ACTIVE THEATERS",
    stripRightText: "TURN 1 · WK 01 JAN 1979 · EASTERN COMMAND",
    headerLabelColor: "#8a5a66",
    ledgerBorder: "rgba(220,38,38,.3)",
    ledgerBg: "linear-gradient(90deg,rgba(220,38,38,.08),rgba(20,16,20,0))",
    ledgerDot: "#dc2626",
    ledgerLabelColor: "#ef8a8a",
    ledgerLabelText: "EASTERN BLOC · COMBAT POWER",
    ledgerSubColor: "#7a6a72",
    ledgerTrackBorder: "#2a1620",
    ledgerBarFill: "linear-gradient(90deg,#991b1b,#dc2626)",
    ledgerNote: "drawn from cohesion-adjusted forces · ⚙ Warsaw Pact Command",
    ledgerNoteColor: "#8a5a66",
    cohBorder: "#3a2030",
    cohBg: "#1a0f14",
    cohLabelColor: "#ef8a8a",
    cohLabelText: "EASTERN BLOC COHESION",
    cohSliderAccent: "#dc2626",
    cohMutedColor: "#8a5a66",
    cohCommand: "Warsaw Pact Command",
    listHeaderColor: "#8a5a66",
    listTheaterColor: "#8a5a66",
    listSelBorder: "rgba(220,38,38,.45)",
    listSelBg: "rgba(220,38,38,.08)",
    listBorder: "#3a2030",
    listBg: "#1a0f14",
    listTrackBorder: "#2a1620",
    panelBorder: "#3a2030",
    panelBg: "#1a0f14",
    dossierStripe:
      "repeating-linear-gradient(135deg,#241015,#241015 11px,#1e0d11 11px,#1e0d11 22px)",
    dossierStripeBorder: "#3a1620",
    dossierLabelColor: "#ef8a8a",
    theaterBadgeBg: "#1d1320",
    theaterBadgeBorder: "#3a2030",
    innerBorder: "#3a2030",
    innerBg: "#1a0f14",
    barTrack: "#2a1620",
    frontTrackBorder: "#2a1620",
    deployBorder: "rgba(220,38,38,.3)",
    deployBg: "linear-gradient(180deg,rgba(220,38,38,.08),rgba(26,15,20,.35))",
    stepBorder: "#3a2030",
    stepBg: "#1d1320",
    withdrawBg: "#14111a",
    withdrawBorder: "#3a2030",
    reinforceOkBg: "rgba(134,217,120,.1)",
    reinforceOffBg: "#1a0f14",
    player: RED,
    opponent: { ...BLUE, gradient: BLUE_OPP_GRAD },
  },
};
