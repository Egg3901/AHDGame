import type { Side } from "./proxyWar";

/** One enemy clandestine operation in a nation (Soviet op for West; CIA op for East). */
export type IntelOp = { id: string; icon: string; name: string; detail: string; inf: number };

/** A watch-list nation. `playerBase`/`oppBase` are the viewer's vs the rival's
 *  baseline influence; `ops` are the rival operations the viewer can expose. */
export type IntelNation = {
  id: string;
  flag: string;
  name: string;
  code: string;
  region: string;
  playerBase: number;
  oppBase: number;
  ops: IntelOp[];
};

export type ExposedMap = Record<string, boolean>;

// ── pure mechanic (identical both sides; unit-tested) ──────────────────────────
export const DEPLOY_COST = 2;
export const EXPOSE_COST = 1;
export const RECRUIT_COST = 1;
export const RECRUIT_GAIN = 8;
export const DISINFO_COST = 2;
export const DISINFO_GAIN = 12;
export const CYCLE_GAIN = 3;
export const AGENTS_START = 8;
export const AGENTS_MAX = 12;
export const STANDING_PER_OP = 6;

/** Rival influence in a nation: baseline + every operation not yet exposed. */
export function oppInf(nation: IntelNation, exposed: ExposedMap): number {
  let v = nation.oppBase;
  for (const o of nation.ops) if (!exposed[o.id]) v += o.inf;
  return v;
}
/** The viewer's influence: baseline + recruited network. */
export function playerTotal(nation: IntelNation, network: number): number {
  return nation.playerBase + network;
}
/** Viewer's control of the nation, 0–100. */
export function control(nation: IntelNation, network: number, exposed: ExposedMap): number {
  const p = playerTotal(nation, network);
  const o = oppInf(nation, exposed);
  return Math.round((p / (p + o)) * 100);
}
/** Count of rival operations still live (not exposed). */
export function liveOps(nation: IntelNation, exposed: ExposedMap): number {
  return nation.ops.filter((o) => !exposed[o.id]).length;
}
/** The rival superpower's global standing — bleeds 6 per exposed operation. */
export function standing(exposedTotal: number): number {
  return Math.max(0, 100 - STANDING_PER_OP * exposedTotal);
}

// ── per-side data + copy + chrome ──────────────────────────────────────────────
export type IntelAccent = {
  /** Label text color. */
  text: string;
  /** Number / recruit-effect color. */
  cp: string;
  /** Alignment-bar gradient (player = left/90deg, opp = right/270deg). */
  grad: string;
  badgeBg: string;
  badgeBorder: string;
  /** Lean badge label, e.g. "WEST-LEANING". */
  leanLabel: string;
  /** Short bloc name, e.g. "WEST". */
  short: string;
  /** Active-op card border + background (used for the rival's ops). */
  opBorder: string;
  opBg: string;
};

export type IntelConfig = {
  order: string[];
  defaultSelected: string;
  nations: Record<string, IntelNation>;
  player: IntelAccent;
  opp: IntelAccent;
  // identity / copy
  title: string;
  intro: string;
  agentLabel: string;
  agentWord: string;
  agentDeployWord: string;
  agentSubColor: string;
  standingLabel: string;
  oppName: string;
  playerAdj: string;
  stationWord: string;
  stationWordUpper: string;
  deployLabel: string;
  darkTitle: string;
  darkActivityWord: string;
  darkBg: string;
  opsLabel: string;
  opsClean: string;
  opAdj: string;
  counterLabel: string;
  recruit: { name: string; detail: string; eff: string; noun: string; cableColor: string };
  disinform: { name: string; detail: string; eff: string; cable: string; needMsg: string };
  leanTilt: string;
  leanContested: string;
  leanOpp: string;
  cyclePersonWord: string;
  cycleCableColor: string;
  cablesLabel: string;
  cablesLabelColor: string;
  cablesEmpty: string;
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
  agentPanelBorder: string;
  agentPanelBg: string;
  agentLabelColor: string;
  standingPanelBorder: string;
  standingPanelBg: string;
  standingLabelColor: string;
  watchLabelColor: string;
  cycleBtnBorder: string;
  cycleBtnBg: string;
  cycleBtnColor: string;
  listSelBg: string;
  listBorder: string;
  listBg: string;
  dossierBorder: string;
  dossierBg: string;
  codeColor: string;
  classifiedBg: string;
  classifiedBorder: string;
  alignTrackBorder: string;
  opsLabelColor: string;
  counterLabelColor: string;
  noOpsBorder: string;
  noOpsBg: string;
  exposeOffBg: string;
  exposeOffBorder: string;
  deployOffBg: string;
  deployOffBorder: string;
  darkDashBorder: string;
  cablesBorder: string;
  cablesBg: string;
  cablesDashTop: string;
  cablesRowDash: string;
  cablesText: string;
  cablesEmptyColor: string;
};

