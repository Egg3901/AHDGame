/**
 * Era-specific theme configs for the sandbox landing and login page.
 * Each era defines globe visual style, copy, seed access map, and nations list.
 */

import { tierFor, type ShippingPreset } from "@/lib/world/eraRoster";
import type { CountryId } from "@/lib/constants/countries";

export type EraId = "1953" | "1979" | "1991" | "1999" | "2007" | "2019" | "2023" | "2027";

export type EraAccess = {
  enabledForPlayers: boolean;
  economyPreview: boolean;
  status: "active" | "beta" | "coming-soon";
};

/** The seven bento tiles on the landing "halls of power" grid. */
export type EraTileKey =
  "stateMetrics" | "ballot" | "bills" | "industrial" | "markets" | "newsroom" | "centralBanks";

export type EraNation = {
  id: string;
  name: string;
  tier: "player" | "econ" | "npp";
};

export type EraConfig = {
  id: EraId;
  year: number;
  label: string;
  gameDate: string;
  /** Phosphor color for CRT wireframe mode. null = use enhanced ocean gradient. */
  wireframeColor: string | null;
  /** Tagline shown on the login page left panel. */
  loginTagline: string;
  heroHeadline: string;
  heroDek: string;
  primaryCta: string;
  secondaryCta: string;
  eraChips: string[];
  playSectionDek: string;
  /**
   * Per-tile body copy for the "halls of power" grid. Optional: anything left
   * out falls back to era-neutral copy in the landing page.
   *
   * These used to be hardcoded in the page with 1979 flavour baked in, so a
   * 1953 world advertised "the post-Watergate trust deficit" roughly two
   * decades before Watergate. Era colour belongs to the era config.
   */
  tileBodies?: Partial<Record<EraTileKey, string>>;
  /**
   * May contain `{playableCount}` where the number of open countries belongs.
   * Every one of these strings used to spell the count out by hand, so a
   * country opening silently made seven pieces of copy wrong at once. Resolve
   * with `resolveEraCopy` from `lib/marketing/marketedWorld`.
   */
  worldSectionDek: string;
  closingHeadline: string;
  closingDek: string;
  closingCta: string;
  footerTagline: string;
  accessMap: Record<string, EraAccess>;
  nations: EraNation[];
};

/**
 * A curated roster entry: the display NAME and the order it appears in.
 *
 * The tier is no longer written here. It is derived from `ERA_ROSTER`, because
 * this file and the world-entity manifest used to disagree — the 1991 landing
 * page advertised Germany as playable while the manifest had it economy-only.
 * Names and ordering stay authored; access does not.
 */
const n = (id: string, name: string): { id: string; name: string } => ({ id, name });

const PLAYER: EraAccess = { enabledForPlayers: true, economyPreview: false, status: "active" };
const ECON: EraAccess = { enabledForPlayers: false, economyPreview: true, status: "beta" };
const NPP: EraAccess = { enabledForPlayers: false, economyPreview: false, status: "coming-soon" };

/** Access map for the curated roster, straight from `tierFor`. */
function accessFor(
  preset: ShippingPreset,
  curated: ReadonlyArray<{ id: string }>
): Record<string, EraAccess> {
  const out: Record<string, EraAccess> = {};
  for (const { id } of curated) {
    const tier = tierFor(preset, id as CountryId);
    if (tier === "player") out[id] = PLAYER;
    else if (tier === "econ") out[id] = ECON;
    else if (tier === "npp") out[id] = NPP;
    // `latent` and `absent` are not shown on the landing page at all.
  }
  return out;
}

/** Display roster: curated name and order, derived tier, absent countries dropped. */
function nationsFor(
  preset: ShippingPreset,
  curated: ReadonlyArray<{ id: string; name: string }>
): EraNation[] {
  const out: EraNation[] = [];
  for (const { id, name } of curated) {
    const tier = tierFor(preset, id as CountryId);
    if (tier === "player" || tier === "econ" || tier === "npp") out.push({ id, name, tier });
  }
  return out;
}

