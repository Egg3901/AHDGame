import type { CountryId } from "@/lib/constants/countries";

/**
 * Per-country configuration for the shared executive shell (instrument strip
 * clock, acts-ledger chip labels, roster naming, hero) — the act-map
 * indirection locked at design review: the same components render every
 * country, with all variation flowing through this table.
 *
 * Term limits are NOT configured here — the badge reads the existing SSOT
 * (`getExecutiveTermLimit` / `getExecutiveTermsServed` in
 * lib/elections/executiveTermLimits.ts).
 */

export interface ExecutiveClockConfig {
  /** election = countdown to the next executive-relevant election; plenum = legislature session. */
  kind: "election" | "plenum";
  label: string;
  /** Noun for the countdown subline (e.g. "election", "next NPC session"). */
  countdownNoun: string;
}

export type ExecutiveActKind = "signed" | "vetoed" | "onDesk" | "order" | "confirmed" | "nominated";

export interface ExecutiveSurfaceConfig {
  clock: ExecutiveClockConfig;
  /** Ledger chip labels per act kind (US SIGNED ↔ CN ENACTED, EX. ORDER ↔ DIRECTIVE …). */
  actLabels: Record<ExecutiveActKind, string>;
  /** Whether instrument tile 3 counts bills on the desk or orders in force. */
  deskKind: "bills" | "orders";
  deskLabel: string;
  rosterTitle: string;
  heroImage: string;
  heroAlt: string;
}

const PRESIDENTIAL_ACTS: Record<ExecutiveActKind, string> = {
  signed: "SIGNED",
  vetoed: "VETOED",
  onDesk: "ON DESK",
  order: "EX. ORDER",
  confirmed: "CONFIRMED",
  nominated: "NOMINATED",
};

const PARLIAMENTARY_ACTS: Record<ExecutiveActKind, string> = {
  signed: "ENACTED",
  vetoed: "REJECTED",
  onDesk: "AWAITING",
  order: "ORDER",
  confirmed: "APPOINTED",
  nominated: "NOMINATED",
};

