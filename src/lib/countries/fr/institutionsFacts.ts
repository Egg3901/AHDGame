import type { Branch } from "@/lib/constants/military";

import type { CountryConfig } from "@/lib/constants/countries";

import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";

/**
 * FR's institutions, as pure data.
 *
 * ⚠ GENERATED FROM `__snapshots__/fr.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-institutions.ts FR --force
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair:
 * registries that want one seat id or the legislative process import from HERE,
 * while `institutions.ts` composes these with the cabinet and is heavy. A
 * registry that reads a single string through the heavy module ships the whole
 * cabinet to the browser, which is a regression this work has already shipped
 * once. `clientSafeLeafModules.test.ts` enforces it.
 */

export const FR_CONFIG: CountryConfig = {
  id: "FR",
  name: "France",
  flagEmoji: "🇫🇷",
  code: "FR",
  socialAxisBaseline: 0,
  regionLabel: "Region",
  regionLabelPlural: "Regions",
  executiveTitle: "President",
  executiveRealmPhrase: "France",
  governmentType: "presidential",
  governmentTypeLabel: "Semi-Presidential Republic",
  coalitionThreshold: 246,
  legislature: {
    name: "Parliament",
    path: "/country/fr/legislature",
    bicameral: true,
    upperChamber: {
      key: "senat",
      name: "Senate",
      shortName: "Sénat",
      seats: 305,
      description:
        "305 senators elected indirectly by an electoral college of local officials for nine-year terms.",
      elected: true,
    },
    lowerChamber: {
      key: "assembleeNationale",
      name: "National Assembly",
      shortName: "Assemblée",
      seats: 491,
      description:
        "491 deputies elected from single-member constituencies by two-round majority vote for five-year terms.",
      elected: true,
    },
  },
  lowerElectionSystem: {
    termYears: 5,
    seatsContested: "all",
    singleMemberConstituencies: true,
    snapElectionsAllowed: true,
  },
  upperElectionSystem: {
    termYears: 9,
    seatsContested: "all",
    singleMemberConstituencies: false,
    snapElectionsAllowed: false,
  },
  electionSystems: {
    lowerChamber: "pr_hareQuota",
    upperChamber: "pr_hareQuota",
    headOfState: "fptp",
  },
  officeTypes: [
    {
      key: "president",
      label: "President",
      labelPlural: "Presidents",
      isExecutive: true,
      isHeadOfState: true,
      isSubNational: false,
      termYears: 7,
      actionBonus: 4,
      partyStrengthWeight: 1,
    },
    {
      key: "primeMinister",
      label: "Prime Minister",
      labelPlural: "Prime Ministers",
      isExecutive: true,
      isSubNational: false,
      termYears: 5,
      actionBonus: 3,
      partyStrengthWeight: 1,
    },
    {
      key: "deputy",
      label: "Deputy",
      labelPlural: "Deputies",
      chamberKey: "assembleeNationale",
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
      chamberKey: "senat",
      isExecutive: false,
      isSubNational: false,
      termYears: 9,
      actionBonus: 1,
      partyStrengthWeight: 0.8,
    },
    {
      key: "centralBankChair",
      label: "Governor of the Banque de France",
      labelPlural: "Governors of the Banque de France",
      isExecutive: false,
      isSubNational: false,
      termYears: 6,
      actionBonus: 3,
      partyStrengthWeight: 0,
    },
  ],
  majorPartyIds: ["fr_rpr", "fr_ps"],
  partyCreationNPPs: {
    statesRequired: 2,
    lockHomeState: false,
    nppsPerState: 1,
  },
  demographicProfileId: "fr_archetypes",
  centralBank: {
    name: "Banque de France",
    abbreviation: "BdF",
    chairTitle: "Governor of the Banque de France",
    defaultPrimeRate: 9.5,
    heroImage: "https://flagcdn.com/w640/fr.png",
  },
  usdExchangeRate: 0.238,
  currencyCode: "FRF",
  fiscalYearStartTurnInYear: 40,
  financeMinisterCabinetId: "minister_of_finance",
  status: "coming-soon",
  tagline:
    "The Fifth Republic - a semi-presidential power where a directly-elected President governs with a Prime Minister and a bicameral Parliament.",
  descriptor:
    "A semi-presidential republic: a directly-elected President leads alongside a Prime Minister answerable to the 491-seat National Assembly, with an indirectly-elected Senate.",
  heroImage: "https://flagcdn.com/w640/fr.png",
  entryPath: "/country/fr",
  overviewPath: "/country/fr",
  mapPath: "/country/fr/map",
  executivePath: "/country/fr/executive",
  executiveLabel: "Élysée",
  centralGovernmentLabel: "State Budget",
};

/* No FR_LEGISLATIVE_PROCESS: the registry has no FR row, and readers
   fall through to DEFAULT_PROCESS. The registry holds six keys; a country absent
   from it has never had its own process, and writing the default here would say
   it did. */

export const FR_ORDERS_OF_BATTLE: OrderOfBattleEntry[] = [
  {
    branchId: "terre",
    type: "Infantry Division",
    count: 5,
  },
  {
    branchId: "terre",
    type: "Armored Division",
    count: 3,
  },
  {
    branchId: "terre",
    type: "Artillery Regiment",
    count: 2,
  },
  {
    branchId: "marine",
    type: "Carrier Strike Group",
    count: 1,
  },
  {
    branchId: "marine",
    type: "Frigate Squadron",
    count: 3,
  },
  {
    branchId: "marine",
    type: "Attack Submarine",
    count: 2,
  },
  {
    branchId: "air",
    type: "Fighter Wing",
    count: 4,
  },
  {
    branchId: "air",
    type: "Bomber Squadron",
    count: 2,
  },
];

export const FR_MILITARY_BRANCHES: Branch[] = [
  {
    id: "terre",
    name: "Army",
    abbr: "AdT",
    domain: "ground",
  },
  {
    id: "marine",
    name: "Navy",
    abbr: "MN",
    domain: "naval",
  },
  {
    id: "air",
    name: "Air Force",
    abbr: "AdA",
    domain: "air",
  },
];

/* No FR_ESTATE_PORTFOLIO: no row; seedCabinetEstates skips the country. */

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
export const FR_CABINET_SEAT_IDS = {
  energy: undefined,
  infrastructure: undefined,
  defense: "minister_of_defence",
  foreignAffairs: "minister_of_foreign_affairs",
  tradeMinister: "minister_of_trade_industry",
} as const;

/** Military scale multiplier. */
export const FR_MILITARY_SCALE = 1.5;

/** Which office assents to regional bills. */
/* No FR_REGIONAL_BILL_ASSENT_OFFICE_KEY: the registry has no FR entry.
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
/* No FR_CABINET_GROUPS: the registry has no FR row, and its only
   reader already falls back to "Centre" per position. */
