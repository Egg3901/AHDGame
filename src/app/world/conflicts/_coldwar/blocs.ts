/**
 * Static-faithful bloc-alignment dataset + helpers for the Bloc Overview board.
 * Ported verbatim from the design project; Phase 5 replaces this with live
 * 1979 game state (alignment derived from country game-states).
 */

export type BlocId = "west" | "east" | "swing" | "other";

export type Nation = {
  key?: string;
  flag: string;
  name: string;
  bloc: BlocId;
  /** 0 = fully West-aligned, 100 = fully East-aligned. */
  lean: number;
  trend: string;
  /** Trend text color. */
  tc: string;
  status: string;
  flash?: boolean;
};

export type WireItem = {
  time: string;
  src: string;
  tag: string;
  cat: "west" | "east" | "wire" | "covert";
  color: string;
  text: string;
};

export type MapPin = { name: string; label: string; left: string; top: string };

export const BLOC: Record<
  BlocId,
  { label: string; color: string; bg: string; border: string; dot: string }
> = {
  west: {
    label: "WEST",
    color: "#7ba3ec",
    bg: "rgba(59,130,246,.12)",
    border: "rgba(59,130,246,.4)",
    dot: "#3b82f6",
  },
  east: {
    label: "EAST",
    color: "#ef8a8a",
    bg: "rgba(220,38,38,.12)",
    border: "rgba(220,38,38,.4)",
    dot: "#dc2626",
  },
  swing: {
    label: "SWING",
    color: "#d9bd6b",
    bg: "rgba(212,175,55,.1)",
    border: "rgba(212,175,55,.35)",
    dot: "#d4af37",
  },
  other: { label: "N-ALIGN", color: "#8a8a9a", bg: "#1d1d2a", border: "#2a2a3d", dot: "#3a3a48" },
};

/** Per-bloc map path fill / stroke / hover-highlight colors. Keyed by `data-bloc`. */
export const MAP_FILL: Record<BlocId, string> = {
  west: "#244a86",
  east: "#7a2230",
  swing: "#6b5618",
  other: "#1c1c26",
};
export const MAP_STROKE: Record<BlocId, string> = {
  west: "#3b82f6",
  east: "#dc2626",
  swing: "#a9863a",
  other: "#2c2c38",
};
export const MAP_HI: Record<BlocId, string> = {
  west: "#2f5fa8",
  east: "#9c2c3c",
  swing: "#8a7220",
  other: "#2a2a38",
};

