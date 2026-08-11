import type { Side } from "./proxyWar";

/** Posture effect-chip color kind. */
export type EffectKind = "h" | "g" | "d" | "m";
export const EFFECT_COLORS: Record<EffectKind, { c: string; bg: string; bd: string }> = {
  h: { c: "#ff9d7a", bg: "rgba(255,120,73,.06)", bd: "rgba(255,120,73,.3)" },
  g: { c: "#86d978", bg: "rgba(134,217,120,.06)", bd: "rgba(134,217,120,.3)" },
  d: { c: "#ef8a8a", bg: "rgba(239,68,68,.05)", bd: "rgba(239,68,68,.3)" },
  m: { c: "#d9bd6b", bg: "rgba(212,175,55,.05)", bd: "rgba(212,175,55,.3)" },
};

/** A toggleable foreign-policy posture and its metric deltas. */
export type Posture = {
  id: string;
  icon: string;
  name: string;
  effects: { text: string; kind: EffectKind }[];
  /** Per-metric deltas applied while active (keys are side-specific). */
  d: Record<string, number>;
};

/** Opaque metric bag — keys differ per side; mood/moodColor/burden always present. */
export type Metrics = { mood: string; moodColor: string; burden: string } & Record<
  string,
  number | string
>;
const mn = (m: Metrics, k: string): number => m[k] as number;

export type BigStat = { value: number; tier: string; color: string; bg: string; border: string };
export type StripMetric = {
  label: string;
  value: string;
  suffix?: string;
  color: string;
  sub: string;
};
export type FactionBar = { name: string; val: number; color: string; note: string };
export type Headline = { src: string; c: string; t: string };

export const ADDRESS_COST = 8;
export const ADDRESS_BUMP = 8;
export const ADDRESS_BUMP_MAX = 24;
export const PC_START = 60;

const clamp = (x: number): number => Math.max(0, Math.min(100, Math.round(x)));

export type HomeFrontConfig = {
  pcKey: string;
  // copy
  title: string;
  intro: string;
  headerLabel: string;
  bigStatLabel: string;
  postureTitle: string;
  postureTitleColor: string;
  postureSub: string;
  coalitionTitle: string;
  actionsTitle: string;
  addressLabel: string;
  addressErr: string;
  addressOk: string;
  headlinesLabel: string;
  headlineTextColor: string;
  // posture toggle styling (player accent)
  postureActive: { tagBg: string; tagColor: string; border: string; bg: string };
  postureInactive: { tagBg: string; tagColor: string; border: string; bg: string };
  // address button (player accent)
  addrOnColor: string;
  addrOnBg: string;
  addrOnBorder: string;
  addrOffBg: string;
  addrOffBorder: string;
  // data + pure logic
  postures: Posture[];
  compute: (active: Record<string, boolean>, defcon: number, addressBump: number) => Metrics;
  bigStat: (m: Metrics) => BigStat;
  strip: (m: Metrics, defcon: number, pc: number) => StripMetric[];
  factions: (m: Metrics) => FactionBar[];
  headlines: (active: Record<string, boolean>, defcon: number, m: Metrics) => Headline[];
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
  metricStripBorder: string;
  stripLabelColor: string;
  stripSubColor: string;
  panelBorder: string;
  panelBg: string;
  actionsBg: string;
  factionLabelColor: string;
  factionTrackBorder: string;
  factionNoteColor: string;
  resetBg: string;
  resetBorder: string;
  cablesBorder: string;
  cablesBg: string;
  cablesDashTop: string;
  cablesRowDash: string;
  cablesLabelColor: string;
};

const pcColor = (pc: number) => (pc < 15 ? "#ff5a3c" : pc < 30 ? "#eab308" : "#f3f1ea");