const WEST_NATIONS: Record<string, IntelNation> = {
  afg: {
    id: "afg",
    flag: "🇦🇫",
    name: "Afghanistan",
    code: "KABUL-79",
    region: "Central Asia",
    playerBase: 18,
    oppBase: 24,
    ops: [
      {
        id: "army",
        icon: "🪖",
        name: "40th Army occupation",
        detail: "overt — 100k troops securing Kabul",
        inf: 40,
      },
      {
        id: "khad",
        icon: "🕵️",
        name: "KhAD security apparatus",
        detail: "covert — Soviet-built secret police",
        inf: 20,
      },
    ],
  },
  ind: {
    id: "ind",
    flag: "🇮🇳",
    name: "India",
    code: "DELHI-79",
    region: "South Asia",
    playerBase: 40,
    oppBase: 30,
    ops: [
      {
        id: "arms",
        icon: "✈️",
        name: "MiG-23 transfer program",
        detail: "covert — subsidized arms pipeline",
        inf: 14,
      },
      {
        id: "treaty",
        icon: "📜",
        name: "Indo-Soviet treaty advisors",
        detail: "overt — friendship treaty cadres",
        inf: 10,
      },
    ],
  },
  ago: {
    id: "ago",
    flag: "🇦🇴",
    name: "Angola",
    code: "LUANDA-79",
    region: "Southern Africa",
    playerBase: 30,
    oppBase: 18,
    ops: [
      {
        id: "cuba",
        icon: "🪖",
        name: "Cuban expeditionary force",
        detail: "overt — 25k troops backing MPLA",
        inf: 22,
      },
      {
        id: "fund",
        icon: "💵",
        name: "MPLA party funding",
        detail: "covert — Moscow gold via Lisbon",
        inf: 12,
      },
    ],
  },
  egy: {
    id: "egy",
    flag: "🇪🇬",
    name: "Egypt",
    code: "CAIRO-79",
    region: "Mideast",
    playerBase: 52,
    oppBase: 30,
    ops: [
      {
        id: "hold",
        icon: "🕵️",
        name: "Soviet advisor holdovers",
        detail: "covert — residual KGB networks",
        inf: 8,
      },
    ],
  },
  irn: {
    id: "irn",
    flag: "🇮🇷",
    name: "Iran",
    code: "TEHRAN-79",
    region: "Mideast",
    playerBase: 45,
    oppBase: 28,
    ops: [
      {
        id: "tudeh",
        icon: "📢",
        name: "Tudeh party agitation",
        detail: "covert — communist street networks",
        inf: 12,
      },
    ],
  },
  idn: {
    id: "idn",
    flag: "🇮🇩",
    name: "Indonesia",
    code: "JAKARTA-79",
    region: "SE Asia",
    playerBase: 55,
    oppBase: 30,
    ops: [
      {
        id: "pki",
        icon: "🕵️",
        name: "PKI remnant cells",
        detail: "covert — underground party remnants",
        inf: 6,
      },
    ],
  },
  nga: {
    id: "nga",
    flag: "🇳🇬",
    name: "Nigeria",
    code: "LAGOS-79",
    region: "W. Africa",
    playerBase: 50,
    oppBase: 34,
    ops: [
      {
        id: "credit",
        icon: "💵",
        name: "Soviet arms credits",
        detail: "covert — deferred-payment weapons",
        inf: 9,
      },
    ],
  },
  yug: {
    id: "yug",
    flag: "🏳",
    name: "Yugoslavia",
    code: "BELGRADE-79",
    region: "Balkans",
    playerBase: 50,
    oppBase: 42,
    ops: [
      {
        id: "comecon",
        icon: "📜",
        name: "Comecon trade overtures",
        detail: "overt — economic courtship",
        inf: 8,
      },
    ],
  },
};

