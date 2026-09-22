/**
 * Japan's institution facts, in a module with NO value imports.
 *
 * ⚠️ WHY THIS IS SEPARATE FROM `institutions.ts`. That module composes the
 * cabinet, which imports `cabinet/mechanics` (28 KB) and `cabinet/orders`
 * (8 KB) as values. Seven registries forward here, and several of them are
 * imported by client components -- `cabinetEnergy` reads one string,
 * `"environment_minister"`, and would have dragged 47 KB of cabinet mechanics
 * into the browser bundle to get it.
 *
 * Nothing fails when that happens. The page just gets bigger.
 * `clientSafeLeafModules.test.ts` is what makes it fail.
 *
 * KEEP THIS MODULE FREE OF VALUE IMPORTS.
 */
import type { CountryConfig } from "@/lib/constants/countries";
import type { LegislativeProcess } from "@/lib/legislature/process";
import type { Branch } from "@/lib/constants/military";
import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";

/**
 * Japan's institutions. Phase D3.
 *
 * ⚠️ GENERATED FROM THE PRE-MOVE SNAPSHOT for the authored tables, and composed
 * by IMPORT for the cabinet data. The difference matters:
 *
 * ORDERS_BY_COUNTRY.JP *is* JP_MINISTERIAL_ORDERS, and MECHANICS_BY_COUNTRY.JP
 * *is* JP_CABINET_MECHANICS. Those files were relocated into ./cabinet/, so the
 * registries that hold them already forward here. Re-emitting their contents as
 * literals would have created a second source of 1,333 lines that nothing keeps
 * in sync.
 *
 * ⚠️ `config` carries Japan's COUNTRY_CONFIGS entry whole. getCountryConfig is a
 * SHALLOW merge, so an era override supplying `legislature` replaces the entire
 * object -- see eras/, and the guard in eraConfigOverrides.test.ts that now pins
 * BOTH of Japan's eras rather than only 1991.
 *
 * ⚠️ Government type is a VALUE in a field, not a subclass. Japan holds
 * `parliamentaryRepublic`. A one-party state collapsing means changing that
 * value at runtime, which composition makes trivial.
 */

