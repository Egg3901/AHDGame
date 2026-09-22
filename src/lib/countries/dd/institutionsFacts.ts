import type { Branch } from "@/lib/constants/military";

import type { CountryConfig } from "@/lib/constants/countries";

import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";

/**
 * DD's institutions, as pure data.
 *
 * ⚠ GENERATED FROM `__snapshots__/dd.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-institutions.ts DD --force
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair:
 * registries that want one seat id or the legislative process import from HERE,
 * while `institutions.ts` composes these with the cabinet and is heavy. A
 * registry that reads a single string through the heavy module ships the whole
 * cabinet to the browser, which is a regression this work has already shipped
 * once. `clientSafeLeafModules.test.ts` enforces it.
 */

export const DD_CONFIG: CountryConfig = {
  id: "DD",
  name: "East Germany",
  flagEmoji: "🇩🇩",
  code: "DD",
  socialAxisBaseline: 2,
  regionLabel: "Region",
  regionLabelPlural: "Regions",
  executiveTitle: "General Secretary",
  headOfStateTitle: "Chairman of the Council of State",
  executiveRealmPhrase: "the German Democratic Republic",
  governmentType: "onePartyState",
  rulingPartyId: 1,
  governmentTypeLabel: "One Party State",
  coalitionThreshold: 251,
  legislature: {
    name: "Volkskammer",
    path: "/country/dd/legislature",
    bicameral: false,
    upperChamber: {
      key: "staatsrat",
      name: "Council of State",
      shortName: "Staatsrat",
      seats: 25,
      description:
        "The Staatsrat - a collective head of state exercising standing authority between Volkskammer sessions.",
      elected: false,
    },
    lowerChamber: {
      key: "volkskammer",
      name: "People's Chamber",
      shortName: "Volkskammer",
      seats: 500,
      description:
        "500 deputies of the Volkskammer elected on the single National Front list, led by the ruling SED.",
      elected: true,
    },
  },
  subNationalChamber: {
    key: "landAssembly",
    name: "Landtag",
    shortName: "Landtag",
    seats: 80,
    description:
      "The Landtage of the GDR's eastern Länder — the legislative arm of each Land government under the SED First Secretary. Four-year terms on the Volkskammer cycle.",
    regionalModel: true,
  },
  lowerElectionSystem: {
    termYears: 5,
    seatsContested: "all",
    singleMemberConstituencies: true,
    snapElectionsAllowed: false,
  },
  electionSystems: {
    lowerChamber: "fptp",
    subNationalChamber: "pr_hareQuota",
    subNationalExecutive: "fptp",
    headOfGovernment: "parliamentary",
    headOfState: "ceremonial",
  },
  headOfStateSelection: "partyChairSync",
  officeTypes: [
    {
      key: "generalSecretary",
      label: "General Secretary",
      labelPlural: "General Secretaries",
      isExecutive: true,
      isSubNational: false,
      termYears: 5,
      actionBonus: 4,
      partyStrengthWeight: 1,
    },
    {
      key: "chairmanOfStateCouncil",
      label: "Chairman of the Council of State",
      labelPlural: "Chairmen of the Council of State",
      isExecutive: true,
      isHeadOfState: true,
      isSubNational: false,
      actionBonus: 0,
      partyStrengthWeight: 0,
    },
    {
      key: "volkskammerDeputy",
      label: "Deputy",
      labelPlural: "Deputies",
      chamberKey: "volkskammer",
      isExecutive: false,
      isSubNational: false,
      termYears: 5,
      actionBonus: 1,
      partyStrengthWeight: 0.9,
    },
    {
      key: "landAssembly",
      label: "Landtag Deputy",
      labelPlural: "Landtag Deputies",
      chamberKey: "landAssembly",
      isExecutive: false,
      isSubNational: true,
      termYears: 4,
      actionBonus: 1,
      partyStrengthWeight: 0.75,
    },
    {
      key: "governor",
      label: "Land First Secretary",
      labelPlural: "Land First Secretaries",
      isExecutive: false,
      isSubNational: true,
      termYears: 4,
      actionBonus: 2,
      partyStrengthWeight: 1,
    },
    {
      key: "centralBankChair",
      label: "President of the Staatsbank",
      labelPlural: "Presidents of the Staatsbank",
      isExecutive: false,
      isSubNational: false,
      termYears: 6,
      actionBonus: 3,
      partyStrengthWeight: 0,
    },
  ],
  majorPartyIds: ["sed"],
  partyCreationNPPs: {
    statesRequired: 1,
    lockHomeState: true,
    nppsPerState: 2,
  },
  partyRoleLabels: {
    chair: "General Secretary",
    viceChair: "Second Secretary",
    committee: "Politburo",
  },
  demographicProfileId: "dd_archetypes",
  hasLeaderConfidenceModel: true,
  priorityProfile: {
    countryId: "CN",
    version: 1,
    axes: [
      {
        id: "party_control",
        name: "Party Control",
        weight: 0.2,
        description: "Maintaining CPC dominance over state and society",
      },
      {
        id: "social_stability",
        name: "Social Stability",
        weight: 0.15,
        description: "Preventing unrest and maintaining order",
      },
      {
        id: "state_sector",
        name: "State-Sector Strength",
        weight: 0.12,
        description: "SOE dominance in strategic industries",
      },
      {
        id: "industrial_policy",
        name: "Industrial Policy",
        weight: 0.12,
        description: "Directed investment in key sectors",
      },
      {
        id: "economic_growth",
        name: "Economic Growth",
        weight: 0.15,
        description: "GDP growth and development targets",
      },
      {
        id: "national_security",
        name: "National Security",
        weight: 0.12,
        description: "Military, intelligence, and territorial integrity",
      },
      {
        id: "regional_balance",
        name: "Regional Balance",
        weight: 0.07,
        description: "Reducing coastal-inland inequality",
      },
      {
        id: "market_openness",
        name: "Managed Market Openness",
        weight: 0.04,
        description: "Controlled foreign investment and trade",
      },
      {
        id: "anti_corruption",
        name: "Anti-Corruption Legitimacy",
        weight: 0.03,
        description: "Public perception of CPC discipline",
      },
    ],
  },
  policyAxisEffects: {
    "market-liberalization": [
      {
        axisId: "state_sector",
        delta: -40,
      },
      {
        axisId: "party_control",
        delta: -20,
      },
      {
        axisId: "economic_growth",
        delta: 30,
      },
      {
        axisId: "market_openness",
        delta: 25,
      },
    ],
    privatization: [
      {
        axisId: "state_sector",
        delta: -50,
      },
      {
        axisId: "party_control",
        delta: -15,
      },
      {
        axisId: "economic_growth",
        delta: 20,
      },
      {
        axisId: "anti_corruption",
        delta: 10,
      },
    ],
    "industrial-investment": [
      {
        axisId: "industrial_policy",
        delta: 45,
      },
      {
        axisId: "state_sector",
        delta: 25,
      },
      {
        axisId: "economic_growth",
        delta: 20,
      },
      {
        axisId: "regional_balance",
        delta: 15,
      },
    ],
    infrastructure: [
      {
        axisId: "industrial_policy",
        delta: 30,
      },
      {
        axisId: "economic_growth",
        delta: 25,
      },
      {
        axisId: "regional_balance",
        delta: 35,
      },
      {
        axisId: "social_stability",
        delta: 10,
      },
    ],
    "security-expansion": [
      {
        axisId: "national_security",
        delta: 40,
      },
      {
        axisId: "party_control",
        delta: 15,
      },
      {
        axisId: "economic_growth",
        delta: -10,
      },
    ],
    "social-welfare": [
      {
        axisId: "social_stability",
        delta: 25,
      },
      {
        axisId: "regional_balance",
        delta: 20,
      },
      {
        axisId: "economic_growth",
        delta: -10,
      },
      {
        axisId: "anti_corruption",
        delta: 10,
      },
    ],
    "anti-corruption": [
      {
        axisId: "anti_corruption",
        delta: 50,
      },
      {
        axisId: "party_control",
        delta: 20,
      },
      {
        axisId: "social_stability",
        delta: 10,
      },
    ],
    censorship: [
      {
        axisId: "party_control",
        delta: 30,
      },
      {
        axisId: "social_stability",
        delta: 15,
      },
      {
        axisId: "market_openness",
        delta: -20,
      },
    ],
    "trade-protection": [
      {
        axisId: "state_sector",
        delta: 20,
      },
      {
        axisId: "market_openness",
        delta: -30,
      },
      {
        axisId: "economic_growth",
        delta: -10,
      },
      {
        axisId: "national_security",
        delta: 15,
      },
    ],
    "foreign-engagement": [
      {
        axisId: "national_security",
        delta: 10,
      },
      {
        axisId: "market_openness",
        delta: 25,
      },
      {
        axisId: "economic_growth",
        delta: 15,
      },
    ],
    "labor-rights": [
      {
        axisId: "social_stability",
        delta: 20,
      },
      {
        axisId: "party_control",
        delta: -15,
      },
      {
        axisId: "economic_growth",
        delta: -10,
      },
    ],
    default: [],
  },
  factionDefectionName: "Reform Wing of the SED",
  legacyReservationDefault: 20,
  electionDelayDefault: 24,
  mapOverlay: "partyOrg",
  centralBank: {
    name: "Staatsbank der DDR",
    abbreviation: "SBD",
    chairTitle: "President of the Staatsbank",
    defaultPrimeRate: 5,
    heroImage:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Flag_of_East_Germany.svg/500px-Flag_of_East_Germany.svg.png",
  },
  exchangeName: "VVB",
  exchangeKind: "stateRegister",
  usdExchangeRate: 0.45,
  currencyCode: "DDM",
  fiscalYearStartTurnInYear: 40,
  financeMinisterCabinetId: "minister_of_finance",
  collapseTargetSystem: "parliamentaryRepublic",
  popularMoodProfile: {
    economicProsperity: 0.9,
    civilLiberties: 0.7,
    anticorruption: 0.8,
    publicServices: 0.5,
    nationalism: 0.3,
    culturalTradition: 0.4,
    internationalStanding: 0.3,
    environmentalProtection: 0.2,
    lawAndOrder: 0.5,
  },
  federalEqualizationGrantPerCapita: 100,
  status: "coming-soon",
  tagline:
    "The other Germany - a hard-line SED state and Warsaw-Pact linchpin, its planned economy and Wall holding back the pull of the West.",
  descriptor:
    "A one-party socialist republic where the SED General Secretary governs through the National Front and the Volkskammer; the economy is centrally planned until reform or reunification.",
  heroImage:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Flag_of_East_Germany.svg/500px-Flag_of_East_Germany.svg.png",
  entryPath: "/country/dd",
  overviewPath: "/country/dd",
  mapPath: "/country/dd/map",
  executivePath: "/country/dd/executive",
  executiveLabel: "Council of Ministers",
  centralGovernmentLabel: "Central Plan",
};