export const NATIONS: Record<string, Nation> = {
  "United States of America": {
    flag: "🇺🇸",
    name: "United States",
    bloc: "west",
    lean: 8,
    trend: "locked",
    tc: "#7a7a8c",
    status: "Bloc leader · NATO",
  },
  Russia: {
    flag: "🚩",
    name: "Soviet Union",
    bloc: "east",
    lean: 92,
    trend: "locked",
    tc: "#7a7a8c",
    status: "Bloc leader · Warsaw Pact",
  },
  "United Kingdom": {
    flag: "🇬🇧",
    name: "United Kingdom",
    bloc: "west",
    lean: 12,
    trend: "member",
    tc: "#7a7a8c",
    status: "NATO member",
  },
  France: {
    flag: "🇫🇷",
    name: "France",
    bloc: "west",
    lean: 28,
    trend: "semi",
    tc: "#7ba3ec",
    status: "NATO · outside command",
  },
  Germany: {
    flag: "🇩🇪",
    name: "West Germany",
    bloc: "west",
    lean: 22,
    trend: "▲ +2",
    tc: "#7ba3ec",
    status: "NATO · front line",
  },
  Japan: {
    flag: "🇯🇵",
    name: "Japan",
    bloc: "west",
    lean: 18,
    trend: "member",
    tc: "#7a7a8c",
    status: "US security treaty",
  },
  China: {
    flag: "🇨🇳",
    name: "China",
    bloc: "swing",
    lean: 46,
    trend: "◂ −4",
    tc: "#7ba3ec",
    status: "tilting West · normalizing",
  },
  Nigeria: {
    flag: "🇳🇬",
    name: "Nigeria",
    bloc: "swing",
    lean: 43,
    trend: "◂ −1",
    tc: "#7ba3ec",
    status: "non-aligned",
  },
  Egypt: {
    flag: "🇪🇬",
    name: "Egypt",
    bloc: "swing",
    lean: 42,
    trend: "◂ −6",
    tc: "#7ba3ec",
    status: "drifting West · post-Camp David",
  },
  Afghanistan: {
    flag: "🇦🇫",
    name: "Afghanistan",
    bloc: "swing",
    lean: 62,
    trend: "▶ +22",
    tc: "#ef8a8a",
    status: "UNDER PRESSURE · flashpoint",
    flash: true,
  },
  India: {
    flag: "🇮🇳",
    name: "India",
    bloc: "swing",
    lean: 58,
    trend: "▶ +3",
    tc: "#ef8a8a",
    status: "tilting East · Indo-Soviet pact",
  },
  Brazil: {
    flag: "🇧🇷",
    name: "Brazil",
    bloc: "swing",
    lean: 40,
    trend: "hold",
    tc: "#7a7a8c",
    status: "non-aligned · junta",
  },
  Cuba: {
    flag: "🇨🇺",
    name: "Cuba",
    bloc: "east",
    lean: 88,
    trend: "member",
    tc: "#7a7a8c",
    status: "Warsaw-aligned",
  },
  Vietnam: {
    flag: "🇻🇳",
    name: "Vietnam",
    bloc: "east",
    lean: 84,
    trend: "member",
    tc: "#7a7a8c",
    status: "Soviet-aligned",
  },
  Poland: {
    flag: "🇵🇱",
    name: "Poland",
    bloc: "east",
    lean: 86,
    trend: "member",
    tc: "#7a7a8c",
    status: "Warsaw Pact",
  },
  Angola: {
    flag: "🇦🇴",
    name: "Angola",
    bloc: "swing",
    lean: 70,
    trend: "▶ +5",
    tc: "#ef8a8a",
    status: "East-backed · civil war",
    flash: true,
  },
  Iran: {
    flag: "🇮🇷",
    name: "Iran",
    bloc: "swing",
    lean: 55,
    trend: "⚠ chaos",
    tc: "#eab308",
    status: "revolution · contested",
    flash: true,
  },
  Mexico: {
    flag: "🇲🇽",
    name: "Mexico",
    bloc: "swing",
    lean: 38,
    trend: "hold",
    tc: "#7a7a8c",
    status: "non-aligned",
  },
  Indonesia: {
    flag: "🇮🇩",
    name: "Indonesia",
    bloc: "swing",
    lean: 44,
    trend: "hold",
    tc: "#7a7a8c",
    status: "non-aligned",
  },
  "Saudi Arabia": {
    flag: "🇸🇦",
    name: "Saudi Arabia",
    bloc: "west",
    lean: 30,
    trend: "aligned",
    tc: "#7a7a8c",
    status: "West-aligned · oil",
  },
  Israel: {
    flag: "🇮🇱",
    name: "Israel",
    bloc: "west",
    lean: 16,
    trend: "aligned",
    tc: "#7a7a8c",
    status: "US-aligned",
  },
  "North Korea": {
    flag: "🚩",
    name: "North Korea",
    bloc: "east",
    lean: 90,
    trend: "member",
    tc: "#7a7a8c",
    status: "East bloc · flashpoint",
    flash: true,
  },
  Nicaragua: {
    flag: "🇳🇮",
    name: "Nicaragua",
    bloc: "swing",
    lean: 64,
    trend: "▶ +9",
    tc: "#ef8a8a",
    status: "Sandinista revolution",
    flash: true,
  },
  Yugoslavia: {
    flag: "🏳",
    name: "Yugoslavia",
    bloc: "swing",
    lean: 50,
    trend: "founder",
    tc: "#7a7a8c",
    status: "non-aligned founder",
  },
};

export const REG_ORDER: string[] = [
  "United States of America",
  "Russia",
  "Germany",
  "China",
  "Nigeria",
  "Egypt",
  "Afghanistan",
  "India",
  "Brazil",
];

export const WIRE: WireItem[] = [
  {
    time: "0114",
    src: "TASS",
    tag: "EAST",
    cat: "east",
    color: "#ff7849",
    text: 'Soviet 40th Army crosses the Oxus into Afghanistan "at request of Kabul."',
  },
  {
    time: "0108",
    src: "REUTERS",
    tag: "WEST",
    cat: "west",
    color: "#6fa8dc",
    text: "Thatcher confirms Cruise & Pershing II basing on British soil.",
  },
  {
    time: "0101",
    src: "AP",
    tag: "WIRE",
    cat: "wire",
    color: "#ffc14d",
    text: "Tehran: 52 hostages held at U.S. embassy — day 51.",
  },
  {
    time: "0052",
    src: "TASS",
    tag: "EAST",
    cat: "east",
    color: "#ff7849",
    text: "Havana hails Non-Aligned summit; several states tilt Moscow.",
  },
  {
    time: "0047",
    src: "REUTERS",
    tag: "WEST",
    cat: "west",
    color: "#6fa8dc",
    text: "Peking & Washington exchange ambassadors — rift with USSR widens.",
  },
  {
    time: "0039",
    src: "AP",
    tag: "WIRE",
    cat: "wire",
    color: "#ffc14d",
    text: "Managua: Sandinista junta nationalizes Somoza holdings.",
  },
  {
    time: "0030",
    src: "BBC",
    tag: "WIRE",
    cat: "wire",
    color: "#ffc14d",
    text: "Lancaster House accord signed — Rhodesia to become Zimbabwe.",
  },
  {
    time: "0021",
    src: "[CLASSIFIED]",
    tag: "COVERT",
    cat: "covert",
    color: "#ff7849",
    text: "████████ arms pipeline via Peshawar — SOURCE REDACTED.",
  },
];