export const JP_CONFIG: CountryConfig = {
  id: "JP",
  seedEconomicModel: {
    "1991": "industrialPowerhouse",
    "2019": "industrialPowerhouse",
  },
  name: "Japan",
  flagEmoji: "🇯🇵",
  code: "JP",
  socialAxisBaseline: 0,
  regionLabel: "Region",
  regionLabelPlural: "Regions",
  executiveTitle: "Prime Minister",
  headOfStateTitle: "Emperor",
  executiveRealmPhrase: "Japan",
  governmentType: "parliamentaryMonarchy",
  governmentTypeLabel: "Constitutional Monarchy",
  coalitionThreshold: 233,
  cabinetEligibleChamberKeys: ["shugiin", "sangiin"],
  legislature: {
    name: "Kokkai",
    path: "/country/jp/legislature",
    bicameral: true,
    upperChamber: {
      key: "sangiin",
      name: "Sangiin",
      shortName: "Sangiin",
      seats: 248,
      description:
        "248 councillors elected on staggered 6-year terms. Half are contested every 3 years. Cannot be dissolved.",
      elected: true,
    },
    lowerChamber: {
      key: "shugiin",
      name: "Shūgiin",
      shortName: "Shūgiin",
      seats: 465,
      description:
        "465 members elected by FPTP from regional constituencies. Invests confidence in the Cabinet.",
    },
  },
  lowerElectionSystem: {
    termYears: 4,
    seatsContested: "all",
    singleMemberConstituencies: true,
    snapElectionsAllowed: true,
  },
  upperElectionSystem: {
    termYears: 6,
    seatsContested: "partial",
    staggeredClasses: 2,
    singleMemberConstituencies: true,
    snapElectionsAllowed: false,
  },
  electionSystems: {
    lowerChamber: "pr_hareQuota",
    upperChamber: "pr_hareQuota",
    subNationalChamber: "pr_hareQuota",
    headOfGovernment: "parliamentary",
    headOfState: "ceremonial",
  },
  officeTypes: [
    {
      key: "primeMinister",
      label: "Prime Minister",
      labelPlural: "Prime Ministers",
      isExecutive: true,
      isSubNational: false,
      actionBonus: 4,
      partyStrengthWeight: 1,
    },
    {
      key: "shugiin",
      label: "Member of the House of Representatives",
      labelPlural: "Members of the House of Representatives",
      chamberKey: "shugiin",
      isExecutive: false,
      isSubNational: false,
      termYears: 4,
      actionBonus: 1,
      partyStrengthWeight: 0.85,
    },
    {
      key: "sangiin",
      label: "Member of the House of Councillors",
      labelPlural: "Members of the House of Councillors",
      chamberKey: "sangiin",
      isExecutive: false,
      isSubNational: false,
      termYears: 6,
      actionBonus: 1,
      partyStrengthWeight: 0.85,
    },
    {
      key: "regionalCouncil",
      label: "Regional Councillor",
      labelPlural: "Regional Councillors",
      chamberKey: "regionalCouncil",
      isExecutive: false,
      isSubNational: true,
      termYears: 4,
      actionBonus: 1,
      partyStrengthWeight: 0.85,
    },
    {
      key: "governor",
      label: "Governor",
      labelPlural: "Governors",
      isExecutive: false,
      isSubNational: true,
      termYears: 4,
      actionBonus: 2,
      partyStrengthWeight: 1,
    },
    {
      key: "centralBankChair",
      label: "Governor of the Bank of Japan",
      labelPlural: "Governors of the Bank of Japan",
      isExecutive: false,
      isSubNational: false,
      termYears: 5,
      actionBonus: 3,
      partyStrengthWeight: 0,
    },
  ],
  subNationalChamber: {
    key: "regionalCouncil",
    name: "Regional Council",
    shortName: "Regional Council",
    seats: 2679,
    description: "Elected regional councillors representing Japan's regions.",
    regionalModel: true,
  },
  majorPartyIds: ["ldp", "cdp"],
  partyCreationNPPs: {
    statesRequired: 2,
    lockHomeState: false,
    nppsPerState: 1,
  },
  demographicProfileId: "jp_archetypes",
  centralBank: {
    name: "Bank of Japan",
    abbreviation: "BoJ",
    chairTitle: "Governor of the Bank of Japan",
    defaultPrimeRate: 1,
    heroImage: "/api/images/hero/bank-of-japan",
  },
  exchangeName: "Nikkei",
  cabinetBillsEnabled: true,
  usdExchangeRate: 0.00943,
  currencyCode: "JPY",
  fiscalYearStartTurnInYear: 40,
  financeMinisterCabinetId: "finance_minister",
  status: "active",
  tagline:
    "Parliamentary democracy under the National Diet - FPTP lower house elections and a revising upper chamber.",
  descriptor:
    "A parliamentary constitutional monarchy where the Prime Minister leads government through confidence in the House of Representatives, alongside the House of Councillors and elected regional governments.",
  heroImage: "https://flagcdn.com/w640/jp.png",
  entryPath: "/country/jp",
  overviewPath: "/country/jp",
  mapPath: "/country/jp/map",
  executivePath: "/country/jp/executive",
  executiveLabel: "Naikaku Sōri Daijin Kantei",
  centralGovernmentLabel: "National Transfers",
  imperialTitles: {
    male: "Emperor",
    female: "Empress",
    nonbinary: "Emperor",
  },
  imperialCorporation: {
    name: "Chrysanthemum Properties",
    sector: "real_estate",
  },
};

export const JP_LEGISLATIVE_PROCESS: LegislativeProcess = {
  executive: {
    title: "The Emperor",
    canVeto: false,
    signLabel: "Promulgation",
    signNote: "The bill is promulgated by the Emperor on the Cabinet's advice — a formality.",
    override: null,
  },
  upperNote:
    "If the Sangiin (Councillors) rejects or amends a bill, the Shūgiin (Representatives) can override with a two-thirds majority.",
  dissolution: {
    actor: "Prime Minister",
    body: "The PM may dissolve the Shūgiin and call an election; bills in progress lapse.",
  },
  quirks: [
    {
      icon: "users",
      title: "Shūgiin override",
      body: "The lower house can override the Sangiin with a two-thirds vote.",
    },
    {
      icon: "doc",
      title: "Cabinet bills",
      body: "Most legislation is Cabinet-submitted (Kakuhō), not member-introduced.",
    },
    {
      icon: "bolt",
      title: "Dissolution",
      body: "The PM can dissolve the Shūgiin, ending all pending business.",
    },
  ],
  seatingStyle: "hemicycle",
};

