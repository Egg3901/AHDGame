import type { Branch } from "@/lib/constants/military";
import type { CabinetGroup } from "@/lib/constants/cabinetPositionGroups";
import type { CountryConfig } from "@/lib/constants/countries";
import type { LegislativeProcess } from "@/lib/legislature/process";
import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";

/**
 * UK's institutions, as pure data.
 *
 * ⚠ GENERATED FROM `__snapshots__/uk.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-institutions.ts UK --force
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair:
 * registries that want one seat id or the legislative process import from HERE,
 * while `institutions.ts` composes these with the cabinet and is heavy. A
 * registry that reads a single string through the heavy module ships the whole
 * cabinet to the browser, which is a regression this work has already shipped
 * once. `clientSafeLeafModules.test.ts` enforces it.
 */

export const UK_CONFIG: CountryConfig = {
  id: "UK",
  seedEconomicModel: {
    "1991": "financialized",
    "2019": "financialized",
  },
  name: "United Kingdom",
  flagEmoji: "🇬🇧",
  code: "GB",
  socialAxisBaseline: -1.5,
  regionLabel: "Nation",
  regionLabelPlural: "Nations & Regions",
  executiveTitle: "Prime Minister",
  executiveRealmPhrase: "the United Kingdom",
  governmentType: "parliamentaryMonarchy",
  governmentTypeLabel: "Constitutional Monarchy",
  coalitionThreshold: 326,
  legislature: {
    name: "Parliament",
    path: "/country/uk/legislature",
    bicameral: false,
    upperChamber: {
      key: "lords",
      name: "House of Lords",
      shortName: "Lords",
      seats: 784,
      description: "Appointed and hereditary peers. Revises and scrutinises legislation.",
    },
    lowerChamber: {
      key: "commons",
      name: "House of Commons",
      shortName: "Commons",
      seats: 650,
      description:
        "650 elected MPs from single-member constituencies. The primary legislative chamber.",
    },
  },
  lowerElectionSystem: {
    termYears: 5,
    seatsContested: "all",
    singleMemberConstituencies: true,
    snapElectionsAllowed: true,
  },
  electionSystems: {
    lowerChamber: "pr_hareQuota",
    subNationalChamber: "pr_hareQuota",
    headOfGovernment: "parliamentary",
    headOfState: "ceremonial",
  },
  subNationalChamber: {
    key: "regionalCouncil",
    name: "Regional Council",
    shortName: "Regional Council",
    seats: 364,
    description:
      "Elected regional councillors representing UK nations and regions on staggered five-year terms.",
    regionalModel: true,
  },
  regionalBillAssentTitle: "First Minister",
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
      key: "commons",
      label: "Member of Parliament",
      labelPlural: "Members of Parliament",
      chamberKey: "commons",
      isExecutive: false,
      isSubNational: false,
      termYears: 5,
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
      termYears: 5,
      actionBonus: 1,
      partyStrengthWeight: 0.85,
    },
    {
      key: "governor",
      label: "First Minister",
      labelPlural: "First Ministers",
      isExecutive: false,
      isSubNational: true,
      termYears: 4,
      actionBonus: 2,
      partyStrengthWeight: 1,
    },
    {
      key: "centralBankChair",
      label: "Governor of the Bank of England",
      labelPlural: "Governors of the Bank of England",
      isExecutive: false,
      isSubNational: false,
      termYears: 4,
      actionBonus: 3,
      partyStrengthWeight: 0,
    },
  ],
  majorPartyIds: ["LAB", "CON"],
  partyCreationNPPs: {
    statesRequired: 2,
    lockHomeState: false,
    nppsPerState: 1,
  },
  demographicProfileId: "uk_archetypes",
  centralBank: {
    name: "Bank of England",
    abbreviation: "BoE",
    chairTitle: "Governor of the Bank of England",
    defaultPrimeRate: 3,
    heroImage: "/api/images/hero/bank-of-england",
    heroAlt: "Bank of England, Threadneedle Street, London",
  },
  exchangeName: "FTSE",
  usdExchangeRate: 1,
  currencyCode: "GBP",
  fiscalYearStartTurnInYear: 40,
  financeMinisterCabinetId: "chancellor",
  status: "active",
  tagline:
    "Westminster parliamentary democracy - 650 constituencies, First Minister elections, and a Prime Minister.",
  descriptor:
    "A constitutional monarchy and parliamentary democracy across four nations, where the Prime Minister leads the government through a majority in the 650-seat House of Commons.",
  heroImage: "https://flagcdn.com/w640/gb.png",
  entryPath: "/country/uk",
  overviewPath: "/country/uk",
  mapPath: "/country/uk/map",
  executivePath: "/country/uk/executive",
  executiveLabel: "10 Downing Street",
  centralGovernmentLabel: "Westminster Funding",
  imperialTitles: {
    male: "King",
    female: "Queen",
    nonbinary: "Monarch",
  },
  imperialPossessives: {
    male: "His Majesty's",
    female: "Her Majesty's",
    nonbinary: "The Monarch's",
  },
  imperialCorporation: {
    name: "Royal Estate",
    sector: "real_estate",
  },
};