const EAST_NATIONS: Record<string, IntelNation> = {
  irn: {
    id: "irn",
    flag: "🇮🇷",
    name: "Iran",
    code: "TEHRAN-79",
    region: "Mideast",
    playerBase: 28,
    oppBase: 30,
    ops: [
      {
        id: "savak",
        icon: "🕵️",
        name: "SAVAK liaison network",
        detail: "covert — CIA-trained secret police remnants",
        inf: 18,
      },
      {
        id: "oil",
        icon: "🛢️",
        name: "Oil-major back-channels",
        detail: "covert — Western petroleum leverage",
        inf: 14,
      },
    ],
  },
  egy: {
    id: "egy",
    flag: "🇪🇬",
    name: "Egypt",
    code: "CAIRO-79",
    region: "Mideast",
    playerBase: 30,
    oppBase: 40,
    ops: [
      {
        id: "campd",
        icon: "📜",
        name: "Camp David aid pipeline",
        detail: "overt — $2bn/yr US military aid",
        inf: 24,
      },
      {
        id: "mil",
        icon: "✈️",
        name: "F-4 Phantom transfers",
        detail: "covert — re-equipping the air force",
        inf: 12,
      },
    ],
  },
  idn: {
    id: "idn",
    flag: "🇮🇩",
    name: "Indonesia",
    code: "JAKARTA-79",
    region: "SE Asia",
    playerBase: 30,
    oppBase: 38,
    ops: [
      {
        id: "suharto",
        icon: "💵",
        name: "Suharto regime backing",
        detail: "covert — anti-communist patronage",
        inf: 16,
      },
      {
        id: "oilco",
        icon: "🛢️",
        name: "Western oil concessions",
        detail: "overt — Pertamina partnerships",
        inf: 10,
      },
    ],
  },
  nga: {
    id: "nga",
    flag: "🇳🇬",
    name: "Nigeria",
    code: "LAGOS-79",
    region: "W. Africa",
    playerBase: 34,
    oppBase: 30,
    ops: [
      {
        id: "oilmaj",
        icon: "🛢️",
        name: "Oil-major patronage",
        detail: "covert — Shell/Mobil political funding",
        inf: 12,
      },
    ],
  },
  ind: {
    id: "ind",
    flag: "🇮🇳",
    name: "India",
    code: "DELHI-79",
    region: "South Asia",
    playerBase: 30,
    oppBase: 40,
    ops: [
      {
        id: "imf",
        icon: "💵",
        name: "IMF structural credits",
        detail: "overt — Western development finance",
        inf: 10,
      },
    ],
  },
  bra: {
    id: "bra",
    flag: "🇧🇷",
    name: "Brazil",
    code: "BRASILIA-79",
    region: "S. America",
    playerBase: 24,
    oppBase: 40,
    ops: [
      {
        id: "junta",
        icon: "🎖️",
        name: "Junta security assistance",
        detail: "covert — Operation Condor ties",
        inf: 14,
      },
    ],
  },
  chl: {
    id: "chl",
    flag: "🇨🇱",
    name: "Chile",
    code: "SANTIAGO-79",
    region: "S. America",
    playerBase: 18,
    oppBase: 50,
    ops: [
      {
        id: "pino",
        icon: "🎖️",
        name: "Pinochet regime support",
        detail: "covert — post-coup CIA backing",
        inf: 20,
      },
    ],
  },
  zai: {
    id: "zai",
    flag: "🇨🇩",
    name: "Zaire",
    code: "KINSHASA-79",
    region: "C. Africa",
    playerBase: 26,
    oppBase: 36,
    ops: [
      {
        id: "mobutu",
        icon: "💵",
        name: "Mobutu patronage",
        detail: "covert — mineral-for-loyalty deals",
        inf: 14,
      },
    ],
  },
};

