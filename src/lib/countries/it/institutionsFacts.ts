import type { Branch } from "@/lib/constants/military";

import type { CountryConfig } from "@/lib/constants/countries";

import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";

/**
 * IT's institutions, as pure data.
 *
 * ⚠ GENERATED FROM `__snapshots__/it.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-institutions.ts IT --force
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair:
 * registries that want one seat id or the legislative process import from HERE,
 * while `institutions.ts` composes these with the cabinet and is heavy. A
 * registry that reads a single string through the heavy module ships the whole
 * cabinet to the browser, which is a regression this work has already shipped
 * once. `clientSafeLeafModules.test.ts` enforces it.
 */

export const IT_CONFIG: CountryConfig = {
  id: "IT",
  name: "Italy",
  flagEmoji: "🇮🇹",
  code: "IT",
  socialAxisBaseline: 1,
  regionLabel: "Region",
  regionLabelPlural: "Regions",
  executiveTitle: "Prime Minister",
  headOfStateTitle: "President",
  executiveRealmPhrase: "Italy",
  governmentType: "parliamentaryRepublic",
  governmentTypeLabel: "Parliamentary Republic",
  coalitionThreshold: 316,
  legislature: {
    name: "Parliament",
    path: "/country/it/legislature",
    bicameral: true,
    upperChamber: {
      key: "senato",
      name: "Senate of the Republic",
      shortName: "Senato",
      seats: 315,
      description:
        "315 elected senators (plus a few senators-for-life), elected on a regional basis for five-year terms.",
      elected: true,
    },
    lowerChamber: {
      key: "cameraDeputati",
      name: "Chamber of Deputies",
      shortName: "Camera",
      seats: 630,
      description: "630 deputies elected by proportional representation for five-year terms.",
      elected: true,
    },
  },
  lowerElectionSystem: {
    termYears: 5,
    seatsContested: "all",
    singleMemberConstituencies: false,
    snapElectionsAllowed: true,
  },
  upperElectionSystem: {
    termYears: 5,
    seatsContested: "all",
    singleMemberConstituencies: false,
    snapElectionsAllowed: true,
  },
  electionSystems: {
    lowerChamber: "pr_hareQuota",
    upperChamber: "pr_hareQuota",
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
      termYears: 7,
      actionBonus: 0,
      partyStrengthWeight: 0,
    },
    {
      key: "deputy",
      label: "Deputy",
      labelPlural: "Deputies",
      chamberKey: "cameraDeputati",
      isExecutive: false,
      isSubNational: false,
      termYears: 5,
      actionBonus: 1,
      partyStrengthWeight: 0.9,
    },
    {
      key: "senator",
      label: "Senator",
      labelPlural: "Senators",
      chamberKey: "senato",
      isExecutive: false,
      isSubNational: false,
      termYears: 5,
      actionBonus: 1,
      partyStrengthWeight: 0.8,
    },
    {
      key: "centralBankChair",
      label: "Governor of the Banca d'Italia",
      labelPlural: "Governors of the Banca d'Italia",
      isExecutive: false,
      isSubNational: false,
      termYears: 6,
      actionBonus: 3,
      partyStrengthWeight: 0,
    },
  ],
  majorPartyIds: ["it_dc", "it_pci"],
  partyCreationNPPs: {
    statesRequired: 2,
    lockHomeState: false,
    nppsPerState: 1,
  },
  demographicProfileId: "it_archetypes",
  centralBank: {
    name: "Banca d'Italia",
    abbreviation: "BdI",
    chairTitle: "Governor of the Banca d'Italia",
    defaultPrimeRate: 12,
    heroImage: "https://flagcdn.com/w640/it.png",
  },
  usdExchangeRate: 0.0012,
  currencyCode: "ITL",
  fiscalYearStartTurnInYear: 40,
  financeMinisterCabinetId: "minister_of_finance",
  status: "coming-soon",
  tagline:
    "The First Republic - a ceremonial President and a fragile Prime Minister governing through a powerful bicameral Parliament, with Europe's largest Communist party in opposition.",
  descriptor:
    "A parliamentary republic where a Prime Minister governs at the confidence of a 630-seat Chamber and a 315-seat Senate, amid the unstable DC-led coalitions of the historic-compromise era.",
  heroImage: "https://flagcdn.com/w640/it.png",
  entryPath: "/country/it",
  overviewPath: "/country/it",
  mapPath: "/country/it/map",
  executivePath: "/country/it/executive",
  executiveLabel: "Palazzo Chigi",
  centralGovernmentLabel: "State Budget",
};

/* No IT_LEGISLATIVE_PROCESS: the registry has no IT row, and readers
   fall through to DEFAULT_PROCESS. The registry holds six keys; a country absent
   from it has never had its own process, and writing the default here would say
   it did. */

export const IT_ORDERS_OF_BATTLE: OrderOfBattleEntry[] = [
  {
    branchId: "esercito",
    type: "Infantry Division",
    count: 4,
  },
  {
    branchId: "esercito",
    type: "Armored Division",
    count: 2,
  },
  {
    branchId: "esercito",
    type: "Artillery Regiment",
    count: 2,
  },
  {
    branchId: "marina",
    type: "Frigate Squadron",
    count: 3,
  },
  {
    branchId: "marina",
    type: "Attack Submarine",
    count: 1,
  },
  {
    branchId: "aeronautica",
    type: "Fighter Wing",
    count: 3,
  },
];

export const IT_MILITARY_BRANCHES: Branch[] = [
  {
    id: "esercito",
    name: "Army",
    abbr: "EI",
    domain: "ground",
  },
  {
    id: "marina",
    name: "Navy",
    abbr: "MM",
    domain: "naval",
  },
  {
    id: "aeronautica",
    name: "Air Force",
    abbr: "AM",
    domain: "air",
  },
];

/* No IT_ESTATE_PORTFOLIO: no row; seedCabinetEstates skips the country. */

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
export const IT_CABINET_SEAT_IDS = {
  energy: undefined,
  infrastructure: undefined,
  defense: "minister_of_defence",
  foreignAffairs: "minister_of_foreign_affairs",
  tradeMinister: "minister_of_trade_industry",
} as const;

/** Military scale multiplier. */
export const IT_MILITARY_SCALE = 1.2;

/** Which office assents to regional bills. */
/* No IT_REGIONAL_BILL_ASSENT_OFFICE_KEY: the registry has no IT entry.
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
/* No IT_CABINET_GROUPS: the registry has no IT row, and its only
   reader already falls back to "Centre" per position. */