export const PINS: MapPin[] = [
  { name: "Afghanistan", label: "AFG", left: "68.3%", top: "35%" },
  { name: "Iran", label: "IRN", left: "64.7%", top: "37%" },
  { name: "Angola", label: "AGO", left: "54.7%", top: "68%" },
  { name: "Nicaragua", label: "NIC", left: "26.4%", top: "50%" },
  { name: "North Korea", label: "KOR", left: "85.3%", top: "32%" },
];

// ── per-side chrome / copy / accent (Bloc Overview West vs East) ───────────────
export type BlocSide = "west" | "east";

export type BlocSideTheme = {
  pageBg: string;
  cardBg: string;
  cardBorder: string;
  stripLeft: string;
  stripLeftColor: string;
  stripRightColor: string;
  stripBg: string;
  stripBorder: string;
  headerLabel: string;
  headerLabelColor: string;
  intro: string;
  /** Register-selection accent (blue West / red East). */
  selColor: string;
  selBg: string;
  viewOnBg: string;
  viewOnBorder: string;
  viewOnColor: string;
  viewOffBg: string;
  viewOffBorder: string;
  viewOffColor: string;
};

export const BLOC_SIDE: Record<BlocSide, BlocSideTheme> = {
  west: {
    pageBg: "radial-gradient(120% 80% at 50% 0%,#15151d,#0b0b11 60%)",
    cardBg: "#14141c",
    cardBorder: "#2a2a3d",
    stripLeft: "◆ EYES ONLY · GLOBAL SITUATION BOARD",
    stripLeftColor: "#a9863a",
    stripRightColor: "#6f6a52",
    stripBg: "repeating-linear-gradient(45deg,#1a1610,#1a1610 10px,#16130d 10px,#16130d 20px)",
    stripBorder: "#2a2416",
    headerLabel: "DIPLOMACY · GRAND STRATEGY",
    headerLabelColor: "#6b6b7a",
    intro:
      "Two superpowers, two systems, one planet. Click any nation — on the map or the register — to read its alignment and act.",
    selColor: "#3b82f6",
    selBg: "rgba(59,130,246,.13)",
    viewOnBg: "rgba(59,130,246,.14)",
    viewOnBorder: "rgba(59,130,246,.4)",
    viewOnColor: "#7ba3ec",
    viewOffBg: "#1d1d2a",
    viewOffBorder: "#2a2a3d",
    viewOffColor: "#6b6b7a",
  },
  east: {
    pageBg: "radial-gradient(120% 80% at 50% 0%,#1d1316,#0b0b11 60%)",
    cardBg: "#14111a",
    cardBorder: "#3a2030",
    stripLeft: "☭ СОВ. СЕКРЕТНО · GLOBAL SITUATION BOARD",
    stripLeftColor: "#ef8a8a",
    stripRightColor: "#8a5a66",
    stripBg: "repeating-linear-gradient(45deg,#2a1014,#2a1014 10px,#220d11 10px,#220d11 20px)",
    stripBorder: "#3a1620",
    headerLabel: "STAVKA · GRAND STRATEGY",
    headerLabelColor: "#8a5a66",
    intro:
      "Two superpowers, two systems, one planet. Moscow commands the socialist camp. Click any nation — on the map or the register — to read its alignment and act.",
    selColor: "#dc2626",
    selBg: "rgba(220,38,38,.13)",
    viewOnBg: "rgba(220,38,38,.14)",
    viewOnBorder: "rgba(220,38,38,.4)",
    viewOnColor: "#f0a0a0",
    viewOffBg: "#1d1320",
    viewOffBorder: "#3a2030",
    viewOffColor: "#8a5a66",
  },
};