/** Orders of battle for the base era. Per-era sets live in eras/. */
export const JP_ORDERS_OF_BATTLE: OrderOfBattleEntry[] = [
  {
    branchId: "nsf",
    type: "Infantry Division",
    count: 4,
  },
  {
    branchId: "nsf",
    type: "Artillery Regiment",
    count: 1,
  },
  {
    branchId: "csf",
    type: "Frigate Squadron",
    count: 2,
  },
  {
    branchId: "jgsdf",
    type: "Infantry Division",
    count: 5,
  },
  {
    branchId: "jgsdf",
    type: "Mechanized Brigade",
    count: 2,
  },
  {
    branchId: "jgsdf",
    type: "Artillery Regiment",
    count: 2,
  },
  {
    branchId: "jgsdf",
    type: "Air Defense Battalion",
    count: 1,
  },
  {
    branchId: "jmsdf",
    type: "Frigate Squadron",
    count: 4,
  },
  {
    branchId: "jmsdf",
    type: "Attack Submarine",
    count: 2,
  },
  {
    branchId: "jmsdf",
    type: "Guided-Missile Destroyer",
    count: 1,
  },
  {
    branchId: "jasdf",
    type: "Fighter Wing",
    count: 4,
  },
  {
    branchId: "jasdf",
    type: "Air Defense Wing",
    count: 2,
  },
  {
    branchId: "jasdf",
    type: "Airlift Wing",
    count: 1,
  },
];

export const JP_MILITARY_BRANCHES: Branch[] = [
  {
    id: "nsf",
    name: "National Safety Force",
    abbr: "NSF",
    domain: "ground",
    establishedYear: 1952,
    dissolvedYear: 1954,
  },
  {
    id: "csf",
    name: "Coastal Safety Force",
    abbr: "CSF",
    domain: "naval",
    establishedYear: 1952,
    dissolvedYear: 1954,
  },
  {
    id: "jgsdf",
    name: "Ground Self-Defense Force",
    abbr: "JGSDF",
    domain: "ground",
    establishedYear: 1954,
  },
  {
    id: "jmsdf",
    name: "Maritime Self-Defense Force",
    abbr: "JMSDF",
    domain: "naval",
    establishedYear: 1954,
  },
  {
    id: "jasdf",
    name: "Air Self-Defense Force",
    abbr: "JASDF",
    domain: "air",
    establishedYear: 1954,
  },
];

export const JP_ESTATE_PORTFOLIO: Record<string, string> = {
  foreign_affairs_minister: "foreign",
  justice_minister: "justice",
  health_minister: "health",
  education_minister: "education",
  economy_minister: "commerce",
  environment_minister: "interior",
  internal_affairs_minister: "homeland",
};

/**
 * ⚠️ ESTATE_PORTFOLIO_BY_COUNTRY is a portfolio MAP, not a position id. The five
 * entries below are each one seat id or null; that one is a record.
 */
/**
 * Which seat id fills each cross-country cabinet role.
 *
 * ⚠️ THESE ARE SEAT IDS, NOT TITLES. Each names a key in
 * `JP_CABINET_POSITIONS`; the displayed title lives there. They are also NOT
 * uniformly optional across countries -- a country that genuinely has no such
 * seat says so with null, which is different from omitting the key.
 */
export const JP_CABINET_SEAT_IDS = {
  energy: "environment_minister",
  infrastructure: "land_minister",
  defense: "defense_minister",
  foreignAffairs: "foreign_affairs_minister",
  tradeMinister: "economy_minister",
} as const;

/** Military scale multiplier. */
export const JP_MILITARY_SCALE = 1.4;

/** Which office assents to regional bills. */
export const JP_REGIONAL_BILL_ASSENT_OFFICE_KEY = "governor";