export const INTEL: Record<Side, IntelConfig> = {
  west: {
    order: ["afg", "ind", "ago", "egy", "irn", "idn", "nga", "yug"],
    defaultSelected: "afg",
    nations: WEST_NATIONS,
    player: {
      text: "#7ba3ec",
      cp: "#9cc0f5",
      grad: "linear-gradient(90deg,#1d4ed8,#3b82f6)",
      badgeBg: "rgba(59,130,246,.12)",
      badgeBorder: "rgba(59,130,246,.4)",
      leanLabel: "WEST-LEANING",
      short: "WEST",
      opBorder: "rgba(59,130,246,.25)",
      opBg: "rgba(59,130,246,.05)",
    },
    opp: {
      text: "#ef8a8a",
      cp: "#f0a0a0",
      grad: "linear-gradient(270deg,#991b1b,#dc2626)",
      badgeBg: "rgba(220,38,38,.1)",
      badgeBorder: "rgba(220,38,38,.4)",
      leanLabel: "EAST-LEANING",
      short: "EAST",
      opBorder: "rgba(220,38,38,.25)",
      opBg: "rgba(220,38,38,.05)",
    },
    title: "The Station",
    intro:
      "You can't fight for a country you can't see. Deploy stations to read a nation's true alignment, uncover the Soviet operations pulling it East — then drag them into the light. Every exposure costs Moscow dearly.",
    agentLabel: "FIELD AGENTS",
    agentWord: "agent",
    agentDeployWord: "AGENTS",
    agentSubColor: "#6f8a5a",
    standingLabel: "SOVIET STANDING",
    oppName: "Moscow",
    playerAdj: "Western",
    stationWord: "station",
    stationWordUpper: "STATION",
    deployLabel: "⌖ DEPLOY STATION · 2 AGENTS",
    darkTitle: "STATION DARK",
    darkActivityWord: "Soviet",
    darkBg: "#0d0d14",
    opsLabel: "☭ SOVIET OPERATIONS DETECTED",
    opsClean: "✓ No active Soviet operations — this theater is clean.",
    opAdj: "Soviet",
    counterLabel: "▮ STATION OPERATIONS",
    recruit: {
      name: "Recruit local asset",
      detail: "Build a network — raises Western influence and deepens your read.",
      eff: "+8 West influence",
      noun: "asset",
      cableColor: "#9cc0f5",
    },
    disinform: {
      name: "Active measures",
      detail: "Forge cables and seed doubt about Soviet intentions.",
      eff: "+12 West influence",
      cable: "forged cables sow doubt about Soviet intentions.",
      needMsg: "Disinformation needs 2 agents.",
    },
    leanTilt: "a Western tilt — exposure is paying off",
    leanContested: "genuinely contested",
    leanOpp: "Moscow holds the advantage here — find their operations",
    cyclePersonWord: "agents",
    cycleCableColor: "#6f8a5a",
    cablesLabel: "▌STATION CABLES",
    cablesLabelColor: "#ffc14d",
    cablesEmpty: "— no traffic · deploy a station to begin —",
    pageBg: "radial-gradient(120% 80% at 50% 0%,#15151d,#0b0b11 60%)",
    cardBg: "#14141c",
    cardBorder: "#2a2a3d",
    stripBg: "repeating-linear-gradient(45deg,#1a1610,#1a1610 10px,#16130d 10px,#16130d 20px)",
    stripBorder: "#2a2416",
    stripLeftColor: "#a9863a",
    stripLeftText: "◆ TOP SECRET // UMBRA — CENTRAL INTELLIGENCE",
    stripRightColor: "#6f6a52",
    stripRightText: "THE STATION · CLANDESTINE SERVICE",
    headerLabelColor: "#6b6b7a",
    agentPanelBorder: "#2a2a3d",
    agentPanelBg: "#1d1d2a",
    agentLabelColor: "#6b6b7a",
    standingPanelBorder: "rgba(220,38,38,.3)",
    standingPanelBg: "rgba(220,38,38,.06)",
    standingLabelColor: "#ef8a8a",
    watchLabelColor: "#6b6b7a",
    cycleBtnBorder: "#2a2a3d",
    cycleBtnBg: "#1d1d2a",
    cycleBtnColor: "#9cc0a0",
    listSelBg: "#1d1d2a",
    listBorder: "#2a2a3d",
    listBg: "#1a1a25",
    dossierBorder: "#2a2a3d",
    dossierBg: "#11111a",
    codeColor: "#7a7a8c",
    classifiedBg: "#1d1d2a",
    classifiedBorder: "#2a2a3d",
    alignTrackBorder: "#2a2a3d",
    opsLabelColor: "#ef8a8a",
    counterLabelColor: "#7ba3ec",
    noOpsBorder: "#2a2a3d",
    noOpsBg: "#16161f",
    exposeOffBg: "#16161f",
    exposeOffBorder: "#2a2a3d",
    deployOffBg: "#16161f",
    deployOffBorder: "#2a2a3d",
    darkDashBorder: "#2a2a3d",
    cablesBorder: "#2a2416",
    cablesBg: "#0a0906",
    cablesDashTop: "#4a3f1e",
    cablesRowDash: "#211c0e",
    cablesText: "#d9aa55",
    cablesEmptyColor: "#5a4f30",
  },
  east: {
    order: ["irn", "egy", "idn", "nga", "ind", "bra", "chl", "zai"],
    defaultSelected: "irn",
    nations: EAST_NATIONS,
    player: {
      text: "#ef8a8a",
      cp: "#f0a0a0",
      grad: "linear-gradient(90deg,#991b1b,#dc2626)",
      badgeBg: "rgba(220,38,38,.12)",
      badgeBorder: "rgba(220,38,38,.4)",
      leanLabel: "EAST-LEANING",
      short: "EAST",
      opBorder: "rgba(220,38,38,.25)",
      opBg: "rgba(220,38,38,.05)",
    },
    opp: {
      text: "#7ba3ec",
      cp: "#9cc0f5",
      grad: "linear-gradient(270deg,#1d4ed8,#3b82f6)",
      badgeBg: "rgba(59,130,246,.1)",
      badgeBorder: "rgba(59,130,246,.4)",
      leanLabel: "WEST-LEANING",
      short: "WEST",
      opBorder: "rgba(59,130,246,.25)",
      opBg: "rgba(59,130,246,.05)",
    },
    title: "The Residency",
    intro:
      "The Centre sees all — eventually. Deploy residencies to read a nation's true alignment, uncover the CIA operations propping up the reactionaries, then blow them in the world press. Every exposure bleeds American standing.",
    agentLabel: "FIELD OFFICERS",
    agentWord: "officer",
    agentDeployWord: "OFFICERS",
    agentSubColor: "#7a6a72",
    standingLabel: "AMERICAN STANDING",
    oppName: "Washington",
    playerAdj: "Soviet",
    stationWord: "residency",
    stationWordUpper: "RESIDENCY",
    deployLabel: "⌖ DEPLOY RESIDENCY · 2 OFFICERS",
    darkTitle: "NO RESIDENCY",
    darkActivityWord: "American",
    darkBg: "#120a0f",
    opsLabel: "🦅 CIA OPERATIONS DETECTED",
    opsClean: "✓ No active American operations — this theater is clean.",
    opAdj: "American",
    counterLabel: "▮ RESIDENCY OPERATIONS",
    recruit: {
      name: "Recruit local agent",
      detail: "Build a network — raises Soviet influence and deepens your read.",
      eff: "+8 East influence",
      noun: "agent",
      cableColor: "#f0a0a0",
    },
    disinform: {
      name: "Active measures",
      detail: 'Forge documents exposing "American imperialism."',
      eff: "+12 East influence",
      cable: 'forged documents expose "American imperialism."',
      needMsg: "Active measures need 2 officers.",
    },
    leanTilt: "an Eastern tilt — exposure is paying off",
    leanContested: "genuinely contested",
    leanOpp: "Washington holds the advantage here — find their operations",
    cyclePersonWord: "officers",
    cycleCableColor: "#cf9aa2",
    cablesLabel: "▌RESIDENCY CABLES",
    cablesLabelColor: "#ef8a8a",
    cablesEmpty: "— no traffic · deploy a residency to begin —",
    pageBg: "radial-gradient(120% 80% at 50% 0%,#1d1316,#0b0b11 60%)",
    cardBg: "#14111a",
    cardBorder: "#3a2030",
    stripBg: "repeating-linear-gradient(45deg,#2a1014,#2a1014 10px,#220d11 10px,#220d11 20px)",
    stripBorder: "#3a1620",
    stripLeftColor: "#ef8a8a",
    stripLeftText: "☭ СОВ. СЕКРЕТНО · КГБ — FIRST CHIEF DIRECTORATE",
    stripRightColor: "#8a5a66",
    stripRightText: "THE RESIDENCY · FOREIGN INTELLIGENCE",
    headerLabelColor: "#8a5a66",
    agentPanelBorder: "#3a2030",
    agentPanelBg: "#1a0f14",
    agentLabelColor: "#8a5a66",
    standingPanelBorder: "rgba(59,130,246,.3)",
    standingPanelBg: "rgba(59,130,246,.06)",
    standingLabelColor: "#7ba3ec",
    watchLabelColor: "#8a5a66",
    cycleBtnBorder: "#3a2030",
    cycleBtnBg: "#1a0f14",
    cycleBtnColor: "#cf9aa2",
    listSelBg: "#221320",
    listBorder: "#3a2030",
    listBg: "#1a0f14",
    dossierBorder: "#3a2030",
    dossierBg: "#1a0f14",
    codeColor: "#8a5a66",
    classifiedBg: "#1d1320",
    classifiedBorder: "#3a2030",
    alignTrackBorder: "#2a1620",
    opsLabelColor: "#7ba3ec",
    counterLabelColor: "#ef8a8a",
    noOpsBorder: "#3a2030",
    noOpsBg: "#16121a",
    exposeOffBg: "#16121a",
    exposeOffBorder: "#3a2030",
    deployOffBg: "#16121a",
    deployOffBorder: "#3a2030",
    darkDashBorder: "#3a2030",
    cablesBorder: "#2a1620",
    cablesBg: "#0a0608",
    cablesDashTop: "#4a2630",
    cablesRowDash: "#1c1014",
    cablesText: "#cf9aa2",
    cablesEmptyColor: "#5a3038",
  },
};
