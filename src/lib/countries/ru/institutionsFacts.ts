import type { Branch } from "@/lib/constants/military";
import type { CabinetGroup } from "@/lib/constants/cabinetPositionGroups";
import type { CountryConfig } from "@/lib/constants/countries";

import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";

/**
 * RU's institutions, as pure data.
 *
 * ⚠ GENERATED FROM `__snapshots__/ru.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-institutions.ts RU --force
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair:
 * registries that want one seat id or the legislative process import from HERE,
 * while `institutions.ts` composes these with the cabinet and is heavy. A
 * registry that reads a single string through the heavy module ships the whole
 * cabinet to the browser, which is a regression this work has already shipped
 * once. `clientSafeLeafModules.test.ts` enforces it.
 */

export const RU_CONFIG: CountryConfig = {
  id: "RU",
  name: "Russia",
  flagEmoji: "🇸🇺",
  code: "RU",
  socialAxisBaseline: 3.5,
  regionLabel: "Republic",
  regionLabelPlural: "Republics",
  executiveTitle: "Premier",
  headOfStateTitle: "Chairman of the Presidium",
  executiveRealmPhrase: "the Soviet Union",
  governmentType: "onePartyState",
  confidenceVoteMechanism: true,
  headOfStateSelection: "legislatureAppointment",
  governmentTypeLabel: "One Party State",
  coalitionThreshold: 376,
  legislature: {
    name: "Supreme Soviet",
    path: "/country/ru/legislature",
    bicameral: true,
    upperChamber: {
      key: "sovietOfNationalities",
      name: "Soviet of Nationalities",
      shortName: "Nationalities",
      elected: true,
      seats: 515,
      description:
        "Deputies representing the union republics and autonomous republics of the Soviet Union - the nationalities chamber of the Supreme Soviet, seated by republic rather than by population.",
    },
    lowerChamber: {
      key: "sovietOfTheUnion",
      name: "Soviet of the Union",
      shortName: "Union",
      seats: 559,
      description:
        "559 deputies elected by population to the Supreme Soviet of the USSR; four-year terms, single-list elections under the Communist Party.",
    },
  },
  subNationalChamber: {
    key: "republicSupremeSoviet",
    name: "Republic Supreme Soviet",
    shortName: "Republic Soviet",
    seats: 5000,
    description:
      "The Supreme Soviets of the union republics and the regional Soviets of People's Deputies - the legislative arm of each republic government. Four-year terms.",
    regionalModel: true,
  },
  lowerElectionSystem: {
    termYears: 4,
    seatsContested: "all",
    singleMemberConstituencies: false,
    snapElectionsAllowed: false,
  },
  upperElectionSystem: {
    termYears: 4,
    seatsContested: "all",
    singleMemberConstituencies: false,
    snapElectionsAllowed: false,
  },
  electionSystems: {
    lowerChamber: "fptp",
    subNationalChamber: "fptp",
    headOfGovernment: "parliamentary",
    headOfState: "ceremonial",
  },
  officeTypes: [
    {
      key: "premier",
      label: "Premier",
      labelPlural: "Premiers",
      isExecutive: true,
      isSubNational: false,
      termYears: 4,
      actionBonus: 4,
      partyStrengthWeight: 1,
    },
    {
      key: "chairmanOfPresidium",
      label: "Chairman of the Presidium",
      labelPlural: "Chairmen of the Presidium",
      isExecutive: true,
      isHeadOfState: true,
      isSubNational: false,
      actionBonus: 0,
      partyStrengthWeight: 0,
    },
    {
      key: "supremeSovietDeputy",
      label: "Supreme Soviet Deputy",
      labelPlural: "Supreme Soviet Deputies",
      chamberKey: "sovietOfTheUnion",
      isExecutive: false,
      isSubNational: false,
      termYears: 4,
      actionBonus: 1,
      partyStrengthWeight: 0.85,
    },
    {
      key: "nationalitiesDeputy",
      label: "Nationalities Deputy",
      labelPlural: "Nationalities Deputies",
      chamberKey: "sovietOfNationalities",
      isExecutive: false,
      isSubNational: false,
      termYears: 4,
      actionBonus: 1,
      partyStrengthWeight: 0.85,
    },
    {
      key: "republicSupremeSoviet",
      label: "Republic Deputy",
      labelPlural: "Republic Deputies",
      chamberKey: "republicSupremeSoviet",
      isExecutive: false,
      isSubNational: true,
      termYears: 4,
      actionBonus: 1,
      partyStrengthWeight: 0.75,
    },
    {
      key: "governor",
      label: "Republic First Secretary",
      labelPlural: "Republic First Secretaries",
      isExecutive: false,
      isSubNational: true,
      termYears: 4,
      actionBonus: 2,
      partyStrengthWeight: 1,
    },
    {
      key: "centralBankChair",
      label: "Chairman of Gosbank",
      labelPlural: "Chairmen of Gosbank",
      isExecutive: false,
      isSubNational: false,
      termYears: 5,
      actionBonus: 3,
      partyStrengthWeight: 0,
    },
  ],
  majorPartyIds: ["cpsu"],
  rulingPartyId: 1,
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
  factionDefectionName: "Reformist Faction of the CPSU",
  collapseTargetSystem: "parliamentaryRepublic",
  collapseTargetAllowlist: ["parliamentaryRepublic", "presidential"],
  legacyReservationDefault: 20,
  electionDelayDefault: 24,
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
  partyCreationNPPs: {
    statesRequired: 2,
    lockHomeState: false,
    nppsPerState: 1,
  },
  partyRoleLabels: {
    chair: "General Secretary",
    viceChair: "Second Secretary",
    committee: "Politburo",
  },
  demographicProfileId: "su_archetypes",
  hasLeaderConfidenceModel: true,
  mapOverlay: "partyOrg",
  centralBank: {
    name: "State Bank of the USSR",
    abbreviation: "Gosbank",
    chairTitle: "Chairman of Gosbank",
    defaultPrimeRate: 3,
    heroImage:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Flag_of_the_Soviet_Union.svg/500px-Flag_of_the_Soviet_Union.svg.png",
  },
  exchangeName: "GOSPLAN",
  exchangeKind: "stateRegister",
  usdExchangeRate: 1.35,
  currencyCode: "SUR",
  fiscalYearStartTurnInYear: 40,
  financeMinisterCabinetId: "minister_of_finance",
  status: "coming-soon",
  tagline:
    "The Cold-War superpower - a one-party socialist union of republics governed by the Communist Party from the Kremlin.",
  descriptor:
    "A one-party socialist federation where the Communist Party's General Secretary holds real power, the Premier leads the Council of Ministers, and the Supreme Soviet ratifies across fifteen union republics under a centrally-planned command economy.",
  heroImage:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Flag_of_the_Soviet_Union.svg/500px-Flag_of_the_Soviet_Union.svg.png",
  entryPath: "/country/ru",
  overviewPath: "/country/ru",
  mapPath: "/country/ru/map",
  executivePath: "/country/ru/executive",
  executiveLabel: "Council of Ministers",
  centralGovernmentLabel: "Central Plan",
};

