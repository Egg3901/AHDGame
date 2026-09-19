import type { Branch } from "@/lib/constants/military";
import type { CabinetGroup } from "@/lib/constants/cabinetPositionGroups";
import type { CountryConfig } from "@/lib/constants/countries";
import type { LegislativeProcess } from "@/lib/legislature/process";
import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";

/**
 * CN's institutions, as pure data.
 *
 * ⚠ GENERATED FROM `__snapshots__/cn.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-institutions.ts CN --force
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair:
 * registries that want one seat id or the legislative process import from HERE,
 * while `institutions.ts` composes these with the cabinet and is heavy. A
 * registry that reads a single string through the heavy module ships the whole
 * cabinet to the browser, which is a regression this work has already shipped
 * once. `clientSafeLeafModules.test.ts` enforces it.
 */

export const CN_CONFIG: CountryConfig = {
  id: "CN",
  seedEconomicModel: {
    "1991": "agrarian",
    "2019": "industrialPowerhouse",
  },
  name: "China",
  flagEmoji: "🇨🇳",
  code: "CN",
  socialAxisBaseline: 3.5,
  regionLabel: "Province",
  regionLabelPlural: "Provinces",
  executiveTitle: "Premier",
  headOfStateTitle: "President",
  executiveRealmPhrase: "China",
  governmentType: "onePartyState",
  headOfStateSelection: "partyChairSync",
  governmentTypeLabel: "One Party State",
  discordWebhookNote: "PBoC rate decisions and chair changes.",
  coalitionThreshold: 1491,
  legislature: {
    name: "National People's Congress",
    path: "/country/cn/legislature",
    bicameral: false,
    upperChamber: {
      key: "cppcc",
      name: "CPPCC",
      shortName: "CPPCC",
      seats: 2169,
      description:
        "2,169 members of the Chinese People's Political Consultative Conference - an advisory body representing diverse social and economic constituencies.",
    },
    lowerChamber: {
      key: "npc",
      name: "National People's Congress",
      shortName: "NPC",
      seats: 2980,
      description:
        "2,980 delegates representing provinces, municipalities, autonomous regions, the armed forces, and special administrative regions. Five-year terms.",
    },
  },
  subNationalChamber: {
    key: "peoplesCongress",
    name: "People's Congress",
    shortName: "People's Congress",
    seats: 4000,
    description:
      "Provincial People's Congresses - the elected legislatures of each macro-region, operating as the legislative arm of each Provincial People's Government. Members serve five-year terms.",
    regionalModel: true,
  },
  lowerElectionSystem: {
    termYears: 5,
    seatsContested: "all",
    singleMemberConstituencies: false,
    snapElectionsAllowed: false,
  },
  electionSystems: {
    lowerChamber: "pr_hareQuota",
    subNationalChamber: "pr_hareQuota",
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
      termYears: 5,
      actionBonus: 4,
      partyStrengthWeight: 1,
    },
    {
      key: "president",
      label: "President",
      labelPlural: "Presidents",
      isExecutive: true,
      isHeadOfState: true,
      isSubNational: false,
      actionBonus: 0,
      partyStrengthWeight: 0,
    },
    {
      key: "npcDelegate",
      label: "NPC Delegate",
      labelPlural: "NPC Delegates",
      chamberKey: "npc",
      isExecutive: false,
      isSubNational: false,
      termYears: 5,
      actionBonus: 1,
      partyStrengthWeight: 0.85,
    },
    {
      key: "peoplesCongress",
      label: "Provincial Delegate",
      labelPlural: "Provincial Delegates",
      chamberKey: "peoplesCongress",
      isExecutive: false,
      isSubNational: true,
      termYears: 5,
      actionBonus: 1,
      partyStrengthWeight: 0.75,
    },
    {
      key: "governor",
      label: "Governor",
      labelPlural: "Governors",
      isExecutive: false,
      isSubNational: true,
      termYears: 5,
      actionBonus: 2,
      partyStrengthWeight: 1,
    },
    {
      key: "centralBankChair",
      label: "Governor of the PBoC",
      labelPlural: "Governors of the PBoC",
      isExecutive: false,
      isSubNational: false,
      termYears: 5,
      actionBonus: 3,
      partyStrengthWeight: 0,
    },
  ],
  majorPartyIds: ["ccp"],
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
  factionDefectionName: "Democratic Faction of the CCP",
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
  onePartyRegionalBudget: {
    localTaxRetentionShare: 0.4,
    corporateProfitRatio: 0.06,
    centralTransferPerCapita: 35,
    defaultTaxRate: 25,
    primaryTaxLegislationKey: "cn_enterprise_income_tax",
    resourceTaxLegislationKey: "cn_provincial_resource_tax",
    resourceExtractionRatio: 0.03,
    businessTaxConsumptionRatio: 0.5,
    businessTaxRate: 24,
  },
  partyCreationNPPs: {
    statesRequired: 2,
    lockHomeState: false,
    nppsPerState: 1,
  },
  partyRoleLabels: {
    chair: "General Secretary",
    viceChair: "Deputy General Secretary",
    committee: "Secretariat",
  },
  demographicProfileId: "cn_archetypes",
  hasLeaderConfidenceModel: true,
  mapOverlay: "partyOrg",
  centralBank: {
    name: "People's Bank of China",
    abbreviation: "PBoC",
    chairTitle: "Governor of the PBoC",
    defaultPrimeRate: 4,
    heroImage: "/api/images/hero/peoples-bank-of-china",
  },
  exchangeName: "SSE",
  usdExchangeRate: 0.138,
  currencyCode: "CNY",
  fiscalYearStartTurnInYear: 40,
  financeMinisterCabinetId: "minister_of_finance",
  status: "active",
  tagline:
    "The world's second-largest economy - seven geographic regions, a National People's Congress, and a central bank steering rapid development.",
  descriptor:
    "A unitary state governed by the Chinese Communist Party, where the Premier leads the State Council through confidence of the 2,980-seat National People's Congress across seven geographic regions.",
  heroImage: "https://flagcdn.com/w640/cn.png",
  entryPath: "/country/cn",
  overviewPath: "/country/cn",
  mapPath: "/country/cn/map",
  executivePath: "/country/cn/executive",
  executiveLabel: "State Council",
  centralGovernmentLabel: "Central Government Transfers",
};

