import type { Branch } from "@/lib/constants/military";

import type { CountryConfig } from "@/lib/constants/countries";

import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";

/**
 * YU's institutions, as pure data.
 *
 * ⚠ GENERATED FROM `__snapshots__/yu.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-institutions.ts YU --force
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair:
 * registries that want one seat id or the legislative process import from HERE,
 * while `institutions.ts` composes these with the cabinet and is heavy. A
 * registry that reads a single string through the heavy module ships the whole
 * cabinet to the browser, which is a regression this work has already shipped
 * once. `clientSafeLeafModules.test.ts` enforces it.
 */

export const YU_CONFIG: CountryConfig = {
  id: "YU",
  name: "Yugoslavia",
  flagEmoji: "🇾🇺",
  code: "YU",
  socialAxisBaseline: 2,
  regionLabel: "Republic",
  regionLabelPlural: "Republics",
  executiveTitle: "President",
  headOfStateTitle: "President of the Republic",
  executiveRealmPhrase: "Yugoslavia",
  governmentType: "onePartyState",
  rulingPartyId: 1,
  governmentTypeLabel: "One Party State",
  coalitionThreshold: 155,
  legislature: {
    name: "Federal Assembly",
    path: "/country/yu/legislature",
    bicameral: false,
    upperChamber: {
      key: "presidency",
      name: "Presidency",
      shortName: "Presidency",
      seats: 9,
      description:
        "The collective State Presidency - a rotating federal head of state representing the republics and provinces.",
      elected: false,
    },
    lowerChamber: {
      key: "federalAssembly",
      name: "Federal Assembly",
      shortName: "Assembly",
      seats: 308,
      description:
        "308 delegates of the Skupština, drawn from the republics and provinces under the self-management system led by the League of Communists.",
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
      key: "president",
      label: "President",
      labelPlural: "Presidents",
      isExecutive: true,
      isHeadOfState: true,
      isSubNational: false,
      termYears: 5,
      actionBonus: 4,
      partyStrengthWeight: 1,
    },
    {
      key: "assemblyDelegate",
      label: "Delegate",
      labelPlural: "Delegates",
      chamberKey: "federalAssembly",
      isExecutive: false,
      isSubNational: false,
      termYears: 4,
      actionBonus: 1,
      partyStrengthWeight: 0.9,
    },
    {
      key: "centralBankChair",
      label: "Governor of the NBY",
      labelPlural: "Governors of the NBY",
      isExecutive: false,
      isSubNational: false,
      termYears: 6,
      actionBonus: 3,
      partyStrengthWeight: 0,
    },
  ],
  majorPartyIds: ["skj"],
  partyCreationNPPs: {
    statesRequired: 1,
    lockHomeState: true,
    nppsPerState: 2,
  },
  demographicProfileId: "yu_archetypes",
  centralBank: {
    name: "National Bank of Yugoslavia",
    abbreviation: "NBY",
    chairTitle: "Governor of the NBY",
    defaultPrimeRate: 8,
    heroImage:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/Flag_of_Yugoslavia_%281946-1992%29.svg/500px-Flag_of_Yugoslavia_%281946-1992%29.svg.png",
  },
  exchangeName: "SZP",
  exchangeKind: "stateRegister",
  usdExchangeRate: 0.055,
  currencyCode: "YUD",
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
    "Non-aligned socialist federation of six republics - Titoist self-management, a Cold-War battleground.",
  descriptor:
    "A non-aligned one-party federation governed by a collective presidency and the League of Communists under worker self-management; a market-socialist economy distinct from the Soviet bloc.",
  heroImage:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/Flag_of_Yugoslavia_%281946-1992%29.svg/500px-Flag_of_Yugoslavia_%281946-1992%29.svg.png",
  entryPath: "/country/yu",
  overviewPath: "/country/yu",
  mapPath: "/country/yu/map",
  executivePath: "/country/yu/executive",
  executiveLabel: "Assembly",
  centralGovernmentLabel: "Federal Plan",
};

/* No YU_LEGISLATIVE_PROCESS: the registry has no YU row, and readers
   fall through to DEFAULT_PROCESS. The registry holds six keys; a country absent
   from it has never had its own process, and writing the default here would say
   it did. */

export const YU_ORDERS_OF_BATTLE: OrderOfBattleEntry[] = [
  {
    branchId: "ground",
    type: "Infantry Division",
    count: 5,
  },
  {
    branchId: "ground",
    type: "Armored Division",
    count: 1,
  },
  {
    branchId: "ground",
    type: "Artillery Regiment",
    count: 2,
  },
  {
    branchId: "ground",
    type: "Special Forces Group",
    count: 1,
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
    count: 2,
  },
];

export const YU_MILITARY_BRANCHES: Branch[] = [
  {
    id: "ground",
    name: "Ground Forces",
    abbr: "KoV",
    domain: "ground",
    dissolvedYear: 1992,
  },
  {
    id: "navy",
    name: "Navy",
    abbr: "JRM",
    domain: "naval",
    dissolvedYear: 1992,
  },
  {
    id: "airforce",
    name: "Air Force",
    abbr: "JRV",
    domain: "air",
    dissolvedYear: 1992,
  },
];

/* No YU_ESTATE_PORTFOLIO: no row; seedCabinetEstates skips the country. */

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
export const YU_CABINET_SEAT_IDS = {
  energy: undefined,
  infrastructure: undefined,
  defense: "minister_of_defence",
  foreignAffairs: "minister_of_foreign_affairs",
  tradeMinister: null,
} as const;

/** Military scale multiplier. */
export const YU_MILITARY_SCALE = 0.95;

/** Which office assents to regional bills. */
/* No YU_REGIONAL_BILL_ASSENT_OFFICE_KEY: the registry has no YU entry.
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
/* No YU_CABINET_GROUPS: the registry has no YU row, and its only
   reader already falls back to "Centre" per position. */