/* No DD_LEGISLATIVE_PROCESS: the registry has no DD row, and readers
   fall through to DEFAULT_PROCESS. The registry holds six keys; a country absent
   from it has never had its own process, and writing the default here would say
   it did. */

export const DD_ORDERS_OF_BATTLE: OrderOfBattleEntry[] = [
  {
    branchId: "landstreitkraefte",
    type: "Infantry Division",
    count: 3,
  },
  {
    branchId: "landstreitkraefte",
    type: "Mechanized Brigade",
    count: 2,
  },
  {
    branchId: "landstreitkraefte",
    type: "Artillery Regiment",
    count: 1,
  },
  {
    branchId: "volksmarine",
    type: "Frigate Squadron",
    count: 1,
  },
  {
    branchId: "luftstreitkraefte",
    type: "Fighter Wing",
    count: 2,
  },
  {
    branchId: "luftstreitkraefte",
    type: "Air Defense Wing",
    count: 1,
  },
];

export const DD_MILITARY_BRANCHES: Branch[] = [
  {
    id: "landstreitkraefte",
    name: "Land Forces",
    abbr: "LaSK",
    domain: "ground",
    establishedYear: 1956,
    dissolvedYear: 1990,
  },
  {
    id: "volksmarine",
    name: "People's Navy",
    abbr: "VM",
    domain: "naval",
    establishedYear: 1956,
    dissolvedYear: 1990,
  },
  {
    id: "luftstreitkraefte",
    name: "Air Force / Air Defence",
    abbr: "LSK/LV",
    domain: "air",
    establishedYear: 1956,
    dissolvedYear: 1990,
  },
];

