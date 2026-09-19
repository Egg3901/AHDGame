import type { Branch } from "@/lib/constants/military";

import type { CountryConfig } from "@/lib/constants/countries";

import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";

/**
 * HU's institutions, as pure data.
 *
 * ⚠ GENERATED FROM `__snapshots__/hu.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-institutions.ts HU --force
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair:
 * registries that want one seat id or the legislative process import from HERE,
 * while `institutions.ts` composes these with the cabinet and is heavy. A
 * registry that reads a single string through the heavy module ships the whole
 * cabinet to the browser, which is a regression this work has already shipped
 * once. `clientSafeLeafModules.test.ts` enforces it.
 */

export const HU_CONFIG: CountryConfig = {
  id: "HU",
  name: "Hungary",
  flagEmoji: "🇭🇺",
  code: "HU",
  socialAxisBaseline: 2.5,
  regionLabel: "Region",
  regionLabelPlural: "Regions",
  executiveTitle: "General Secretary",
  headOfStateTitle: "Chairman of the Presidential Council",
  executiveRealmPhrase: "Hungary",
  governmentType: "onePartyState",
  rulingPartyId: 1,
  governmentTypeLabel: "One Party State",
  coalitionThreshold: 177,
  legislature: {
    name: "National Assembly",
    path: "/country/hu/legislature",
    bicameral: false,
    upperChamber: {
      key: "presidentialCouncil",
      name: "Presidential Council",
      shortName: "Council",
      seats: 21,
      description:
        "The Elnöki Tanács - a 21-member collective head of state that exercised standing legislative authority between Assembly sessions; members chosen by the National Assembly.",
      elected: false,
    },
    lowerChamber: {
      key: "nationalAssembly",
      name: "National Assembly",
      shortName: "Assembly",
      seats: 352,
      description:
        "352 deputies of the Országgyűlés, elected to five-year terms in the Hungarian People's Republic - in practice a single-list body controlled by the ruling socialist workers' party.",
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
      key: "chairmanOfPresidentialCouncil",
      label: "Chairman of the Presidential Council",
      labelPlural: "Chairmen of the Presidential Council",
      isExecutive: true,
      isHeadOfState: true,
      isSubNational: false,
      actionBonus: 0,
      partyStrengthWeight: 0,
    },
    {
      key: "assemblyDelegate",
      label: "Deputy",
      labelPlural: "Deputies",
      chamberKey: "nationalAssembly",
      isExecutive: false,
      isSubNational: false,
      termYears: 5,
      actionBonus: 1,
      partyStrengthWeight: 0.9,
    },
    {
      key: "centralBankChair",
      label: "Governor of the MNB",
      labelPlural: "Governors of the MNB",
      isExecutive: false,
      isSubNational: false,
      termYears: 6,
      actionBonus: 3,
      partyStrengthWeight: 0,
    },
  ],
  majorPartyIds: ["mszmp"],
  partyCreationNPPs: {
    statesRequired: 1,
    lockHomeState: true,
    nppsPerState: 2,
  },
  demographicProfileId: "hu_archetypes",
  centralBank: {
    name: "Hungarian National Bank",
    abbreviation: "MNB",
    chairTitle: "Governor of the MNB",
    defaultPrimeRate: 5,
    heroImage: "https://flagcdn.com/w640/hu.png",
  },
  exchangeName: "OT",
  exchangeKind: "stateRegister",
  usdExchangeRate: 0.031,
  currencyCode: "HUF",
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
    "A one-party People's Republic in the Soviet bloc - \"goulash communism\" under a ruling socialist workers' party.",
  descriptor:
    "A one-party socialist state where the ruling party's General Secretary governs through a single-chamber National Assembly; the economy is centrally planned until reform.",
  heroImage: "https://flagcdn.com/w640/hu.png",
  entryPath: "/country/hu",
  overviewPath: "/country/hu",
  mapPath: "/country/hu/map",
  executivePath: "/country/hu/executive",
  executiveLabel: "Parliament",
  centralGovernmentLabel: "Central Plan",
};

/* No HU_LEGISLATIVE_PROCESS: the registry has no HU row, and readers
   fall through to DEFAULT_PROCESS. The registry holds six keys; a country absent
   from it has never had its own process, and writing the default here would say
   it did. */

export const HU_ORDERS_OF_BATTLE: OrderOfBattleEntry[] = [
  {
    branchId: "ground",
    type: "Infantry Division",
    count: 3,
  },
  {
    branchId: "ground",
    type: "Mechanized Brigade",
    count: 2,
  },
  {
    branchId: "ground",
    type: "Artillery Regiment",
    count: 1,
  },
  {
    branchId: "airforce",
    type: "Fighter Wing",
    count: 2,
  },
];

export const HU_MILITARY_BRANCHES: Branch[] = [
  {
    id: "ground",
    name: "Ground Forces",
    abbr: "MH",
    domain: "ground",
  },
  {
    id: "airforce",
    name: "Air Force",
    abbr: "MHL",
    domain: "air",
  },
];

/* No HU_ESTATE_PORTFOLIO: no row; seedCabinetEstates skips the country. */

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
export const HU_CABINET_SEAT_IDS = {
  energy: undefined,
  infrastructure: undefined,
  defense: "minister_of_defence",
  foreignAffairs: "minister_of_foreign_affairs",
  tradeMinister: null,
} as const;

/** Military scale multiplier. */
export const HU_MILITARY_SCALE = 0.9;

/** Which office assents to regional bills. */
/* No HU_REGIONAL_BILL_ASSENT_OFFICE_KEY: the registry has no HU entry.
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
/* No HU_CABINET_GROUPS: the registry has no HU row, and its only
   reader already falls back to "Centre" per position. */