// ── West: The Home Front ───────────────────────────────────────────────────────
const WEST_POSTURES: Posture[] = [
  {
    id: "hardline",
    icon: "🦅",
    name: "Hardline rearmament",
    d: { appr: 4, hawk: 18, dove: -12, heart: -4, misery: 6 },
    effects: [
      { text: "+18 hawks", kind: "h" },
      { text: "−12 doves", kind: "d" },
      { text: "+6 misery", kind: "m" },
    ],
  },
  {
    id: "detente",
    icon: "🕊️",
    name: "Détente & SALT II",
    d: { appr: 6, hawk: -14, dove: 16, heart: 2, misery: -2 },
    effects: [
      { text: "+16 doves", kind: "g" },
      { text: "−14 hawks", kind: "d" },
      { text: "+6 approval", kind: "g" },
    ],
  },
  {
    id: "coups",
    icon: "🕵️",
    name: "Covert coups (exposed)",
    d: { appr: -12, hawk: -4, dove: -8, heart: -2, misery: 0 },
    effects: [
      { text: "−12 approval", kind: "d" },
      { text: "congressional hearings", kind: "m" },
    ],
  },
  {
    id: "basing",
    icon: "🚀",
    name: "Euromissiles & home basing",
    d: { appr: -3, hawk: 8, dove: -10, heart: -2, misery: 2 },
    effects: [
      { text: "+8 hawks", kind: "h" },
      { text: "street protests", kind: "d" },
    ],
  },
  {
    id: "firewall",
    icon: "⛔",
    name: "Bloc trade firewall",
    d: { appr: -2, hawk: 4, dove: -2, heart: -12, misery: 8 },
    effects: [
      { text: "−12 heartland", kind: "d" },
      { text: "+8 misery", kind: "m" },
    ],
  },
];

function computeWest(
  active: Record<string, boolean>,
  defcon: number,
  addressBump: number
): Metrics {
  let hawk = 42,
    dove = 42,
    heart = 50,
    appr = 46,
    misery = 20;
  for (const p of WEST_POSTURES) {
    if (active[p.id]) {
      appr += p.d.appr;
      hawk += p.d.hawk;
      dove += p.d.dove;
      heart += p.d.heart;
      misery += p.d.misery;
    }
  }
  let mood: string, moodColor: string;
  if (defcon <= 2) {
    appr += 5;
    hawk += 10;
    misery += 6;
    mood = "ALARMED";
    moodColor = "#ff5a3c";
  } else if (defcon >= 5) {
    dove += 6;
    appr += 2;
    mood = "AT EASE";
    moodColor = "#86d978";
  } else {
    mood = "WATCHFUL";
    moodColor = "#eab308";
  }
  appr += addressBump - Math.max(0, misery - 22) * 0.6 - (heart < 40 ? (40 - heart) * 0.3 : 0);
  return {
    hawk: clamp(hawk),
    dove: clamp(dove),
    heart: clamp(heart),
    appr: clamp(appr),
    misery: Math.max(4, Math.round(misery)),
    mood,
    moodColor,
    burden: "5.2",
  };
}

const fnoteWest = (v: number) =>
  v >= 55 ? "firmly with you" : v >= 42 ? "holding, for now" : "turning against you";

// ── East: The Politburo ────────────────────────────────────────────────────────
const EAST_POSTURES: Posture[] = [
  {
    id: "hardline",
    icon: "🎖️",
    name: "Hardline confrontation",
    d: { conf: 5, hard: 18, ref: -14, app: -2, short: 6 },
    effects: [
      { text: "+18 hardliners", kind: "h" },
      { text: "−14 reformers", kind: "d" },
      { text: "+6 shortages", kind: "m" },
    ],
  },
  {
    id: "detente",
    icon: "🕊️",
    name: "Détente & SALT II",
    d: { conf: 4, hard: -16, ref: 18, app: -2, short: -4 },
    effects: [
      { text: "+18 reformers", kind: "g" },
      { text: "−16 hardliners", kind: "d" },
      { text: "−4 shortages", kind: "g" },
    ],
  },
  {
    id: "afghan",
    icon: "🪖",
    name: "The Afghan intervention",
    d: { conf: -4, hard: 10, ref: -8, app: -10, short: 10 },
    effects: [
      { text: "+10 hardliners", kind: "h" },
      { text: "−10 apparatus", kind: "d" },
      { text: "+10 shortages", kind: "m" },
    ],
  },
  {
    id: "subsidies",
    icon: "💰",
    name: "Subsidize the satellites",
    d: { conf: 2, hard: 2, ref: -10, app: 12, short: 8 },
    effects: [
      { text: "+12 apparatus", kind: "h" },
      { text: "−10 reformers", kind: "d" },
      { text: "plan drain", kind: "m" },
    ],
  },
  {
    id: "covert",
    icon: "🕵️",
    name: "Covert failures (exposed)",
    d: { conf: -12, hard: -6, ref: -4, app: -4, short: 0 },
    effects: [
      { text: "−12 confidence", kind: "d" },
      { text: "Party embarrassment", kind: "m" },
    ],
  },
];

