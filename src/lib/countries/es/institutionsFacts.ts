import type { Branch } from "@/lib/constants/military";

import type { CountryConfig } from "@/lib/constants/countries";

import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";

/**
 * ES's institutions, as pure data.
 *
 * ⚠ GENERATED FROM `__snapshots__/es.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-institutions.ts ES --force
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair:
 * registries that want one seat id or the legislative process import from HERE,
 * while `institutions.ts` composes these with the cabinet and is heavy. A
 * registry that reads a single string through the heavy module ships the whole
 * cabinet to the browser, which is a regression this work has already shipped
 * once. `clientSafeLeafModules.test.ts` enforces it.
 */

export const ES_CONFIG: CountryConfig = {
  id: "ES",
  name: "Spain",
  flagEmoji: "🇪🇸",
  code: "ES",
  socialAxisBaseline: 1,
  regionLabel: "Autonomous Community",
  regionLabelPlural: "Autonomous Communities",
  executiveTitle: "Prime Minister",
  headOfStateTitle: "King",
  executiveRealmPhrase: "Spain",
  governmentType: "parliamentaryMonarchy",
  governmentTypeLabel: "Parliamentary Monarchy",
  coalitionThreshold: 176,
  legislature: {
    name: "Cortes Generales",
    path: "/country/es/legislature",
    bicameral: true,
    upperChamber: {
      key: "senado",
      name: "Senate",
      shortName: "Senado",
      seats: 208,
      description:
        "208 senators elected on a provincial basis (plus regional appointees) for four-year terms.",
      elected: true,
    },
    lowerChamber: {
      key: "congresoDiputados",
      name: "Congress of Deputies",
      shortName: "Congreso",
      seats: 350,
      description:
        "350 deputies elected by proportional representation (D'Hondt) in provincial constituencies for four-year terms.",
      elected: true,
    },
  },
  lowerElectionSystem: {
    termYears: 4,
    seatsContested: "all",
    singleMemberConstituencies: false,
    snapElectionsAllowed: true,
  },
  upperElectionSystem: {
    termYears: 4,
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
      termYears: 4,
      actionBonus: 4,
      partyStrengthWeight: 1,
    },
    {
      key: "monarch",
      label: "King",
      labelPlural: "Kings",
      isExecutive: true,
      isHeadOfState: true,
      isSubNational: false,
      termYears: 0,
      actionBonus: 0,
      partyStrengthWeight: 0,
    },
    {
      key: "deputy",
      label: "Deputy",
      labelPlural: "Deputies",
      chamberKey: "congresoDiputados",
      isExecutive: false,
      isSubNational: false,
      termYears: 4,
      actionBonus: 1,
      partyStrengthWeight: 0.9,
    },
    {
      key: "senator",
      label: "Senator",
      labelPlural: "Senators",
      chamberKey: "senado",
      isExecutive: false,
      isSubNational: false,
      termYears: 4,
      actionBonus: 1,
      partyStrengthWeight: 0.8,
    },
    {
      key: "centralBankChair",
      label: "Governor of the Banco de España",
      labelPlural: "Governors of the Banco de España",
      isExecutive: false,
      isSubNational: false,
      termYears: 6,
      actionBonus: 3,
      partyStrengthWeight: 0,
    },
  ],
  majorPartyIds: ["es_ucd", "es_psoe"],
  partyCreationNPPs: {
    statesRequired: 2,
    lockHomeState: false,
    nppsPerState: 1,
  },
  demographicProfileId: "es_archetypes",
  centralBank: {
    name: "Banco de España",
    abbreviation: "BdE",
    chairTitle: "Governor of the Banco de España",
    defaultPrimeRate: 14,
    heroImage: "https://flagcdn.com/w640/es.png",
  },
  usdExchangeRate: 0.0149,
  currencyCode: "ESP",
  fiscalYearStartTurnInYear: 40,
  financeMinisterCabinetId: "minister_of_finance",
  status: "coming-soon",
  tagline:
    "The young democracy - a restored monarchy, a fragile centrist government, and a country building its autonomous communities barely four years after Franco.",
  descriptor:
    "A parliamentary monarchy under the 1978 Constitution: a Prime Minister governs at the confidence of a 350-seat Congress and a 208-seat Senate, as Spain devolves power to its new autonomous communities.",
  heroImage: "https://flagcdn.com/w640/es.png",
  entryPath: "/country/es",
  overviewPath: "/country/es",
  mapPath: "/country/es/map",
  executivePath: "/country/es/executive",
  executiveLabel: "Moncloa",
  centralGovernmentLabel: "State Budget",
};

/* No ES_LEGISLATIVE_PROCESS: the registry has no ES row, and readers
   fall through to DEFAULT_PROCESS. The registry holds six keys; a country absent
   from it has never had its own process, and writing the default here would say
   it did. */

export const ES_ORDERS_OF_BATTLE: OrderOfBattleEntry[] = [
  {
    branchId: "tierra",
    type: "Infantry Division",
    count: 4,
  },
  {
    branchId: "tierra",
    type: "Armored Division",
    count: 1,
  },
  {
    branchId: "tierra",
    type: "Artillery Regiment",
    count: 2,
  },
  {
    branchId: "armada",
    type: "Frigate Squadron",
    count: 2,
  },
  {
    branchId: "aire",
    type: "Fighter Wing",
    count: 2,
  },
];

export const ES_MILITARY_BRANCHES: Branch[] = [
  {
    id: "tierra",
    name: "Army",
    abbr: "ET",
    domain: "ground",
  },
  {
    id: "armada",
    name: "Navy",
    abbr: "AE",
    domain: "naval",
  },
  {
    id: "aire",
    name: "Air Force",
    abbr: "EA",
    domain: "air",
  },
];

/* No ES_ESTATE_PORTFOLIO: no row; seedCabinetEstates skips the country. */

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
export const ES_CABINET_SEAT_IDS = {
  energy: undefined,
  infrastructure: undefined,
  defense: "minister_of_defence",
  foreignAffairs: "minister_of_foreign_affairs",
  tradeMinister: "minister_of_trade_industry",
} as const;

/** Military scale multiplier. */
export const ES_MILITARY_SCALE = 1;

/** Which office assents to regional bills. */
/* No ES_REGIONAL_BILL_ASSENT_OFFICE_KEY: the registry has no ES entry.
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
/* No ES_CABINET_GROUPS: the registry has no ES row, and its only
   reader already falls back to "Centre" per position. */