/** Acknowledgement message for a nation action, in the viewer's voice. */
export function actMessage(side: BlocSide, kind: string, nation: string): string {
  const west: Record<string, string> = {
    west: `Petition filed — ${nation} applies to join NATO. Sent to its legislature for ratification, then to a members' vote.`,
    east: `Petition filed — ${nation} applies to join the Warsaw Pact. Politburo will rule next turn.`,
    coerce: `Influence operation opened against ${nation}. Choose economic, military, or covert levers to shift its lean.`,
    withdraw: `Withdrawal resolution drafted for ${nation} — sent to the national legislature for chamber votes.`,
    view: `Opening alliance dossier for ${nation}…`,
  };
  const east: Record<string, string> = {
    east: `Accession offer extended — ${nation} invited into the Warsaw Pact. The Politburo will ratify next turn.`,
    west: `${nation} ceded to the Western sphere — Moscow stands down its courtship here.`,
    coerce: `Active measures opened against ${nation}. Choose economic, military, or covert levers to pull its lean East.`,
    subvert: `Subversion dossier opened on ${nation} — fund the local party, run agitprop, probe for a fracture.`,
    view: `Opening fraternal dossier for ${nation}…`,
  };
  return (side === "west" ? west : east)[kind] ?? "Order acknowledged.";
}

export type NationAction = {
  label: string;
  kind: string;
  color: string;
  bg: string;
  border: string;
};

/** The detail-panel action buttons for a nation, from the viewer's perspective. */
export function nationActions(side: BlocSide, d: { bloc: BlocId; lean: number }): NationAction[] {
  const mk = (
    label: string,
    kind: string,
    color: string,
    bg: string,
    border: string
  ): NationAction => ({ label, kind, color, bg, border });
  const GOLD: [string, string] = ["rgba(212,175,55,.12)", "rgba(212,175,55,.45)"];
  if (side === "west") {
    if (d.bloc === "swing")
      return [
        mk("◂ PETITION WEST", "west", "#9cc0f5", "rgba(59,130,246,.14)", "rgba(59,130,246,.5)"),
        mk("PETITION EAST ▸", "east", "#f0a0a0", "rgba(220,38,38,.12)", "rgba(220,38,38,.5)"),
        mk("⌖ INFLUENCE OPS", "coerce", "#e7c878", ...GOLD),
      ];
    if (d.bloc === "west" && d.lean > 10)
      return [
        mk("PROPOSE WITHDRAWAL", "withdraw", "#f0a0a0", "rgba(220,38,38,.1)", "rgba(220,38,38,.4)"),
        mk("VIEW ALLIANCE", "view", "#9cc0f5", "rgba(59,130,246,.12)", "rgba(59,130,246,.4)"),
      ];
    if (d.bloc === "east" && d.lean < 90)
      return [mk("VIEW ALLIANCE", "view", "#f0a0a0", "rgba(220,38,38,.12)", "rgba(220,38,38,.4)")];
    return [mk("BLOC LEADER · LOCKED", "view", "#8a8a9a", "#1d1d2a", "#2a2a3d")];
  }
  // east
  if (d.bloc === "swing")
    return [
      mk("BRING INTO CAMP ▸", "east", "#f0a0a0", "rgba(220,38,38,.14)", "rgba(220,38,38,.5)"),
      mk("⊕ ACTIVE MEASURES", "coerce", "#e7c878", ...GOLD),
      mk("◂ CEDE TO WEST", "west", "#9cc0f5", "rgba(59,130,246,.1)", "rgba(59,130,246,.4)"),
    ];
  if (d.bloc === "east" && d.lean < 90)
    return [
      mk("VIEW FRATERNAL DOSSIER", "view", "#f0a0a0", "rgba(220,38,38,.12)", "rgba(220,38,38,.4)"),
    ];
  if (d.bloc === "west" && d.lean > 10)
    return [
      mk("⊕ ATTEMPT TO SUBVERT", "subvert", "#e7c878", ...GOLD),
      mk("VIEW RIVAL DOSSIER", "view", "#9cc0f5", "rgba(59,130,246,.12)", "rgba(59,130,246,.4)"),
    ];
  return [mk("BLOC LEADER · LOCKED", "view", "#8a8a9a", "#1d1320", "#3a2030")];
}

/**
 * Resolve a nation by map `data-name`. Known nations come from `NATIONS`;
 * unknown ones fall back to a generic profile derived from the map path's
 * `data-bloc` (West 22 / East 82 / else 50 lean).
 */
export function lookupNation(name: string, blocFromMap: BlocId = "other"): Nation {
  const n = NATIONS[name];
  if (n) return { key: name, ...n };
  const lean = blocFromMap === "west" ? 22 : blocFromMap === "east" ? 82 : 50;
  return {
    key: name,
    flag: "🏳",
    name,
    bloc: blocFromMap,
    lean,
    trend: "—",
    tc: "#7a7a8c",
    status: blocFromMap === "other" ? "non-aligned" : `${blocFromMap} bloc`,
  };
}