export const DD_ESTATE_PORTFOLIO: Record<string, string> = {
  minister_of_foreign_affairs: "foreign",
  minister_of_internal_affairs: "state_security",
  chairman_of_gosplan: "planning",
  gosbank_liaison: "state_bank",
  minister_of_foreign_trade: "trade_mission",
  minister_of_internal_trade: "distribution",
  minister_of_agriculture: "collective_farming",
  minister_of_machine_building: "heavy_industry",
  minister_of_culture: "culture",
  minister_of_health: "socialized_health",
  minister_of_higher_education: "education",
};

/**
 * Cabinet seat ids: which of this country's positions fills a cross-country
 * role.
 *
 * ⚠ THE FIVE ARE NOT TYPED ALIKE, AND THE FORWARDERS ARE WHAT EXPOSE IT. ENERGY
 * and INFRA live in `Partial<Record<..., string>>`, so they are
 * `string | undefined`; DEFENSE, FOREIGN_AFFAIRS and TRADE_MINISTER live in
 * `Record<..., string | null>`, so they are required and nullable. Declaring
 * all five the same way compiles here and fails at every forwarder.
 */
export const DD_CABINET_SEAT_IDS = {
  energy: "minister_of_machine_building",
  infrastructure: "minister_of_railways",
  defense: "minister_of_defence",
  foreignAffairs: "minister_of_foreign_affairs",
  tradeMinister: "minister_of_foreign_affairs",
} as const;

/** Military scale multiplier. */
export const DD_MILITARY_SCALE = 1.2;

/** Which office assents to regional bills. */
export const DD_REGIONAL_BILL_ASSENT_OFFICE_KEY = "governor";

/**
 * Which policy bucket each cabinet seat belongs to, for the cabinet UI.
 *
 * ⚠ THE CAST IS LOAD-BEARING. `CabinetGroup` is a union of bucket names, and
 * JSON.parse widens every one of them to `string`. Without it the object is
 * `Record<string, string>`, which is not assignable to `Record<string, CabinetGroup>`
 * and fails only under `npm run typecheck` -- eslint and the test suite both pass.
 */
/* No DD_CABINET_GROUPS: the registry has no DD row, and its only
   reader already falls back to "Centre" per position. */
