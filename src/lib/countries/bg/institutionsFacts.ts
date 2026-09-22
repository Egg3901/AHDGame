import type { Branch } from "@/lib/constants/military";

import type { CountryConfig } from "@/lib/constants/countries";

import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";

/**
 * BG's institutions, as pure data.
 *
 * ⚠ GENERATED FROM `__snapshots__/bg.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-institutions.ts BG --force
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair:
 * registries that want one seat id or the legislative process import from HERE,
 * while `institutions.ts` composes these with the cabinet and is heavy. A
 * registry that reads a single string through the heavy module ships the whole
 * cabinet to the browser, which is a regression this work has already shipped
 * once. `clientSafeLeafModules.test.ts` enforces it.
 */

export const BG_CONFIG: CountryConfig = {
  id: "BG",
  name: "Bulgaria",
  flagEmoji: "🇧🇬",
  code: "BG",
  socialAxisBaseline: 2.5,
  regionLabel: "Region",
  regionLabelPlural: "Regions",
  executiveTitle: "General Secretary",
  headOfStateTitle: "Chairman of the State Council",
  executiveRealmPhrase: "Bulgaria",
  governmentType: "onePartyState",
  rulingPartyId: 1,
  governmentTypeLabel: "One Party State",
  coalitionThreshold: 201,
  legislature: {
    name: "National Assembly",
    path: "/country/bg/legislature",
    bicameral: false,
    upperChamber: {
      key: "stateCouncil",
      name: "State Council",
      shortName: "Council",
      seats: 21,
      description:
        "A collective head of state exercising standing authority between Assembly sessions.",
      elected: false,
    },
    lowerChamber: {
      key: "nationalAssembly",
      name: "National Assembly",
      shortName: "Assembly",
      seats: 400,
      description:
        "400 deputies of the Narodno Sabranie, elected to five-year terms - a single-list body controlled by the ruling communist party within the Fatherland Front.",
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
      key: "chairmanOfStateCouncil",
      label: "Chairman of the State Council",
      labelPlural: "Chairmen of the State Council",
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
      chamberKey: "nationalAssembly",
      isExecutive: false,
      isSubNational: false,
      termYears: 5,
      actionBonus: 1,
      partyStrengthWeight: 0.9,
    },
    {
      key: "centralBankChair",
      label: "Governor of the BNB",
      labelPlural: "Governors of the BNB",
      isExecutive: false,
      isSubNational: false,
      termYears: 6,
      actionBonus: 3,
      partyStrengthWeight: 0,
    },
  ],
  majorPartyIds: ["bkp"],
  partyCreationNPPs: {
    statesRequired: 1,
    lockHomeState: true,
    nppsPerState: 2,
  },
  demographicProfileId: "bg_archetypes",
  centralBank: {
    name: "Bulgarian National Bank",
    abbreviation: "BNB",
    chairTitle: "Governor of the BNB",
    defaultPrimeRate: 5,
    heroImage: "https://flagcdn.com/w640/bg.png",
  },
  exchangeName: "DKP",
  exchangeKind: "stateRegister",
  usdExchangeRate: 1,
  currencyCode: "BGL",
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
  tagline: "The Soviet bloc's most loyal member - a one-party People's Republic.",
  descriptor:
    "A one-party socialist state where the ruling communist party's General Secretary governs through the National Assembly; the economy is centrally planned until reform.",
  heroImage: "https://flagcdn.com/w640/bg.png",
  entryPath: "/country/bg",
  overviewPath: "/country/bg",
  mapPath: "/country/bg/map",
  executivePath: "/country/bg/executive",
  executiveLabel: "Assembly",
  centralGovernmentLabel: "Central Plan",
};

/* No BG_LEGISLATIVE_PROCESS: the registry has no BG row, and readers
   fall through to DEFAULT_PROCESS. The registry holds six keys; a country absent
   from it has never had its own process, and writing the default here would say
   it did. */

export const BG_ORDERS_OF_BATTLE: OrderOfBattleEntry[] = [
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

export const BG_MILITARY_BRANCHES: Branch[] = [
  {
    id: "ground",
    name: "Land Forces",
    abbr: "SV",
    domain: "ground",
  },
  {
    id: "navy",
    name: "Navy",
    abbr: "VMS",
    domain: "naval",
  },
  {
    id: "airforce",
    name: "Air Force",
    abbr: "VVS",
    domain: "air",
  },
];

/* No BG_ESTATE_PORTFOLIO: no row; seedCabinetEstates skips the country. */

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
export const BG_CABINET_SEAT_IDS = {
  energy: undefined,
  infrastructure: undefined,
  defense: "minister_of_defence",
  foreignAffairs: "minister_of_foreign_affairs",
  tradeMinister: null,
} as const;

/** Military scale multiplier. */
export const BG_MILITARY_SCALE = 0.85;

/** Which office assents to regional bills. */
/* No BG_REGIONAL_BILL_ASSENT_OFFICE_KEY: the registry has no BG entry.
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
/* No BG_CABINET_GROUPS: the registry has no BG row, and its only
   reader already falls back to "Centre" per position. */
