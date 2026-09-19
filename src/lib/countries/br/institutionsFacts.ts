import type { Branch } from "@/lib/constants/military";

import type { CountryConfig } from "@/lib/constants/countries";

import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";

/**
 * BR's institutions, as pure data.
 *
 * ⚠ GENERATED FROM `__snapshots__/br.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-institutions.ts BR --force
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair:
 * registries that want one seat id or the legislative process import from HERE,
 * while `institutions.ts` composes these with the cabinet and is heavy. A
 * registry that reads a single string through the heavy module ships the whole
 * cabinet to the browser, which is a regression this work has already shipped
 * once. `clientSafeLeafModules.test.ts` enforces it.
 */

export const BR_CONFIG: CountryConfig = {
  id: "BR",
  seedEconomicModel: {
    "1991": "agrarian",
    "2019": "resourceExtraction",
  },
  name: "Brazil",
  flagEmoji: "🇧🇷",
  code: "BR",
  socialAxisBaseline: 0,
  regionLabel: "State",
  regionLabelPlural: "States",
  executiveTitle: "President",
  executiveRealmPhrase: "Brazil",
  governmentType: "presidential",
  governmentTypeLabel: "Presidential Republic",
  coalitionThreshold: 257,
  legislature: {
    name: "National Congress",
    path: "/country/br/legislature",
    bicameral: true,
    upperChamber: {
      key: "senate",
      name: "Federal Senate",
      shortName: "Senate",
      seats: 81,
      description:
        "81 senators - three per state - serving eight-year staggered terms. Reviews legislation from the Chamber.",
      elected: true,
    },
    lowerChamber: {
      key: "chamber",
      name: "Chamber of Deputies",
      shortName: "Chamber",
      seats: 513,
      description:
        "513 deputies elected by open-list proportional representation from 27 multi-member constituencies. Four-year terms.",
      elected: true,
    },
  },
  lowerElectionSystem: {
    termYears: 4,
    seatsContested: "all",
    singleMemberConstituencies: false,
    snapElectionsAllowed: false,
  },
  upperElectionSystem: {
    termYears: 8,
    seatsContested: "partial",
    staggeredClasses: 2,
    singleMemberConstituencies: true,
    snapElectionsAllowed: false,
  },
  electionSystems: {
    lowerChamber: "pr_hareQuota",
    upperChamber: "fptp",
    headOfState: "electoralCollege",
  },
  officeTypes: [
    {
      key: "president",
      label: "President",
      labelPlural: "Presidents",
      isExecutive: true,
      isSubNational: false,
      termYears: 4,
      actionBonus: 4,
      partyStrengthWeight: 1,
    },
    {
      key: "vicePresident",
      label: "Vice President",
      labelPlural: "Vice Presidents",
      isExecutive: true,
      isSubNational: false,
      termYears: 4,
      actionBonus: 2,
      partyStrengthWeight: 1,
    },
    {
      key: "senate",
      label: "Senator",
      labelPlural: "Senators",
      chamberKey: "senate",
      isExecutive: false,
      isSubNational: false,
      termYears: 8,
      actionBonus: 2,
      partyStrengthWeight: 0.8,
    },
    {
      key: "chamber",
      label: "Federal Deputy",
      labelPlural: "Federal Deputies",
      chamberKey: "chamber",
      isExecutive: false,
      isSubNational: false,
      termYears: 4,
      actionBonus: 1,
      partyStrengthWeight: 0.9,
    },
    {
      key: "governor",
      label: "Governor",
      labelPlural: "Governors",
      isExecutive: false,
      isSubNational: true,
      termYears: 4,
      actionBonus: 2,
      partyStrengthWeight: 1,
    },
    {
      key: "centralBankChair",
      label: "Governor of the BCB",
      labelPlural: "Governors of the BCB",
      isExecutive: false,
      isSubNational: false,
      termYears: 4,
      actionBonus: 3,
      partyStrengthWeight: 0,
    },
  ],
  majorPartyIds: ["pt", "pl"],
  partyCreationNPPs: {
    statesRequired: 3,
    lockHomeState: true,
    nppsPerState: 2,
  },
  demographicProfileId: "br_archetypes",
  executiveTermLimit: {
    officeKey: "president",
    maxTermsPerCharacter: 2,
    blocksRunningMateSelection: true,
  },
  centralBank: {
    name: "Banco Central do Brasil",
    abbreviation: "BCB",
    chairTitle: "Governor of the BCB",
    defaultPrimeRate: 8,
    heroImage: "/api/images/hero/banco-central-do-brasil",
  },
  exchangeName: "B3",
  usdExchangeRate: 0.2,
  currencyCode: "BRL",
  fiscalYearStartTurnInYear: 40,
  financeMinisterCabinetId: "minister_of_finance",
  status: "coming-soon",
  tagline:
    "South America's largest democracy - a federal presidential republic with fragmented multi-party politics and a dynamic emerging-market economy.",
  descriptor:
    "A federal presidential republic where the directly elected President governs alongside a National Congress of 513 deputies and 81 senators across five macro-regions.",
  heroImage: "https://flagcdn.com/w640/br.png",
  entryPath: "/country/br",
  overviewPath: "/country/br",
  mapPath: "/country/br/map",
  executivePath: "/country/br/executive",
  executiveLabel: "Palácio do Planalto",
  centralGovernmentLabel: "Federal Transfers",
};

/* No BR_LEGISLATIVE_PROCESS: the registry has no BR row, and readers
   fall through to DEFAULT_PROCESS. The registry holds six keys; a country absent
   from it has never had its own process, and writing the default here would say
   it did. */

export const BR_ORDERS_OF_BATTLE: OrderOfBattleEntry[] = [
  {
    branchId: "exercito",
    type: "Infantry Division",
    count: 4,
  },
  {
    branchId: "exercito",
    type: "Armored Division",
    count: 1,
  },
  {
    branchId: "exercito",
    type: "Artillery Regiment",
    count: 1,
  },
  {
    branchId: "marinha",
    type: "Frigate Squadron",
    count: 2,
  },
  {
    branchId: "marinha",
    type: "Attack Submarine",
    count: 1,
  },
  {
    branchId: "aerea",
    type: "Fighter Wing",
    count: 2,
  },
];

export const BR_MILITARY_BRANCHES: Branch[] = [
  {
    id: "exercito",
    name: "Army",
    abbr: "EB",
    domain: "ground",
  },
  {
    id: "marinha",
    name: "Navy",
    abbr: "MB",
    domain: "naval",
  },
  {
    id: "aerea",
    name: "Air Force",
    abbr: "FAB",
    domain: "air",
  },
];

/* No BR_ESTATE_PORTFOLIO: no row; seedCabinetEstates skips the country. */

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
export const BR_CABINET_SEAT_IDS = {
  energy: undefined,
  infrastructure: undefined,
  defense: "minister_of_defence",
  foreignAffairs: "minister_of_foreign_affairs",
  tradeMinister: "minister_of_trade_industry",
} as const;

/** Military scale multiplier. */
export const BR_MILITARY_SCALE = 1;

/** Which office assents to regional bills. */
/* No BR_REGIONAL_BILL_ASSENT_OFFICE_KEY: the registry has no BR entry.
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
/* No BR_CABINET_GROUPS: the registry has no BR row, and its only
   reader already falls back to "Centre" per position. */