/* No RU_LEGISLATIVE_PROCESS: the registry has no RU row, and readers
   fall through to DEFAULT_PROCESS. The registry holds six keys; a country absent
   from it has never had its own process, and writing the default here would say
   it did. */

export const RU_ORDERS_OF_BATTLE: OrderOfBattleEntry[] = [
  {
    branchId: "ground",
    type: "Infantry Division",
    count: 12,
  },
  {
    branchId: "ground",
    type: "Armored Division",
    count: 5,
  },
  {
    branchId: "ground",
    type: "Mechanized Brigade",
    count: 5,
  },
  {
    branchId: "ground",
    type: "Artillery Regiment",
    count: 4,
  },
  {
    branchId: "ground",
    type: "Air Defense Battalion",
    count: 3,
  },
  {
    branchId: "navy",
    type: "Attack Submarine",
    count: 4,
  },
  {
    branchId: "navy",
    type: "Frigate Squadron",
    count: 3,
  },
  {
    branchId: "navy",
    type: "Amphibious Group",
    count: 1,
  },
  {
    branchId: "airforce",
    type: "Fighter Wing",
    count: 4,
  },
  {
    branchId: "airforce",
    type: "Bomber Squadron",
    count: 3,
  },
  {
    branchId: "pvo",
    type: "Air Defense Wing",
    count: 5,
  },
];

export const RU_MILITARY_BRANCHES: Branch[] = [
  {
    id: "ground",
    name: "Ground Forces",
    abbr: "SV",
    domain: "ground",
  },
  {
    id: "navy",
    name: "Navy",
    abbr: "VMF",
    domain: "naval",
  },
  {
    id: "airforce",
    name: "Air Force",
    abbr: "VVS",
    domain: "air",
  },
  {
    id: "pvo",
    name: "Air Defence Forces",
    abbr: "PVO",
    domain: "air",
    establishedYear: 1948,
  },
  {
    id: "rocket",
    name: "Strategic Rocket Forces",
    abbr: "RVSN",
    domain: "rocket",
    establishedYear: 1959,
  },
  {
    id: "space",
    name: "Space Forces",
    abbr: "VKS",
    domain: "space",
    establishedYear: 1992,
  },
];

export const RU_ESTATE_PORTFOLIO: Record<string, string> = {
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
export const RU_CABINET_SEAT_IDS = {
  energy: "minister_of_machine_building",
  infrastructure: "minister_of_railways",
  defense: "minister_of_defence",
  foreignAffairs: "minister_of_foreign_affairs",
  tradeMinister: "minister_of_foreign_affairs",
} as const;

/** Military scale multiplier. */
export const RU_MILITARY_SCALE = 2.4;

/** Which office assents to regional bills. */
export const RU_REGIONAL_BILL_ASSENT_OFFICE_KEY = "governor";

/**
 * Which policy bucket each cabinet seat belongs to, for the cabinet UI.
 *
 * ⚠ THE CAST IS LOAD-BEARING. `CabinetGroup` is a union of bucket names, and
 * JSON.parse widens every one of them to `string`. Without it the object is
 * `Record<string, string>`, which is not assignable to `Record<string, CabinetGroup>`
 * and fails only under `npm run typecheck` -- eslint and the test suite both pass.
 */
export const RU_CABINET_GROUPS: Record<string, CabinetGroup> = {
  director_of_intelligence: "Security & Foreign",
  premier: "Centre",
  first_deputy_premier: "Centre",
  chairman_of_gosplan: "Centre",
  minister_of_finance: "Economy",
  gosbank_liaison: "Economy",
  minister_of_foreign_trade: "Economy",
  minister_of_internal_trade: "Economy",
  minister_of_agriculture: "Economy",
  minister_of_machine_building: "Economy",
  minister_of_foreign_affairs: "Security & Foreign",
  minister_of_defence: "Security & Foreign",
  minister_of_internal_affairs: "Security & Foreign",
  minister_of_culture: "Society",
  minister_of_health: "Society",
  minister_of_higher_education: "Society",
  minister_of_railways: "Domestic",
};