export const CN_LEGISLATIVE_PROCESS: LegislativeProcess = {
  executive: {
    title: "President",
    canVeto: false,
    signLabel: "Promulgation",
    signNote:
      "Adopted laws are promulgated by the President by order. The NPC is the highest organ of state power.",
    override: null,
  },
  upperNote: null,
  dissolution: null,
  quirks: [
    {
      icon: "building",
      title: "NPC supremacy",
      body: "The National People's Congress is constitutionally the highest organ of state power.",
    },
    {
      icon: "users",
      title: "Standing Committee",
      body: "Between sessions, the NPC Standing Committee exercises legislative authority.",
    },
    {
      icon: "shield",
      title: "Party leadership",
      body: "Legislation advances under the leadership of the Communist Party of China.",
    },
  ],
  seatingStyle: "hemicycle",
};

export const CN_ORDERS_OF_BATTLE: OrderOfBattleEntry[] = [
  {
    branchId: "pla",
    type: "Infantry Division",
    count: 16,
  },
  {
    branchId: "pla",
    type: "Artillery Regiment",
    count: 4,
  },
  {
    branchId: "pla",
    type: "Mechanized Brigade",
    count: 2,
  },
  {
    branchId: "plan",
    type: "Frigate Squadron",
    count: 2,
  },
  {
    branchId: "plaaf",
    type: "Fighter Wing",
    count: 5,
  },
  {
    branchId: "plaaf",
    type: "Bomber Squadron",
    count: 1,
  },
];

export const CN_MILITARY_BRANCHES: Branch[] = [
  {
    id: "pla",
    name: "PLA Ground Force",
    abbr: "PLAGF",
    domain: "ground",
  },
  {
    id: "plan",
    name: "PLA Navy",
    abbr: "PLAN",
    domain: "naval",
  },
  {
    id: "plaaf",
    name: "PLA Air Force",
    abbr: "PLAAF",
    domain: "air",
  },
  {
    id: "rocket",
    name: "PLA Rocket Force",
    abbr: "PLARF",
    domain: "rocket",
    establishedYear: 1966,
  },
  {
    id: "ssf",
    name: "Aerospace Force",
    abbr: "PLAASF",
    domain: "space",
    establishedYear: 2016,
  },
];

export const CN_ESTATE_PORTFOLIO: Record<string, string> = {
  minister_of_foreign_affairs: "foreign",
  minister_of_education: "education",
  minister_of_health: "health",
  minister_of_public_security: "homeland",
  minister_of_commerce: "commerce",
  minister_of_human_resources_social_security: "labor",
  minister_of_ecology_environment: "interior",
  minister_of_agriculture_rural_affairs: "agriculture",
  minister_of_housing_urban_rural: "housing",
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
export const CN_CABINET_SEAT_IDS = {
  energy: "minister_of_ecology_environment",
  infrastructure: "minister_of_transport",
  defense: "minister_of_defense",
  foreignAffairs: "minister_of_foreign_affairs",
  tradeMinister: "minister_of_commerce",
} as const;

/** Military scale multiplier. */
export const CN_MILITARY_SCALE = 2;

/** Which office assents to regional bills. */
/* No CN_REGIONAL_BILL_ASSENT_OFFICE_KEY: the registry has no CN entry.
 * `regionalBillAssentOfficeKey` is optional in the contract, and a country whose
 * regional bills need no assent office is not the same as one defaulting to
 * someone else’s. */

/**
 * Which policy bucket each cabinet seat belongs to, for the cabinet UI.
 *
 * ⚠ THE CAST IS LOAD-BEARING. `CabinetGroup` is a union of bucket names, and
 * JSON.parse widens every one of them to `string`. Without it the object is
 * `Record<string, string>`, which is not assignable to `Record<string, CabinetGroup>`
 * and fails only under `npm run typecheck` -- eslint and the test suite both pass.
 */
export const CN_CABINET_GROUPS: Record<string, CabinetGroup> = {
  premier: "Centre",
  vice_premier: "Centre",
  state_councillor: "Centre",
  minister_of_finance: "Economy",
  pboc_governor: "Economy",
  minister_of_commerce: "Economy",
  minister_of_human_resources_social_security: "Economy",
  minister_of_agriculture_rural_affairs: "Economy",
  minister_of_foreign_affairs: "Security & Foreign",
  minister_of_defense: "Security & Foreign",
  minister_of_public_security: "Security & Foreign",
  minister_of_education: "Society",
  minister_of_health: "Society",
  minister_of_housing_urban_rural: "Society",
  minister_of_ecology_environment: "Domestic",
  minister_of_transport: "Domestic",
};