function computeEast(
  active: Record<string, boolean>,
  defcon: number,
  addressBump: number
): Metrics {
  let hard = 46,
    ref = 40,
    app = 52,
    conf = 50,
    plan = 96,
    short = 30;
  for (const p of EAST_POSTURES) {
    if (active[p.id]) {
      conf += p.d.conf;
      hard += p.d.hard;
      ref += p.d.ref;
      app += p.d.app;
      short += p.d.short;
      if (p.id === "afghan" || p.id === "subsidies") plan -= 5;
      if (p.id === "detente") plan += 3;
    }
  }
  let mood: string, moodColor: string;
  if (defcon <= 2) {
    conf += 5;
    hard += 10;
    short += 5;
    mood = "MOBILIZED";
    moodColor = "#ff5a3c";
  } else if (defcon >= 5) {
    ref += 6;
    conf += 2;
    mood = "AT EASE";
    moodColor = "#86d978";
  } else {
    mood = "VIGILANT";
    moodColor = "#eab308";
  }
  conf += addressBump - Math.max(0, short - 34) * 0.5 - (app < 40 ? (40 - app) * 0.3 : 0);
  return {
    hard: clamp(hard),
    ref: clamp(ref),
    app: clamp(app),
    conf: clamp(conf),
    plan: Math.max(60, Math.round(plan)),
    short: Math.max(8, Math.round(short)),
    mood,
    moodColor,
    burden: "13.4",
  };
}

const fnoteEast = (v: number) =>
  v >= 55 ? "firmly behind you" : v >= 42 ? "holding, for now" : "whispering in the corridors";

