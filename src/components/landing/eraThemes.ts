/**
 * Era-specific theme configs for the sandbox landing and login page.
 * Each era defines globe visual style, copy, seed access map, and nations list.
 */

export type EraId = "1953" | "1979" | "1991" | "1999" | "2007" | "2019" | "2023";

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
  worldSectionDek: string;
  closingHeadline: string;
  closingDek: string;
  closingCta: string;
  footerTagline: string;
  accessMap: Record<string, EraAccess>;
  nations: EraNation[];
};

const P = (id: string, name: string): EraNation => ({ id, name, tier: "player" });
const E = (id: string, name: string): EraNation => ({ id, name, tier: "econ" });
const N = (id: string, name: string): EraNation => ({ id, name, tier: "npp" });

const PLAYER: EraAccess = { enabledForPlayers: true, economyPreview: false, status: "active" };
const ECON: EraAccess = { enabledForPlayers: false, economyPreview: true, status: "beta" };
const NPP: EraAccess = { enabledForPlayers: false, economyPreview: false, status: "coming-soon" };

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
      "A handful of nations in 1953. Four are open to players. The rest run their own economies and one-party machines. Drag the globe to explore.",
    closingHeadline: "The post-war order is still being written.",
    closingDek: "Pick a country, pick a role. The simulation runs whether you're in it or not.",
    closingCta: "Get started",
    footerTagline: "Persistent simulation. Multiple nations. No resets.",
    accessMap: {
      US: PLAYER,
      UK: PLAYER,
      RU: PLAYER,
      DE: ECON,
      JP: ECON,
      IT: ECON,
      FR: ECON,
      CN: NPP,
      DD: PLAYER,
    },
    nations: [
      P("US", "United States"),
      P("UK", "United Kingdom"),
      P("RU", "Soviet Union"),
      E("DE", "West Germany"),
      E("JP", "Japan"),
      E("IT", "Italy"),
      E("FR", "France"),
      N("CN", "China"),
      P("DD", "East Germany"),
    ],
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
      "Twenty-two nations in 1979. Four are open to players. The rest run their own economies and one-party machines. Drag the globe to explore.",
    closingHeadline: "22 nations. One timeline.",
    closingDek: "Pick a country, pick a role. The simulation runs whether you're in it or not.",
    closingCta: "Get started",
    footerTagline: "Persistent simulation. 22 nations. No resets.",
    accessMap: {
      US: PLAYER,
      UK: PLAYER,
      RU: PLAYER,
      FR: ECON,
      IT: ECON,
      ES: ECON,
      SE: ECON,
      TR: ECON,
      GR: ECON,
      AT: ECON,
      FI: ECON,
      DE: ECON,
      JP: ECON,
      CN: ECON,
      BR: ECON,
      IE: ECON,
      DD: PLAYER,
      PL: NPP,
      RO: NPP,
      YU: NPP,
      HU: NPP,
      CS: NPP,
      BG: NPP,
      // Key is the CountryId, not the ISO alpha-2: this was "BY", which matches
      // nothing in COUNTRY_CONFIGS, so Byelorussia silently had no access entry.
      UKR: NPP,
      BLR: NPP,
      BAL: NPP,
    },
    nations: [
      P("US", "United States"),
      P("UK", "United Kingdom"),
      P("RU", "Soviet Union"),
      E("FR", "France"),
      E("IT", "Italy"),
      E("ES", "Spain"),
      E("SE", "Sweden"),
      E("TR", "Turkey"),
      E("GR", "Greece"),
      E("AT", "Austria"),
      E("FI", "Finland"),
      E("DE", "West Germany"),
      E("JP", "Japan"),
      E("CN", "China"),
      E("BR", "Brazil"),
      E("IE", "Ireland"),
      P("DD", "East Germany"),
      N("PL", "Poland"),
      N("RO", "Romania"),
      N("YU", "Yugoslavia"),
      N("HU", "Hungary"),
      N("CS", "Czechoslovakia"),
      N("BG", "Bulgaria"),
      N("UKR", "Ukraine"),
      N("BLR", "Belarus"),
      N("BAL", "Baltic Republics"),
    ],
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
      "Nations redrawn by history. Three are open to players. The rest run their own economies through the turbulence of transition. Drag the globe to explore.",
    closingHeadline: "The map just changed. What comes next is up to you.",
    closingDek: "Pick a country, pick a role. The simulation runs whether you're in it or not.",
    closingCta: "Get started",
    footerTagline: "Persistent simulation. Multiple nations. No resets.",
    accessMap: {
      US: PLAYER,
      UK: PLAYER,
      DE: PLAYER,
      RU: ECON,
      FR: ECON,
      JP: ECON,
      CN: ECON,
      PL: NPP,
      CS: NPP,
      HU: NPP,
      RO: NPP,
    },
    nations: [
      P("US", "United States"),
      P("UK", "United Kingdom"),
      P("DE", "Germany"),
      E("RU", "Russia"),
      E("FR", "France"),
      E("JP", "Japan"),
      E("CN", "China"),
      N("PL", "Poland"),
      N("CS", "Czechoslovakia"),
      N("HU", "Hungary"),
      N("RO", "Romania"),
    ],
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
      "Nations navigating prosperity and instability in equal measure. Three are open to players. The rest run their own economies. Drag the globe to explore.",
    closingHeadline: "A new century starts in twelve months.",
    closingDek: "Pick a country, pick a role. The simulation runs whether you're in it or not.",
    closingCta: "Get started",
    footerTagline: "Persistent simulation. Multiple nations. No resets.",
    accessMap: {
      US: PLAYER,
      UK: PLAYER,
      DE: PLAYER,
      FR: ECON,
      JP: ECON,
      CN: ECON,
      IT: ECON,
      RU: NPP,
    },
    nations: [
      P("US", "United States"),
      P("UK", "United Kingdom"),
      P("DE", "Germany"),
      E("FR", "France"),
      E("JP", "Japan"),
      E("CN", "China"),
      E("IT", "Italy"),
      N("RU", "Russia"),
    ],
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
      "A multipolar world in 2007. Three nations are open to players. The rest run their own economies and politics. Drag the globe to explore.",
    closingHeadline: "The crash hasn't happened yet.",
    closingDek: "Pick a country, pick a role. The simulation runs whether you're in it or not.",
    closingCta: "Get started",
    footerTagline: "Persistent simulation. Multiple nations. No resets.",
    accessMap: {
      US: PLAYER,
      UK: PLAYER,
      DE: PLAYER,
      FR: ECON,
      JP: ECON,
      CN: ECON,
      BR: ECON,
      IN: ECON,
      RU: NPP,
    },
    nations: [
      P("US", "United States"),
      P("UK", "United Kingdom"),
      P("DE", "Germany"),
      E("FR", "France"),
      E("JP", "Japan"),
      E("CN", "China"),
      E("BR", "Brazil"),
      E("IN", "India"),
      N("RU", "Russia"),
    ],
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
      "A fractured international order in 2019. Three nations are open to players. The rest run their own economies and politics. Drag the globe to explore.",
    closingHeadline: "Institutions are under pressure everywhere.",
    closingDek: "Pick a country, pick a role. The simulation runs whether you're in it or not.",
    closingCta: "Get started",
    footerTagline: "Persistent simulation. Multiple nations. No resets.",
    accessMap: {
      US: PLAYER,
      UK: PLAYER,
      DE: PLAYER,
      FR: ECON,
      JP: ECON,
      CN: ECON,
      BR: ECON,
      IN: ECON,
      RU: NPP,
    },
    nations: [
      P("US", "United States"),
      P("UK", "United Kingdom"),
      P("DE", "Germany"),
      E("FR", "France"),
      E("JP", "Japan"),
      E("CN", "China"),
      E("BR", "Brazil"),
      E("IN", "India"),
      N("RU", "Russia"),
    ],
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
      "A multipolar world in 2023. Three nations are open to players. The rest run their own economies and politics. Drag the globe to explore.",
    closingHeadline: "The decade is still being written.",
    closingDek: "Pick a country, pick a role. The simulation runs whether you're in it or not.",
    closingCta: "Get started",
    footerTagline: "Persistent simulation. Multiple nations. No resets.",
    accessMap: {
      US: PLAYER,
      UK: PLAYER,
      DE: PLAYER,
      FR: ECON,
      JP: ECON,
      CN: ECON,
      BR: ECON,
      IN: ECON,
      RU: NPP,
    },
    nations: [
      P("US", "United States"),
      P("UK", "United Kingdom"),
      P("DE", "Germany"),
      E("FR", "France"),
      E("JP", "Japan"),
      E("CN", "China"),
      E("BR", "Brazil"),
      E("IN", "India"),
      N("RU", "Russia"),
    ],
  },
};

/** Return the config for the given year. Exact match first, then falls back to 1979. */
export function getEraConfig(year: number | string): EraConfig {
  const key = String(year) as EraId;
  return ERA_CONFIGS[key] ?? ERA_CONFIGS["1979"];
}
