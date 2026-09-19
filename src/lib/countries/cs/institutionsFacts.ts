import type { Branch } from "@/lib/constants/military";

import type { CountryConfig } from "@/lib/constants/countries";

import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";

/**
 * CS's institutions, as pure data.
 *
 * ⚠ GENERATED FROM `__snapshots__/cs.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-institutions.ts CS --force
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair:
 * registries that want one seat id or the legislative process import from HERE,
 * while `institutions.ts` composes these with the cabinet and is heavy. A
 * registry that reads a single string through the heavy module ships the whole
 * cabinet to the browser, which is a regression this work has already shipped
 * once. `clientSafeLeafModules.test.ts` enforces it.
 */

export const CS_CONFIG: CountryConfig = {
  id: "CS",
  name: "Czechoslovakia",
  flagEmoji: "🇨🇿",
  code: "CS",
  socialAxisBaseline: 2.5,
  regionLabel: "Region",
  regionLabelPlural: "Regions",
  executiveTitle: "General Secretary",
  headOfStateTitle: "President of the Republic",
  executiveRealmPhrase: "Czechoslovakia",
  governmentType: "onePartyState",
  rulingPartyId: 1,
  governmentTypeLabel: "One Party State",
  coalitionThreshold: 176,
  legislature: {
    name: "Federal Assembly",
    path: "/country/cs/legislature",
    bicameral: false,
    upperChamber: {
      key: "chamberOfNations",
      name: "Chamber of Nations",
      shortName: "Nations",
      seats: 150,
      description:
        "The Chamber of Nations - the federal chamber representing the Czech and Slovak republics.",
      elected: true,
    },
    lowerChamber: {
      key: "chamberOfThePeople",
      name: "Chamber of the People",
      shortName: "People",
      seats: 200,
      description:
        "200 deputies of the Chamber of the People, elected to five-year terms - a single-list body controlled by the ruling communist party within the National Front.",
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
      key: "assemblyDeputy",
      label: "Deputy",
      labelPlural: "Deputies",
      chamberKey: "chamberOfThePeople",
      isExecutive: false,
      isSubNational: false,
      termYears: 5,
      actionBonus: 1,
      partyStrengthWeight: 0.9,
    },
    {
      key: "centralBankChair",
      label: "Governor of the SBČS",
      labelPlural: "Governors of the SBČS",
      isExecutive: false,
      isSubNational: false,
      termYears: 6,
      actionBonus: 3,
      partyStrengthWeight: 0,
    },
  ],
  majorPartyIds: ["ksc"],
  partyCreationNPPs: {
    statesRequired: 1,
    lockHomeState: true,
    nppsPerState: 2,
  },
  demographicProfileId: "cs_archetypes",
  centralBank: {
    name: "State Bank of Czechoslovakia",
    abbreviation: "SBČS",
    chairTitle: "Governor of the SBČS",
    defaultPrimeRate: 4,
    heroImage:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cb/Flag_of_the_Czech_Republic.svg/500px-Flag_of_the_Czech_Republic.svg.png",
  },
  exchangeName: "SPK",
  exchangeKind: "stateRegister",
  usdExchangeRate: 0.13,
  currencyCode: "CSK",
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
    'An industrialized one-party federation a decade after the crushed Prague Spring - "normalization" Czechoslovakia.',
  descriptor:
    "A one-party socialist federation where the ruling communist party's General Secretary governs through the bicameral Federal Assembly; the economy is centrally planned until reform.",
  heroImage:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cb/Flag_of_the_Czech_Republic.svg/500px-Flag_of_the_Czech_Republic.svg.png",
  entryPath: "/country/cs",
  overviewPath: "/country/cs",
  mapPath: "/country/cs/map",
  executivePath: "/country/cs/executive",
  executiveLabel: "Assembly",
  centralGovernmentLabel: "Central Plan",
};

/* No CS_LEGISLATIVE_PROCESS: the registry has no CS row, and readers
   fall through to DEFAULT_PROCESS. The registry holds six keys; a country absent
   from it has never had its own process, and writing the default here would say
   it did. */

export const CS_ORDERS_OF_BATTLE: OrderOfBattleEntry[] = [
  {
    branchId: "ground",
    type: "Infantry Division",
    count: 4,
  },
  {
    branchId: "ground",
    type: "Armored Division",
    count: 2,
  },
  {
    branchId: "ground",
    type: "Artillery Regiment",
    count: 2,
  },
  {
    branchId: "airforce",
    type: "Fighter Wing",
    count: 3,
  },
  {
    branchId: "airforce",
    type: "Air Defense Wing",
    count: 1,
  },
];

export const CS_MILITARY_BRANCHES: Branch[] = [
  {
    id: "ground",
    name: "Ground Forces",
    abbr: "PV",
    domain: "ground",
    dissolvedYear: 1993,
  },
  {
    id: "airforce",
    name: "Air Force",
    abbr: "CSL",
    domain: "air",
    dissolvedYear: 1993,
  },
];

/* No CS_ESTATE_PORTFOLIO: no row; seedCabinetEstates skips the country. */

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
export const CS_CABINET_SEAT_IDS = {
  energy: undefined,
  infrastructure: undefined,
  defense: "minister_of_defence",
  foreignAffairs: "minister_of_foreign_affairs",
  tradeMinister: null,
} as const;

/** Military scale multiplier. */
export const CS_MILITARY_SCALE = 1;

/** Which office assents to regional bills. */
/* No CS_REGIONAL_BILL_ASSENT_OFFICE_KEY: the registry has no CS entry.
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
/* No CS_CABINET_GROUPS: the registry has no CS row, and its only
   reader already falls back to "Centre" per position. */