export const UK_LEGISLATIVE_PROCESS: LegislativeProcess = {
  executive: {
    title: "The Crown",
    canVeto: false,
    signLabel: "Royal Assent",
    signNote: "Royal Assent is a constitutional formality — it has not been refused since 1708.",
    override: null,
  },
  upperNote:
    "The Lords may revise or delay a bill, but under the Parliament Acts the Commons ultimately prevails — and the Lords cannot block a money bill.",
  dissolution: {
    actor: "Prime Minister",
    body: "The PM may call a snap general election. Parliament is dissolved and all bills still in progress fall.",
  },
  quirks: [
    {
      icon: "building",
      title: "Commons supremacy",
      body: "The Lords can delay but not block; the Parliament Acts let the Commons override.",
    },
    {
      icon: "bolt",
      title: "Snap election",
      body: "A PM-called general election dissolves Parliament and kills all active legislation.",
    },
    {
      icon: "doc",
      title: "Royal Assent",
      body: "Assent by the Crown is automatic — a formality, never refused in practice.",
    },
  ],
  seatingStyle: "benches",
};

export const UK_ORDERS_OF_BATTLE: OrderOfBattleEntry[] = [
  {
    branchId: "army",
    type: "Infantry Division",
    count: 6,
  },
  {
    branchId: "army",
    type: "Armored Division",
    count: 2,
  },
  {
    branchId: "army",
    type: "Artillery Regiment",
    count: 2,
  },
  {
    branchId: "navy",
    type: "Carrier Strike Group",
    count: 2,
  },
  {
    branchId: "navy",
    type: "Attack Submarine",
    count: 2,
  },
  {
    branchId: "navy",
    type: "Frigate Squadron",
    count: 4,
  },
  {
    branchId: "navy",
    type: "Amphibious Group",
    count: 1,
  },
  {
    branchId: "raf",
    type: "Fighter Wing",
    count: 4,
  },
  {
    branchId: "raf",
    type: "Bomber Squadron",
    count: 3,
  },
  {
    branchId: "raf",
    type: "Air Defense Wing",
    count: 1,
  },
  {
    branchId: "raf",
    type: "Airlift Wing",
    count: 1,
  },
];

export const UK_MILITARY_BRANCHES: Branch[] = [
  {
    id: "army",
    name: "British Army",
    abbr: "Army",
    domain: "ground",
  },
  {
    id: "navy",
    name: "Royal Navy",
    abbr: "RN",
    domain: "naval",
  },
  {
    id: "raf",
    name: "Royal Air Force",
    abbr: "RAF",
    domain: "air",
  },
];

export const UK_ESTATE_PORTFOLIO: Record<string, string> = {
  foreign_secretary: "foreign",
  home_secretary: "homeland",
  justice_secretary: "justice",
  health_secretary: "health",
  education_secretary: "education",
  business_secretary: "commerce",
  levelling_secretary: "housing",
  environment_secretary: "interior",
  work_secretary: "labor",
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
export const UK_CABINET_SEAT_IDS = {
  energy: "environment_secretary",
  infrastructure: "transport_secretary",
  defense: "defence_secretary",
  foreignAffairs: "foreign_secretary",
  tradeMinister: "business_secretary",
} as const;

/** Military scale multiplier. */
export const UK_MILITARY_SCALE = 1.7;

/** Which office assents to regional bills. */
export const UK_REGIONAL_BILL_ASSENT_OFFICE_KEY = "governor";

/**
 * Which policy bucket each cabinet seat belongs to, for the cabinet UI.
 *
 * ⚠ THE CAST IS LOAD-BEARING. `CabinetGroup` is a union of bucket names, and
 * JSON.parse widens every one of them to `string`. Without it the object is
 * `Record<string, string>`, which is not assignable to `Record<string, CabinetGroup>`
 * and fails only under `npm run typecheck` -- eslint and the test suite both pass.
 */
export const UK_CABINET_GROUPS: Record<string, CabinetGroup> = {
  director_of_intelligence: "Security & Foreign",
  deputy_prime_minister: "Centre",
  first_secretary_of_state: "Centre",
  chancellor: "Economy",
  business_secretary: "Economy",
  work_secretary: "Economy",
  foreign_secretary: "Security & Foreign",
  home_secretary: "Security & Foreign",
  defence_secretary: "Security & Foreign",
  justice_secretary: "Security & Foreign",
  health_secretary: "Society",
  education_secretary: "Society",
  levelling_secretary: "Society",
  transport_secretary: "Domestic",
  agriculture_secretary: "Domestic",
  environment_secretary: "Domestic",
  northern_ireland: "Nations",
  scotland: "Nations",
  wales: "Nations",
  chief_whip: "Centre",
};