const EXECUTIVE_SURFACE: Record<CountryId, ExecutiveSurfaceConfig> = {
  US: {
    clock: { kind: "election", label: "Term Clock", countdownNoun: "election" },
    actLabels: PRESIDENTIAL_ACTS,
    deskKind: "bills",
    deskLabel: "The Desk",
    rosterTitle: "Cabinet",
    heroImage: "/api/images/hero/white-house",
    heroAlt: "The White House, Washington D.C.",
  },
  UK: {
    clock: { kind: "election", label: "Term Clock", countdownNoun: "next general election" },
    actLabels: { ...PARLIAMENTARY_ACTS, order: "ORDER IN COUNCIL" },
    deskKind: "orders",
    deskLabel: "Orders in Force",
    rosterTitle: "Cabinet",
    heroImage: "/api/images/hero/downing-street",
    heroAlt: "10 Downing Street, London",
  },
  DE: {
    clock: { kind: "election", label: "Term Clock", countdownNoun: "next federal election" },
    actLabels: PARLIAMENTARY_ACTS,
    deskKind: "orders",
    deskLabel: "Orders in Force",
    rosterTitle: "Cabinet",
    heroImage: "/api/images/hero/reichstag",
    heroAlt: "Reichstag building, Berlin",
  },
  JP: {
    clock: { kind: "election", label: "Term Clock", countdownNoun: "next general election" },
    actLabels: PARLIAMENTARY_ACTS,
    deskKind: "orders",
    deskLabel: "Orders in Force",
    rosterTitle: "Cabinet",
    heroImage: "/api/images/hero/kantei",
    heroAlt: "Prime Minister's Official Residence, Tokyo",
  },
  IE: {
    clock: { kind: "election", label: "Term Clock", countdownNoun: "next general election" },
    actLabels: PARLIAMENTARY_ACTS,
    deskKind: "orders",
    deskLabel: "Orders in Force",
    rosterTitle: "Cabinet",
    heroImage: "/api/images/hero/government-buildings-dublin",
    heroAlt: "Government Buildings, Dublin",
  },
  CN: {
    clock: { kind: "plenum", label: "Plenum Clock", countdownNoun: "next NPC session" },
    actLabels: { ...PARLIAMENTARY_ACTS, order: "DIRECTIVE" },
    deskKind: "orders",
    deskLabel: "Directives",
    rosterTitle: "State Council",
    heroImage: "/api/images/hero/zhongnanhai",
    heroAlt: "Zhongnanhai, Beijing",
  },
  BR: {
    clock: { kind: "election", label: "Term Clock", countdownNoun: "election" },
    actLabels: PRESIDENTIAL_ACTS,
    deskKind: "bills",
    deskLabel: "The Desk",
    rosterTitle: "Cabinet",
    heroImage: "/api/images/hero/palacio-do-planalto",
    heroAlt: "Palácio do Planalto, Brasília",
  },
  NG: {
    clock: { kind: "election", label: "Term Clock", countdownNoun: "election" },
    actLabels: PRESIDENTIAL_ACTS,
    deskKind: "bills",
    deskLabel: "The Desk",
    rosterTitle: "Cabinet",
    heroImage: "/api/images/hero/aso-rock",
    heroAlt: "Aso Rock Presidential Villa, Abuja",
  },
  // Hungary — one-party state, mirrors CN's plenum/directive surface.
  HU: {
    clock: { kind: "plenum", label: "Plenum Clock", countdownNoun: "next Assembly session" },
    actLabels: { ...PARLIAMENTARY_ACTS, order: "DIRECTIVE" },
    deskKind: "orders",
    deskLabel: "Directives",
    rosterTitle: "Council of Ministers",
    heroImage: "/api/images/hero/hungarian-parliament",
    heroAlt: "Hungarian Parliament Building, Budapest",
  },
  PL: {
    clock: { kind: "plenum", label: "Plenum Clock", countdownNoun: "next Sejm session" },
    actLabels: { ...PARLIAMENTARY_ACTS, order: "DIRECTIVE" },
    deskKind: "orders",
    deskLabel: "Directives",
    rosterTitle: "Council of Ministers",
    heroImage: "/api/images/hero/poland",
    heroAlt: "Sejm, Warsaw",
  },
  RO: {
    clock: { kind: "plenum", label: "Plenum Clock", countdownNoun: "next Assembly session" },
    actLabels: { ...PARLIAMENTARY_ACTS, order: "DIRECTIVE" },
    deskKind: "orders",
    deskLabel: "Directives",
    rosterTitle: "Council of Ministers",
    heroImage: "/api/images/hero/romania",
    heroAlt: "Grand National Assembly, Bucharest",
  },
  YU: {
    clock: { kind: "plenum", label: "Plenum Clock", countdownNoun: "next Assembly session" },
    actLabels: { ...PARLIAMENTARY_ACTS, order: "DIRECTIVE" },
    deskKind: "orders",
    deskLabel: "Directives",
    rosterTitle: "Federal Executive Council",
    heroImage: "/api/images/hero/yugoslavia",
    heroAlt: "Federal Assembly, Belgrade",
  },
  BG: {
    clock: { kind: "plenum", label: "Plenum Clock", countdownNoun: "next Assembly session" },
    actLabels: { ...PARLIAMENTARY_ACTS, order: "DIRECTIVE" },
    deskKind: "orders",
    deskLabel: "Directives",
    rosterTitle: "Council of Ministers",
    heroImage: "/api/images/hero/bulgaria",
    heroAlt: "National Assembly, Sofia",
  },
  BLR: {
    clock: { kind: "plenum", label: "Plenum Clock", countdownNoun: "next Soviet session" },
    actLabels: { ...PARLIAMENTARY_ACTS, order: "DIRECTIVE" },
    deskKind: "orders",
    deskLabel: "Directives",
    rosterTitle: "Council of Ministers",
    heroImage: "/api/images/hero/belarus",
    heroAlt: "Supreme Soviet, Minsk",
  },
  UKR: {
    clock: { kind: "plenum", label: "Plenum Clock", countdownNoun: "next Soviet session" },
    actLabels: { ...PARLIAMENTARY_ACTS, order: "DIRECTIVE" },
    deskKind: "orders",
    deskLabel: "Directives",
    rosterTitle: "Council of Ministers",
    heroImage: "/api/images/hero/ukraine",
    heroAlt: "Supreme Soviet, Kyiv",
  },
  CS: {
    clock: { kind: "plenum", label: "Plenum Clock", countdownNoun: "next Assembly session" },
    actLabels: { ...PARLIAMENTARY_ACTS, order: "DIRECTIVE" },
    deskKind: "orders",
    deskLabel: "Directives",
    rosterTitle: "Federal Government",
    heroImage: "/api/images/hero/czechoslovakia",
    heroAlt: "Federal Assembly, Prague",
  },
  BAL: {
    clock: { kind: "plenum", label: "Plenum Clock", countdownNoun: "next Soviet session" },
    actLabels: { ...PARLIAMENTARY_ACTS, order: "DIRECTIVE" },
    deskKind: "orders",
    deskLabel: "Directives",
    rosterTitle: "Councils of Ministers",
    heroImage: "/api/images/hero/baltics",
    heroAlt: "Supreme Soviet, Riga",
  },
  RU: {
    clock: { kind: "plenum", label: "Plenum Clock", countdownNoun: "next Supreme Soviet session" },
    actLabels: { ...PARLIAMENTARY_ACTS, order: "DECREE" },
    deskKind: "orders",
    deskLabel: "Decrees",
    rosterTitle: "Council of Ministers",
    heroImage: "/api/images/hero/kremlin",
    heroAlt: "The Kremlin, Moscow",
  },
  FR: {
    clock: { kind: "election", label: "Term Clock", countdownNoun: "presidential election" },
    actLabels: { ...PRESIDENTIAL_ACTS, order: "DECREE" },
    deskKind: "bills",
    deskLabel: "The Desk",
    rosterTitle: "Government",
    heroImage: "/api/images/hero/elysee",
    heroAlt: "Élysée Palace, Paris",
  },
  IT: {
    clock: { kind: "election", label: "Term Clock", countdownNoun: "next general election" },
    actLabels: PARLIAMENTARY_ACTS,
    deskKind: "orders",
    deskLabel: "Orders in Force",
    rosterTitle: "Council of Ministers",
    heroImage: "/api/images/hero/palazzo-chigi",
    heroAlt: "Palazzo Chigi, Rome",
  },
  ES: {
    clock: { kind: "election", label: "Term Clock", countdownNoun: "next general election" },
    actLabels: PARLIAMENTARY_ACTS,
    deskKind: "bills",
    deskLabel: "The Desk",
    rosterTitle: "Council of Ministers",
    heroImage: "/api/images/hero/moncloa",
    heroAlt: "Palacio de la Moncloa, Madrid",
  },
  SE: {
    clock: { kind: "election", label: "Term Clock", countdownNoun: "next general election" },
    actLabels: PARLIAMENTARY_ACTS,
    deskKind: "bills",
    deskLabel: "The Desk",
    rosterTitle: "Cabinet",
    heroImage: "/api/images/hero/rosenbad",
    heroAlt: "Rosenbad, Stockholm",
  },
  TR: {
    clock: { kind: "election", label: "Term Clock", countdownNoun: "next general election" },
    actLabels: PARLIAMENTARY_ACTS,
    deskKind: "bills",
    deskLabel: "The Desk",
    rosterTitle: "Council of Ministers",
    heroImage: "/api/images/hero/cankaya",
    heroAlt: "Çankaya Mansion, Ankara",
  },
  GR: {
    clock: { kind: "election", label: "Term Clock", countdownNoun: "next general election" },
    actLabels: PARLIAMENTARY_ACTS,
    deskKind: "orders",
    deskLabel: "Orders in Force",
    rosterTitle: "Cabinet",
    heroImage: "/api/images/hero/maximos-mansion",
    heroAlt: "Maximos Mansion, Athens",
  },
  AT: {
    clock: { kind: "election", label: "Term Clock", countdownNoun: "next general election" },
    actLabels: PARLIAMENTARY_ACTS,
    deskKind: "orders",
    deskLabel: "Orders in Force",
    rosterTitle: "Council of Ministers",
    heroImage: "/api/images/hero/ballhausplatz",
    heroAlt: "Federal Chancellery at Ballhausplatz, Vienna",
  },
  FI: {
    clock: { kind: "election", label: "Term Clock", countdownNoun: "next general election" },
    actLabels: PARLIAMENTARY_ACTS,
    deskKind: "orders",
    deskLabel: "Orders in Force",
    rosterTitle: "Council of State",
    heroImage: "/api/images/hero/government-palace-helsinki",
    heroAlt: "Government Palace, Helsinki",
  },
  DD: {
    clock: { kind: "plenum", label: "Plenum Clock", countdownNoun: "next Volkskammer session" },
    actLabels: { ...PARLIAMENTARY_ACTS, order: "DECREE" },
    deskKind: "orders",
    deskLabel: "Decrees",
    rosterTitle: "Council of Ministers",
    // Seat of the Council of Ministers — the Palast der Republik (the
    // `volkskammer` hero slug) belongs to the legislature page.
    heroImage: "/api/images/hero/altes-stadthaus",
    heroAlt: "Altes Stadthaus, Berlin",
  },
  SCO: {
    clock: { kind: "election", label: "Term Clock", countdownNoun: "next Holyrood election" },
    actLabels: { ...PARLIAMENTARY_ACTS, order: "ORDER IN COUNCIL" },
    deskKind: "orders",
    deskLabel: "Orders in Force",
    rosterTitle: "Cabinet",
    heroImage: "/api/images/hero/bute-house",
    heroAlt: "Bute House, Edinburgh",
  },
  WAL: {
    clock: { kind: "election", label: "Term Clock", countdownNoun: "next Senedd election" },
    actLabels: { ...PARLIAMENTARY_ACTS, order: "ORDER IN COUNCIL" },
    deskKind: "orders",
    deskLabel: "Orders in Force",
    rosterTitle: "Cabinet",
    heroImage: "/api/images/hero/senedd",
    heroAlt: "Senedd, Cardiff",
  },
};

export function getExecutiveSurface(countryId: CountryId): ExecutiveSurfaceConfig {
  return EXECUTIVE_SURFACE[countryId] ?? EXECUTIVE_SURFACE.US;
}

/**
 * "TERM n OF x" badge for term-limited executives. Returns null when the
 * country has no term limit OR the current term is not known — the badge is
 * only rendered from real data, never fabricated.
 */
export function termClockBadge(
  termLimit: number | undefined,
  currentTerm: number | undefined
): { badge: string; subline: string } | null {
  if (!termLimit || !currentTerm) return null;
  return {
    badge: `TERM ${currentTerm} OF ${termLimit}`,
    subline: currentTerm >= termLimit ? "term-limited — cannot run again" : "eligible to run again",
  };
}