/** Curated display roster for 1953: name and order only; tier is derived. */
const NATIONS_1953 = [
  n("US", "United States"),
  n("UK", "United Kingdom"),
  n("RU", "Soviet Union"),
  n("DE", "West Germany"),
  n("JP", "Japan"),
  n("IT", "Italy"),
  n("FR", "France"),
  n("CN", "China"),
  n("DD", "East Germany"),
] as const;

/** Curated display roster for 1979: name and order only; tier is derived. */
const NATIONS_1979 = [
  n("US", "United States"),
  n("UK", "United Kingdom"),
  n("RU", "Soviet Union"),
  n("FR", "France"),
  n("IT", "Italy"),
  n("ES", "Spain"),
  n("SE", "Sweden"),
  n("TR", "Turkey"),
  n("GR", "Greece"),
  n("AT", "Austria"),
  n("FI", "Finland"),
  n("DE", "West Germany"),
  n("JP", "Japan"),
  n("CN", "China"),
  n("BR", "Brazil"),
  n("IE", "Ireland"),
  n("DD", "East Germany"),
  n("PL", "Poland"),
  n("RO", "Romania"),
  n("YU", "Yugoslavia"),
  n("HU", "Hungary"),
  n("CS", "Czechoslovakia"),
  n("BG", "Bulgaria"),
  n("UKR", "Ukraine"),
  n("BLR", "Belarus"),
  n("BAL", "Baltic Republics"),
] as const;

/** Curated display roster for 1991: name and order only; tier is derived. */
const NATIONS_1991 = [
  n("US", "United States"),
  n("UK", "United Kingdom"),
  n("DE", "Germany"),
  n("RU", "Russia"),
  n("FR", "France"),
  n("JP", "Japan"),
  n("CN", "China"),
  n("PL", "Poland"),
  n("CS", "Czechoslovakia"),
  n("HU", "Hungary"),
  n("RO", "Romania"),
] as const;

/** Curated display roster for 1999: name and order only; tier is derived. */
const NATIONS_1999 = [
  n("US", "United States"),
  n("UK", "United Kingdom"),
  n("DE", "Germany"),
  n("FR", "France"),
  n("JP", "Japan"),
  n("CN", "China"),
  n("IT", "Italy"),
  n("RU", "Russia"),
] as const;

/** Curated display roster for 2007: name and order only; tier is derived. */
const NATIONS_2007 = [
  n("US", "United States"),
  n("UK", "United Kingdom"),
  n("DE", "Germany"),
  n("FR", "France"),
  n("JP", "Japan"),
  n("CN", "China"),
  n("BR", "Brazil"),
  n("IN", "India"),
  n("RU", "Russia"),
] as const;

/** Curated display roster for 2019: name and order only; tier is derived. */
const NATIONS_2019 = [
  n("US", "United States"),
  n("UK", "United Kingdom"),
  n("DE", "Germany"),
  n("FR", "France"),
  n("JP", "Japan"),
  n("CN", "China"),
  n("BR", "Brazil"),
  n("IN", "India"),
  n("RU", "Russia"),
] as const;

/** Curated display roster for 2023: name and order only; tier is derived. */
const NATIONS_2023 = [
  n("US", "United States"),
  n("UK", "United Kingdom"),
  n("DE", "Germany"),
  n("FR", "France"),
  n("JP", "Japan"),
  n("CN", "China"),
  n("BR", "Brazil"),
  n("IN", "India"),
  n("RU", "Russia"),
] as const;

/**
 * Curated display roster for 2027: identical to 2023's, because the list is
 * name and ORDER only.
 *
 * Upstream authored 2027 with per-nation tiers baked in (`P`/`E`/`N`). This
 * branch derives the tier from `ERA_ROSTER` instead, so hard-coding one here
 * would give the landing page a second opinion about who is playable -- and the
 * landing page disagreeing with the world is the drift this roster removed.
 */
const NATIONS_2027 = NATIONS_2023;

