import type { Branch } from "@/lib/constants/military";

import type { CountryConfig } from "@/lib/constants/countries";

import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";

/**
 * UKR's institutions, as pure data.
 *
 * ⚠ GENERATED FROM `__snapshots__/ukr.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-institutions.ts UKR --force
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair:
 * registries that want one seat id or the legislative process import from HERE,
 * while `institutions.ts` composes these with the cabinet and is heavy. A
 * registry that reads a single string through the heavy module ships the whole
 * cabinet to the browser, which is a regression this work has already shipped
 * once. `clientSafeLeafModules.test.ts` enforces it.
 */

export const UKR_CONFIG: CountryConfig = {
  id: "UKR",
  name: "Ukraine",
  flagEmoji: "🇺🇦",
  code: "UKR",
  socialAxisBaseline: 2.5,
  regionLabel: "Region",
  regionLabelPlural: "Regions",
  executiveTitle: "First Secretary",
  headOfStateTitle: "Chairman of the Presidium",
  executiveRealmPhrase: "Ukraine",
  governmentType: "onePartyState",
  rulingPartyId: 1,
  governmentTypeLabel: "One Party State",
  coalitionThreshold: 218,
  legislature: {
    name: "Supreme Soviet",
    path: "/country/ua/legislature",
    bicameral: false,
    upperChamber: {
      key: "presidium",
      name: "Presidium",
      shortName: "Presidium",
      seats: 21,
      description:
        "The Presidium of the Supreme Soviet - a standing organ acting between sessions.",
      elected: false,
    },
    lowerChamber: {
      key: "supremeSoviet",
      name: "Supreme Soviet",
      shortName: "Soviet",
      seats: 435,
      description:
        "Deputies of the Ukrainian SSR Supreme Soviet, elected to single-list terms under the Communist Party.",
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
      key: "sovietDeputy",
      label: "Deputy",
      labelPlural: "Deputies",
      chamberKey: "supremeSoviet",
      isExecutive: false,
      isSubNational: false,
      termYears: 5,
      actionBonus: 1,
      partyStrengthWeight: 0.9,
    },
    {
      key: "centralBankChair",
      label: "Gosbank Chair",
      labelPlural: "Gosbank Chairs",
      isExecutive: false,
      isSubNational: false,
      termYears: 6,
      actionBonus: 3,
      partyStrengthWeight: 0,
    },
  ],
  majorPartyIds: ["kpu"],
  partyCreationNPPs: {
    statesRequired: 1,
    lockHomeState: true,
    nppsPerState: 2,
  },
  demographicProfileId: "ua_archetypes",
  centralBank: {
    name: "State Bank (Gosbank)",
    abbreviation: "Gosbank",
    chairTitle: "Gosbank Chair",
    defaultPrimeRate: 3,
    heroImage: "https://flagcdn.com/w640/ukr.png",
  },
  exchangeName: "GOSPLAN URSR",
  exchangeKind: "stateRegister",
  usdExchangeRate: 1.35,
  currencyCode: "SUR",
  fiscalYearStartTurnInYear: 40,
  financeMinisterCabinetId: "minister_of_finance",
  status: "coming-soon",
  tagline:
    "The second republic of the Union - coal, steel and grain under the Communist Party of Ukraine.",
  descriptor:
    "A one-party Soviet republic governed by the Communist Party of Ukraine through its Supreme Soviet; the Union's second economy, built on Donbas coal, Dnieper metallurgy and the grain of the steppe.",
  heroImage: "https://flagcdn.com/w640/ukr.png",
  entryPath: "/country/ua",
  overviewPath: "/country/ua",
  mapPath: "/country/ua/map",
  executivePath: "/country/ua/executive",
  executiveLabel: "Soviet",
  centralGovernmentLabel: "Central Plan",
};

/* No UKR_LEGISLATIVE_PROCESS: the registry has no UKR row, and readers
   fall through to DEFAULT_PROCESS. The registry holds six keys; a country absent
   from it has never had its own process, and writing the default here would say
   it did. */

export const UKR_ORDERS_OF_BATTLE: OrderOfBattleEntry[] = [
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

export const UKR_MILITARY_BRANCHES: Branch[] = [
  {
    id: "ground",
    name: "Ground Forces",
    abbr: "SV",
    domain: "ground",
  },
  {
    id: "navy",
    name: "Naval Forces",
    abbr: "VMS",
    domain: "naval",
  },
  {
    id: "airforce",
    name: "Air Force",
    abbr: "VPS",
    domain: "air",
  },
];

/* No UKR_ESTATE_PORTFOLIO: no row; seedCabinetEstates skips the country. */

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
export const UKR_CABINET_SEAT_IDS = {
  energy: undefined,
  infrastructure: undefined,
  defense: "minister_of_defence",
  foreignAffairs: "minister_of_foreign_affairs",
  tradeMinister: null,
} as const;

/** Military scale multiplier. */
export const UKR_MILITARY_SCALE = 1.1;

/** Which office assents to regional bills. */
/* No UKR_REGIONAL_BILL_ASSENT_OFFICE_KEY: the registry has no UKR entry.
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
/* No UKR_CABINET_GROUPS: the registry has no UKR row, and its only
   reader already falls back to "Centre" per position. */
