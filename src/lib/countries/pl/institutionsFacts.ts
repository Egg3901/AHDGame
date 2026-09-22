import type { Branch } from "@/lib/constants/military";

import type { CountryConfig } from "@/lib/constants/countries";

import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";

/**
 * PL's institutions, as pure data.
 *
 * ⚠ GENERATED FROM `__snapshots__/pl.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-institutions.ts PL --force
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair:
 * registries that want one seat id or the legislative process import from HERE,
 * while `institutions.ts` composes these with the cabinet and is heavy. A
 * registry that reads a single string through the heavy module ships the whole
 * cabinet to the browser, which is a regression this work has already shipped
 * once. `clientSafeLeafModules.test.ts` enforces it.
 */

export const PL_CONFIG: CountryConfig = {
  id: "PL",
  name: "Poland",
  flagEmoji: "🇵🇱",
  code: "PL",
  socialAxisBaseline: 2.5,
  regionLabel: "Region",
  regionLabelPlural: "Regions",
  executiveTitle: "First Secretary",
  headOfStateTitle: "Chairman of the Council of State",
  executiveRealmPhrase: "Poland",
  governmentType: "onePartyState",
  rulingPartyId: 1,
  governmentTypeLabel: "One Party State",
  coalitionThreshold: 231,
  legislature: {
    name: "Sejm",
    path: "/country/pl/legislature",
    bicameral: false,
    upperChamber: {
      key: "councilOfState",
      name: "Council of State",
      shortName: "Council",
      seats: 17,
      description:
        "The Rada Państwa - a collective head of state exercising standing authority between Sejm sessions; chosen by the Sejm.",
      elected: false,
    },
    lowerChamber: {
      key: "sejm",
      name: "Sejm",
      shortName: "Sejm",
      seats: 460,
      description:
        "460 deputies of the Sejm, elected to four-year terms - a single-list body led by the ruling workers' party within the National Unity Front.",
      elected: true,
    },
  },
  lowerElectionSystem: {
    termYears: 4,
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
      key: "firstSecretary",
      label: "First Secretary",
      labelPlural: "First Secretaries",
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
      key: "sejmDeputy",
      label: "Deputy",
      labelPlural: "Deputies",
      chamberKey: "sejm",
      isExecutive: false,
      isSubNational: false,
      termYears: 4,
      actionBonus: 1,
      partyStrengthWeight: 0.9,
    },
    {
      key: "centralBankChair",
      label: "President of the NBP",
      labelPlural: "Presidents of the NBP",
      isExecutive: false,
      isSubNational: false,
      termYears: 6,
      actionBonus: 3,
      partyStrengthWeight: 0,
    },
  ],
  majorPartyIds: ["pzpr"],
  partyCreationNPPs: {
    statesRequired: 1,
    lockHomeState: true,
    nppsPerState: 2,
  },
  demographicProfileId: "pl_archetypes",
  centralBank: {
    name: "National Bank of Poland",
    abbreviation: "NBP",
    chairTitle: "President of the NBP",
    defaultPrimeRate: 5,
    heroImage: "https://flagcdn.com/w640/pl.png",
  },
  exchangeName: "PKPG",
  exchangeKind: "stateRegister",
  usdExchangeRate: 0.04,
  currencyCode: "PLZ",
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
    "The largest Warsaw-Pact state - a one-party People's Republic on the cusp of the Solidarity era.",
  descriptor:
    "A one-party socialist state where the ruling workers' party's First Secretary governs through the Sejm; the economy is centrally planned until reform.",
  heroImage: "https://flagcdn.com/w640/pl.png",
  entryPath: "/country/pl",
  overviewPath: "/country/pl",
  mapPath: "/country/pl/map",
  executivePath: "/country/pl/executive",
  executiveLabel: "Council of Ministers",
  centralGovernmentLabel: "Central Plan",
};

/* No PL_LEGISLATIVE_PROCESS: the registry has no PL row, and readers
   fall through to DEFAULT_PROCESS. The registry holds six keys; a country absent
   from it has never had its own process, and writing the default here would say
   it did. */

export const PL_ORDERS_OF_BATTLE: OrderOfBattleEntry[] = [
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
    branchId: "navy",
    type: "Frigate Squadron",
    count: 1,
  },
  {
    branchId: "navy",
    type: "Attack Submarine",
    count: 1,
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

export const PL_MILITARY_BRANCHES: Branch[] = [
  {
    id: "ground",
    name: "Land Forces",
    abbr: "WL",
    domain: "ground",
  },
  {
    id: "navy",
    name: "Navy",
    abbr: "MW",
    domain: "naval",
  },
  {
    id: "airforce",
    name: "Air Force",
    abbr: "SP",
    domain: "air",
  },
];

/* No PL_ESTATE_PORTFOLIO: no row; seedCabinetEstates skips the country. */

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
export const PL_CABINET_SEAT_IDS = {
  energy: undefined,
  infrastructure: undefined,
  defense: "minister_of_defence",
  foreignAffairs: "minister_of_foreign_affairs",
  tradeMinister: null,
} as const;

/** Military scale multiplier. */
export const PL_MILITARY_SCALE = 1;

/** Which office assents to regional bills. */
/* No PL_REGIONAL_BILL_ASSENT_OFFICE_KEY: the registry has no PL entry.
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
/* No PL_CABINET_GROUPS: the registry has no PL row, and its only
   reader already falls back to "Centre" per position. */
