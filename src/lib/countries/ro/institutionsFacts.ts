import type { Branch } from "@/lib/constants/military";

import type { CountryConfig } from "@/lib/constants/countries";

import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";

/**
 * RO's institutions, as pure data.
 *
 * ⚠ GENERATED FROM `__snapshots__/ro.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-institutions.ts RO --force
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair:
 * registries that want one seat id or the legislative process import from HERE,
 * while `institutions.ts` composes these with the cabinet and is heavy. A
 * registry that reads a single string through the heavy module ships the whole
 * cabinet to the browser, which is a regression this work has already shipped
 * once. `clientSafeLeafModules.test.ts` enforces it.
 */

export const RO_CONFIG: CountryConfig = {
  id: "RO",
  name: "Romania",
  flagEmoji: "🇷🇴",
  code: "RO",
  socialAxisBaseline: 3,
  regionLabel: "Region",
  regionLabelPlural: "Regions",
  executiveTitle: "General Secretary",
  headOfStateTitle: "President of the Republic",
  executiveRealmPhrase: "Romania",
  governmentType: "onePartyState",
  rulingPartyId: 1,
  governmentTypeLabel: "One Party State",
  coalitionThreshold: 186,
  legislature: {
    name: "Grand National Assembly",
    path: "/country/ro/legislature",
    bicameral: false,
    upperChamber: {
      key: "stateCouncil",
      name: "State Council",
      shortName: "Council",
      seats: 21,
      description:
        "A collective head of state exercising standing authority between Assembly sessions; chosen by the Grand National Assembly.",
      elected: false,
    },
    lowerChamber: {
      key: "grandNationalAssembly",
      name: "Grand National Assembly",
      shortName: "Assembly",
      seats: 369,
      description:
        "369 deputies of the Marea Adunare Națională, elected to five-year terms - a single-list body controlled by the ruling communist party.",
      elected: true,
    },
  },
  lowerElectionSystem: {
    termYears: 5,
    seatsContested: "all",
    singleMemberConstituencies: true,
    snapElectionsAllowed: false,
  },
  electionSystems: {
    lowerChamber: "fptp",
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
      key: "presidentOfStateCouncil",
      label: "President of the State Council",
      labelPlural: "Presidents of the State Council",
      isExecutive: true,
      isHeadOfState: true,
      isSubNational: false,
      actionBonus: 0,
      partyStrengthWeight: 0,
    },
    {
      key: "assemblyDeputy",
      label: "Deputy",
      labelPlural: "Deputies",
      chamberKey: "grandNationalAssembly",
      isExecutive: false,
      isSubNational: false,
      termYears: 5,
      actionBonus: 1,
      partyStrengthWeight: 0.9,
    },
    {
      key: "centralBankChair",
      label: "Governor of the BNR",
      labelPlural: "Governors of the BNR",
      isExecutive: false,
      isSubNational: false,
      termYears: 6,
      actionBonus: 3,
      partyStrengthWeight: 0,
    },
  ],
  majorPartyIds: ["pcr"],
  partyCreationNPPs: {
    statesRequired: 1,
    lockHomeState: true,
    nppsPerState: 2,
  },
  demographicProfileId: "ro_archetypes",
  centralBank: {
    name: "National Bank of Romania",
    abbreviation: "BNR",
    chairTitle: "Governor of the BNR",
    defaultPrimeRate: 5,
    heroImage: "https://flagcdn.com/w640/ro.png",
  },
  exchangeName: "CSP",
  exchangeKind: "stateRegister",
  usdExchangeRate: 0.22,
  currencyCode: "ROL",
  fiscalYearStartTurnInYear: 40,
  financeMinisterCabinetId: "minister_of_finance",
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
  status: "coming-soon",
  tagline:
    "A one-party People's Republic pursuing an idiosyncratic, increasingly autocratic national-communism.",
  descriptor:
    "A one-party socialist state where the ruling communist party's General Secretary governs through the Grand National Assembly; the economy is centrally planned until reform.",
  heroImage: "https://flagcdn.com/w640/ro.png",
  entryPath: "/country/ro",
  overviewPath: "/country/ro",
  mapPath: "/country/ro/map",
  executivePath: "/country/ro/executive",
  executiveLabel: "Assembly",
  centralGovernmentLabel: "Central Plan",
};

/* No RO_LEGISLATIVE_PROCESS: the registry has no RO row, and readers
   fall through to DEFAULT_PROCESS. The registry holds six keys; a country absent
   from it has never had its own process, and writing the default here would say
   it did. */

export const RO_ORDERS_OF_BATTLE: OrderOfBattleEntry[] = [
  {
    branchId: "ground",
    type: "Infantry Division",
    count: 4,
  },
  {
    branchId: "ground",
    type: "Mechanized Brigade",
    count: 2,
  },
  {
    branchId: "ground",
    type: "Artillery Regiment",
    count: 2,
  },
  {
    branchId: "navy",
    type: "Frigate Squadron",
    count: 1,
  },
  {
    branchId: "airforce",
    type: "Fighter Wing",
    count: 2,
  },
];

export const RO_MILITARY_BRANCHES: Branch[] = [
  {
    id: "ground",
    name: "Land Forces",
    abbr: "FT",
    domain: "ground",
  },
  {
    id: "navy",
    name: "Naval Forces",
    abbr: "FN",
    domain: "naval",
  },
  {
    id: "airforce",
    name: "Air Force",
    abbr: "FA",
    domain: "air",
  },
];

/* No RO_ESTATE_PORTFOLIO: no row; seedCabinetEstates skips the country. */

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
export const RO_CABINET_SEAT_IDS = {
  energy: undefined,
  infrastructure: undefined,
  defense: "minister_of_defence",
  foreignAffairs: "minister_of_foreign_affairs",
  tradeMinister: null,
} as const;

/** Military scale multiplier. */
export const RO_MILITARY_SCALE = 0.9;

/** Which office assents to regional bills. */
/* No RO_REGIONAL_BILL_ASSENT_OFFICE_KEY: the registry has no RO entry.
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
/* No RO_CABINET_GROUPS: the registry has no RO row, and its only
   reader already falls back to "Centre" per position. */