export const ERA_CONFIGS: Record<EraId, EraConfig> = {
  "1953": {
    id: "1953",
    year: 1953,
    label: "Korean War · 1953",
    gameDate: "July 1953",
    wireframeColor: "#00e676",
    loginTagline:
      '"Every gun that is made, every warship launched, every rocket fired signifies, in the final sense, a theft from those who hunger and are not fed." — Dwight D. Eisenhower, "Chance for Peace" speech, April 1953',
    heroHeadline: "A political simulation set in 1953.",
    heroDek:
      "The Korean War draws to a close. Stalin is dead and the Soviet succession is unsettled. Every real hour is a game week. Navigate the first decade of the Cold War.",
    primaryCta: "Start playing",
    secondaryCta: "Explore the map",
    eraChips: [
      "Korean War",
      "Stalin's Death",
      "Early Cold War",
      "Nuclear Age",
      "Decolonization",
      "Marshall Plan",
    ],
    playSectionDek: "Build your party, contest elections, and shape post-war domestic policy.",
    tileBodies: {
      stateMetrics:
        "Track demographics, unemployment, and the loyalty tests an early Cold War electorate applies to every incumbent.",
      bills:
        "Draft bills, whip votes, and trade amendments across a New Deal coalition at its height.",
      industrial:
        "Found corporations and pay dividends from a post-war manufacturing boom that is only just getting started.",
      markets:
        "Trade commodities and currencies under Bretton Woods, where the peg is the whole argument.",
      centralBanks:
        "Set the prime rate and manage a line of credit inside a fixed-exchange-rate system.",
    },
    worldSectionDek:
      "A handful of nations in 1953. {playableCount} are open to players. The rest run their own economies and one-party machines. Drag the globe to explore.",
    closingHeadline: "The post-war order is still being written.",
    closingDek: "Pick a country, pick a role. The simulation runs whether you're in it or not.",
    closingCta: "Get started",
    footerTagline: "Persistent simulation. Multiple nations. No resets.",
    accessMap: accessFor("1953-default", NATIONS_1953),
    nations: nationsFor("1953-default", NATIONS_1953),
  },

  "1979": {
    id: "1979",
    year: 1979,
    label: "Cold War · 1979",
    gameDate: "April 1979",
    wireframeColor: "#00e676",
    loginTagline: '"Events, dear boy, events." — Harold Macmillan',
    heroHeadline: "A political simulation set in 1979.",
    heroDek:
      "Stagflation, oil shocks, and an ideological standoff. Every real hour is a game week. Play a nation, build a coalition, and see how the decade unfolds.",
    primaryCta: "Start playing",
    secondaryCta: "Explore the map",
    eraChips: [
      "Cold War",
      "Stagflation",
      "Oil Shock",
      "Iron Curtain",
      "Malaise",
      "Brezhnev Doctrine",
    ],
    playSectionDek: "Run for office, draft legislation, and manage the business of government.",
    tileBodies: {
      stateMetrics:
        "Track demographics, unemployment, and the post-Watergate trust deficit that haunts every incumbent.",
      bills:
        "Draft bills, whip votes, and trade amendments across the aisle of a fraying New Deal coalition.",
      industrial:
        "Found corporations and pay dividends from a manufacturing economy at its modern peak.",
      markets:
        "Trade commodities and currencies as central banks fight an inflation spiral neither can quite win.",
      centralBanks: "Set the prime rate and manage a line of credit while inflation runs hot.",
    },
    worldSectionDek:
      "Twenty-two nations in 1979. {playableCount} are open to players. The rest run their own economies and one-party machines. Drag the globe to explore.",
    closingHeadline: "22 nations. One timeline.",
    closingDek: "Pick a country, pick a role. The simulation runs whether you're in it or not.",
    closingCta: "Get started",
    footerTagline: "Persistent simulation. 22 nations. No resets.",
    accessMap: accessFor("1979-default", NATIONS_1979),
    nations: nationsFor("1979-default", NATIONS_1979),
  },

  "1991": {
    id: "1991",
    year: 1991,
    label: "Post-Cold War · 1991",
    gameDate: "December 1991",
    wireframeColor: null,
    loginTagline:
      '"The end of the Cold War is a victory for mankind, not for any one country." — Mikhail Gorbachev',
    heroHeadline: "A House Divided Beta - 1991",
    heroDek:
      "The Soviet Union has dissolved. A unipolar moment emerges, but the new order is unsteady. Every real hour is a game week. Navigate the transition.",
    primaryCta: "Start playing",
    secondaryCta: "Explore the map",
    eraChips: [
      "Soviet Collapse",
      "New World Order",
      "Gulf War",
      "German Reunification",
      "Transition Economies",
      "NATO Expansion",
    ],
    playSectionDek:
      "Manage a post-Cold War economy, contest elections, and navigate a world in rapid transition.",
    worldSectionDek:
      "Nations redrawn by history. {playableCount} are open to players. The rest run their own economies through the turbulence of transition. Drag the globe to explore.",
    closingHeadline: "The map just changed. What comes next is up to you.",
    closingDek: "Pick a country, pick a role. The simulation runs whether you're in it or not.",
    closingCta: "Get started",
    footerTagline: "Persistent simulation. Multiple nations. No resets.",
    accessMap: accessFor("1991-default", NATIONS_1991),
    nations: nationsFor("1991-default", NATIONS_1991),
  },

  "1999": {
    id: "1999",
    year: 1999,
    label: "Fin de Siècle · 1999",
    gameDate: "January 1999",
    wireframeColor: null,
    loginTagline: "A political simulation set in 1999.",
    heroHeadline: "A political simulation set in 1999.",
    heroDek:
      "The internet is transforming economies. The euro launches. The dot-com bubble is inflating. Every real hour is a game week. Govern at the end of a century.",
    primaryCta: "Start playing",
    secondaryCta: "Explore the map",
    eraChips: ["Y2K", "Dot-Com Boom", "Euro Launch", "Kosovo", "WTO Protests", "Third Way"],
    playSectionDek:
      "Manage a booming economy, navigate a tech revolution, and set policy for a new millennium.",
    worldSectionDek:
      "Nations navigating prosperity and instability in equal measure. {playableCount} are open to players. The rest run their own economies. Drag the globe to explore.",
    closingHeadline: "A new century starts in twelve months.",
    closingDek: "Pick a country, pick a role. The simulation runs whether you're in it or not.",
    closingCta: "Get started",
    footerTagline: "Persistent simulation. Multiple nations. No resets.",
    accessMap: accessFor("1999-default", NATIONS_1999),
    nations: nationsFor("1999-default", NATIONS_1999),
  },

  "2007": {
    id: "2007",
    year: 2007,
    label: "Pre-Crisis · 2007",
    gameDate: "January 2007",
    wireframeColor: null,
    loginTagline: "A political simulation set in 2007.",
    heroHeadline: "A political simulation set in 2007.",
    heroDek:
      "Credit is cheap and leverage is high. The housing market shows cracks. Iraq and Afghanistan grind on. Every real hour is a game week. Govern before the storm.",
    primaryCta: "Start playing",
    secondaryCta: "Explore the map",
    eraChips: [
      "Credit Bubble",
      "Iraq War",
      "BRICs Rise",
      "iPhone Launch",
      "Climate Debate",
      "Energy Security",
    ],
    playSectionDek:
      "Manage an overleveraged economy, contest a polarized electorate, and navigate a shifting geopolitical order.",
    worldSectionDek:
      "A multipolar world in 2007. {playableCount} nations are open to players. The rest run their own economies and politics. Drag the globe to explore.",
    closingHeadline: "The crash hasn't happened yet.",
    closingDek: "Pick a country, pick a role. The simulation runs whether you're in it or not.",
    closingCta: "Get started",
    footerTagline: "Persistent simulation. Multiple nations. No resets.",
    accessMap: accessFor("2007-default", NATIONS_2007),
    nations: nationsFor("2007-default", NATIONS_2007),
  },

  "2019": {
    id: "2019",
    year: 2019,
    label: "Populist Wave · 2019",
    gameDate: "January 2019",
    wireframeColor: null,
    loginTagline: "A political simulation set in 2019.",
    heroHeadline: "A political simulation set in 2019.",
    heroDek:
      "Brexit is unresolved. Trade wars are accelerating. Populist movements are reshaping domestic politics across the democratic world. Every real hour is a game week.",
    primaryCta: "Start playing",
    secondaryCta: "Explore the map",
    eraChips: ["Brexit", "Trade War", "Populism", "Climate Crisis", "Social Media", "Hong Kong"],
    playSectionDek:
      "Navigate polarized electorates, manage trade policy, and govern in an era of institutional distrust.",
    worldSectionDek:
      "A fractured international order in 2019. {playableCount} nations are open to players. The rest run their own economies and politics. Drag the globe to explore.",
    closingHeadline: "Institutions are under pressure everywhere.",
    closingDek: "Pick a country, pick a role. The simulation runs whether you're in it or not.",
    closingCta: "Get started",
    footerTagline: "Persistent simulation. Multiple nations. No resets.",
    accessMap: accessFor("2019-default", NATIONS_2019),
    nations: nationsFor("2019-default", NATIONS_2019),
  },

  "2023": {
    id: "2023",
    year: 2023,
    label: "Current Era · 2023",
    gameDate: "January 2023",
    wireframeColor: null,
    loginTagline: "A political simulation set in 2023.",
    heroHeadline: "A political simulation set in 2023.",
    heroDek:
      "Inflation is cooling but hasn't broken. The Ukraine war has reshaped European security. AI is upending labor markets. Every real hour is a game week.",
    primaryCta: "Start playing",
    secondaryCta: "Explore the map",
    eraChips: [
      "AI Revolution",
      "Ukraine War",
      "Inflation",
      "De-Dollarization",
      "Green Transition",
      "Tech Regulation",
    ],
    playSectionDek:
      "Govern through an era of rapid technological change, geopolitical realignment, and fiscal pressure.",
    worldSectionDek:
      "A multipolar world in 2023. {playableCount} nations are open to players. The rest run their own economies and politics. Drag the globe to explore.",
    closingHeadline: "The decade is still being written.",
    closingDek: "Pick a country, pick a role. The simulation runs whether you're in it or not.",
    closingCta: "Get started",
    footerTagline: "Persistent simulation. Multiple nations. No resets.",
    accessMap: accessFor("2023-default", NATIONS_2023),
    nations: nationsFor("2023-default", NATIONS_2023),
  },
  "2027": {
    id: "2027",
    year: 2027,
    label: "Current Era · 2027",
    gameDate: "January 2027",
    wireframeColor: null,
    loginTagline: "A political simulation set in 2027.",
    heroHeadline: "A political simulation set in 2027.",
    heroDek:
      "Inflation is cooling but hasn't broken. The Ukraine war has reshaped European security. AI is upending labor markets. Every real hour is a game week.",
    primaryCta: "Start playing",
    secondaryCta: "Explore the map",
    eraChips: [
      "AI Revolution",
      "Ukraine War",
      "Inflation",
      "De-Dollarization",
      "Green Transition",
      "Tech Regulation",
    ],
    playSectionDek:
      "Govern through an era of rapid technological change, geopolitical realignment, and fiscal pressure.",
    worldSectionDek:
      "A multipolar world in 2027. {playableCount} nations are open to players. The rest run their own economies and politics. Drag the globe to explore.",
    closingHeadline: "The decade is still being written.",
    closingDek: "Pick a country, pick a role. The simulation runs whether you're in it or not.",
    closingCta: "Get started",
    footerTagline: "Persistent simulation. Multiple nations. No resets.",
    accessMap: accessFor("2027-default", NATIONS_2027),
    nations: nationsFor("2027-default", NATIONS_2027),
  },
};

/** Return the config for the given year. Exact match first, then falls back to 1979. */
export function getEraConfig(year: number | string): EraConfig {
  const key = String(year) as EraId;
  return ERA_CONFIGS[key] ?? ERA_CONFIGS["1979"];
}