export const HOMEFRONT: Record<Side, HomeFrontConfig> = {
  west: {
    pcKey: "ahd_west_pc",
    title: "The Home Front",
    intro:
      "Every move abroad lands on a desk back home. Your readiness alerts, coups, treaties, and bloc commitments all ripple through approval, the economy, and the coalition that keeps you in power.",
    headerLabel: "HOME FRONT · THE POLITICS OF FOREIGN POLICY",
    bigStatLabel: "PRESIDENTIAL APPROVAL",
    postureTitle: "▮ FOREIGN POLICY → HOME",
    postureTitleColor: "#7ba3ec",
    postureSub: "toggle a posture to see how it plays in the heartland",
    coalitionTitle: "GOVERNING COALITION",
    actionsTitle: "PRESIDENTIAL ACTIONS",
    addressLabel: "📺 ADDRESS THE NATION · 8 PC",
    addressErr: "Not enough political capital for a prime-time address (8 PC).",
    addressOk: "Prime-time address delivered — a temporary bump in the polls. −8 PC.",
    headlinesLabel: "▌MORNING EDITION",
    headlineTextColor: "#d9aa55",
    postureActive: {
      tagBg: "rgba(59,130,246,.14)",
      tagColor: "#7ba3ec",
      border: "rgba(59,130,246,.35)",
      bg: "rgba(59,130,246,.05)",
    },
    postureInactive: { tagBg: "#1d1d2a", tagColor: "#6b6b7a", border: "#2a2a3d", bg: "#1a1a25" },
    addrOnColor: "#9cc0f5",
    addrOnBg: "rgba(59,130,246,.12)",
    addrOnBorder: "rgba(59,130,246,.4)",
    addrOffBg: "#16161f",
    addrOffBorder: "#2a2a3d",
    postures: WEST_POSTURES,
    compute: computeWest,
    bigStat: (m) => {
      const a = mn(m, "appr");
      return {
        value: a,
        tier: a >= 55 ? "STRONG" : a >= 45 ? "MIXED" : a >= 35 ? "UNDERWATER" : "CRISIS",
        color: a >= 55 ? "#86d978" : a >= 45 ? "#9cc0f5" : a >= 35 ? "#eab308" : "#ff5a3c",
        bg: `rgba(${a >= 45 ? "59,130,246" : "255,90,60"},.08)`,
        border: `rgba(${a >= 45 ? "59,130,246" : "255,90,60"},.35)`,
      };
    },
    strip: (m, defcon, pc) => {
      const misery = mn(m, "misery");
      return [
        {
          label: "MISERY INDEX",
          value: String(misery),
          color: misery >= 30 ? "#ff5a3c" : misery >= 22 ? "#eab308" : "#86d978",
          sub: "inflation + unemployment",
        },
        {
          label: "DEFENSE BURDEN",
          value: m.burden,
          suffix: "% GDP",
          color: "#f3f1ea",
          sub: "set by appropriations",
        },
        { label: "PUBLIC MOOD", value: m.mood, color: m.moodColor, sub: `at DEFCON ${defcon}` },
        {
          label: "POLITICAL CAPITAL",
          value: String(pc),
          color: pcColor(pc),
          sub: "to spend at home or abroad",
        },
      ];
    },
    factions: (m) => [
      {
        name: "🦅 HAWKS · defense bloc",
        val: mn(m, "hawk"),
        color: "#ff9d7a",
        note: fnoteWest(mn(m, "hawk")),
      },
      {
        name: "🕊️ DOVES · peace bloc",
        val: mn(m, "dove"),
        color: "#86d978",
        note: fnoteWest(mn(m, "dove")),
      },
      {
        name: "🌾 HEARTLAND · pocketbook",
        val: mn(m, "heart"),
        color: "#9cc0f5",
        note: fnoteWest(mn(m, "heart")),
      },
    ],
    headlines: (active, defcon, m) => {
      const h: Headline[] = [];
      if (active.coups)
        h.push({
          src: "WASHINGTON POST",
          c: "#ef8a8a",
          t: "— Senate opens hearings into agency coup plots abroad.",
        });
      if (active.detente)
        h.push({
          src: "NYT",
          c: "#86d978",
          t: "— SALT II signing buoys hopes for a thaw; hawks dissent.",
        });
      if (active.hardline)
        h.push({
          src: "CHICAGO TRIB",
          c: "#ff9d7a",
          t: '— President vows to "rearm America"; defense stocks rally.',
        });
      if (active.firewall)
        h.push({
          src: "WSJ",
          c: "#d9bd6b",
          t: "— Trade barriers with the East squeeze farm-belt exporters.",
        });
      if (defcon <= 2)
        h.push({
          src: "AP WIRE",
          c: "#ff5a3c",
          t: "— Public on edge as forces go to heightened alert; rally-round-the-flag bump in polls.",
        });
      if (mn(m, "misery") >= 30)
        h.push({
          src: "TIME",
          c: "#eab308",
          t: '— "Malaise": stagflation grinds on as the misery index climbs.',
        });
      if (h.length === 0)
        h.push({
          src: "THE HILL",
          c: "#9cc0f5",
          t: "— A quiet week in Washington; the President holds steady.",
        });
      return h;
    },
    pageBg: "radial-gradient(120% 80% at 50% 0%,#15171d,#0b0b11 60%)",
    cardBg: "#14141c",
    cardBorder: "#2a2a3d",
    stripBg: "repeating-linear-gradient(45deg,#101620,#101620 10px,#0d1118 10px,#0d1118 20px)",
    stripBorder: "#1c2630",
    stripLeftColor: "#6fa8dc",
    stripLeftText: "◆ THE WHITE HOUSE · DOMESTIC POLITICAL BRIEF",
    stripRightColor: "#566776",
    stripRightText: "UNITED STATES · 96th CONGRESS",
    headerLabelColor: "#6b6b7a",
    metricStripBorder: "#2a2a3d",
    stripLabelColor: "#6b6b7a",
    stripSubColor: "#7a7a8c",
    panelBorder: "#2a2a3d",
    panelBg: "#11111a",
    actionsBg: "#16161f",
    factionLabelColor: "#6b6b7a",
    factionTrackBorder: "#23232f",
    factionNoteColor: "#7a7a8c",
    resetBg: "#14141c",
    resetBorder: "#2a2a3d",
    cablesBorder: "#2a2416",
    cablesBg: "#0a0906",
    cablesDashTop: "#4a3f1e",
    cablesRowDash: "#211c0e",
    cablesLabelColor: "#ffc14d",
  },
  east: {
    pcKey: "ahd_east_pc",
    title: "The Politburo",
    intro:
      "There are no elections here — only the Party. Your readiness alerts, the Afghan war, détente, and the cost of propping up the satellites all play out inside the Politburo, where confidence is power and the loss of it is a one-way trip.",
    headerLabel: "THE HOME FRONT · THE POLITICS OF THE PARTY",
    bigStatLabel: "POLITBURO CONFIDENCE",
    postureTitle: "▮ FOREIGN POLICY → THE PARTY",
    postureTitleColor: "#ef8a8a",
    postureSub: "toggle a line to see how it plays inside the Politburo",
    coalitionTitle: "THE POLITBURO",
    actionsTitle: "GENERAL SECRETARY'S ACTIONS",
    addressLabel: "🎙 ADDRESS THE PARTY CONGRESS · 8 PC",
    addressErr: "Not enough Party capital to convene the Congress (8 PC).",
    addressOk:
      "Address to the Party Congress delivered — a show of unity rallies the Central Committee. −8 PC.",
    headlinesLabel: "▌PRAVDA · ИЗВЕСТИЯ",
    headlineTextColor: "#cf9aa2",
    postureActive: {
      tagBg: "rgba(220,38,38,.16)",
      tagColor: "#ef8a8a",
      border: "rgba(220,38,38,.4)",
      bg: "rgba(220,38,38,.06)",
    },
    postureInactive: { tagBg: "#1d1320", tagColor: "#8a5a66", border: "#3a2030", bg: "#1a0f14" },
    addrOnColor: "#f0a0a0",
    addrOnBg: "rgba(220,38,38,.12)",
    addrOnBorder: "rgba(220,38,38,.4)",
    addrOffBg: "#16121a",
    addrOffBorder: "#3a2030",
    postures: EAST_POSTURES,
    compute: computeEast,
    bigStat: (m) => {
      const c = mn(m, "conf");
      return {
        value: c,
        tier: c >= 55 ? "SECURE" : c >= 45 ? "CONTESTED" : c >= 35 ? "VULNERABLE" : "PURGE RISK",
        color: c >= 55 ? "#86d978" : c >= 45 ? "#cf9aa2" : c >= 35 ? "#eab308" : "#ff5a3c",
        bg: `rgba(${c >= 45 ? "134,217,120" : "255,90,60"},.08)`,
        border: `rgba(${c >= 45 ? "134,217,120" : "255,90,60"},.35)`,
      };
    },
    strip: (m, defcon, pc) => {
      const plan = mn(m, "plan");
      const short = mn(m, "short");
      return [
        {
          label: "FIVE-YEAR PLAN",
          value: String(plan),
          suffix: "%",
          color: plan >= 92 ? "#86d978" : plan >= 80 ? "#eab308" : "#ff5a3c",
          sub: "plan fulfillment",
        },
        {
          label: "CONSUMER SHORTAGES",
          value: String(short),
          color: short >= 36 ? "#ff5a3c" : short >= 28 ? "#eab308" : "#86d978",
          sub: "queues & deficits",
        },
        {
          label: "DEFENSE BURDEN",
          value: m.burden,
          suffix: "% GDP",
          color: "#f3f1ea",
          sub: "set by Gosplan",
        },
        { label: "PUBLIC MOOD", value: m.mood, color: m.moodColor, sub: `at DEFCON ${defcon}` },
        { label: "PARTY CAPITAL", value: String(pc), color: pcColor(pc), sub: "political capital" },
      ];
    },
    factions: (m) => [
      {
        name: "🎖️ HARDLINERS · army & KGB",
        val: mn(m, "hard"),
        color: "#ff9d7a",
        note: fnoteEast(mn(m, "hard")),
      },
      {
        name: "📈 REFORMERS · technocrats",
        val: mn(m, "ref"),
        color: "#86d978",
        note: fnoteEast(mn(m, "ref")),
      },
      {
        name: "🏛️ APPARATUS · nomenklatura",
        val: mn(m, "app"),
        color: "#cf9aa2",
        note: fnoteEast(mn(m, "app")),
      },
    ],
    headlines: (active, defcon, m) => {
      const h: Headline[] = [];
      if (active.covert)
        h.push({
          src: "РАДИО СВОБОДА",
          c: "#ef8a8a",
          t: "— foreign broadcasts trumpet an embarrassing intelligence failure.",
        });
      if (active.detente)
        h.push({
          src: "PRAVDA",
          c: "#86d978",
          t: '— "Peace offensive": SALT II hailed as a triumph of socialist diplomacy.',
        });
      if (active.hardline)
        h.push({
          src: "KRASNAYA ZVEZDA",
          c: "#ff9d7a",
          t: "— the Red Army stands ready to defend socialism against imperialist provocation.",
        });
      if (active.afghan)
        h.push({
          src: "(samizdat)",
          c: "#d9bd6b",
          t: '— quiet murmurs about the cost of the "international duty" in Afghanistan.',
        });
      if (active.subsidies)
        h.push({
          src: "GOSPLAN MEMO",
          c: "#d9bd6b",
          t: "— subsidies to fraternal states strain the consumer-goods quota again.",
        });
      if (defcon <= 2)
        h.push({
          src: "TASS",
          c: "#ff5a3c",
          t: "— nation rallies as forces reach heightened alert; the Party closes ranks.",
        });
      if (mn(m, "short") >= 36)
        h.push({
          src: "(rumor)",
          c: "#eab308",
          t: "— bread queues lengthen in the provinces; grumbling grows.",
        });
      if (h.length === 0)
        h.push({
          src: "PRAVDA",
          c: "#cf9aa2",
          t: "— the Party marches forward, united behind the General Secretary.",
        });
      return h;
    },
    pageBg: "radial-gradient(120% 80% at 50% 0%,#1d1316,#0b0b11 60%)",
    cardBg: "#14111a",
    cardBorder: "#3a2030",
    stripBg: "repeating-linear-gradient(45deg,#2a1014,#2a1014 10px,#220d11 10px,#220d11 20px)",
    stripBorder: "#3a1620",
    stripLeftColor: "#ef8a8a",
    stripLeftText: "☭ THE KREMLIN · POLITBURO STANDING REPORT",
    stripRightColor: "#8a5a66",
    stripRightText: "USSR · CENTRAL COMMITTEE",
    headerLabelColor: "#8a5a66",
    metricStripBorder: "#3a2030",
    stripLabelColor: "#8a5a66",
    stripSubColor: "#7a6a72",
    panelBorder: "#3a2030",
    panelBg: "#1a0f14",
    actionsBg: "#1a0f14",
    factionLabelColor: "#8a5a66",
    factionTrackBorder: "#2a1620",
    factionNoteColor: "#7a6a72",
    resetBg: "#14111a",
    resetBorder: "#3a2030",
    cablesBorder: "#2a1620",
    cablesBg: "#0a0608",
    cablesDashTop: "#4a2630",
    cablesRowDash: "#1c1014",
    cablesLabelColor: "#ef8a8a",
  },
};
