import type { Branch } from "@/lib/constants/military";

import type { CountryConfig } from "@/lib/constants/countries";

import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";

/**
 * TR's institutions, as pure data.
 *
 * ⚠ GENERATED FROM `__snapshots__/tr.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-institutions.ts TR --force
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair:
 * registries that want one seat id or the legislative process import from HERE,
 * while `institutions.ts` composes these with the cabinet and is heavy. A
 * registry that reads a single string through the heavy module ships the whole
 * cabinet to the browser, which is a regression this work has already shipped
 * once. `clientSafeLeafModules.test.ts` enforces it.
 */

export const TR_CONFIG: CountryConfig = {
  id: "TR",
  name: "Turkey",
  flagEmoji: "🇹🇷",
  code: "TR",
  socialAxisBaseline: 1,
  regionLabel: "Region",
  regionLabelPlural: "Regions",
  executiveTitle: "Prime Minister",
  headOfStateTitle: "President",
  executiveRealmPhrase: "Turkey",
  governmentType: "parliamentaryRepublic",
  governmentTypeLabel: "Parliamentary Republic",
  coalitionThreshold: 226,
  legislature: {
    name: "Grand National Assembly",
    path: "/country/tr/legislature",
    bicameral: true,
    upperChamber: {
      key: "senato",
      name: "Senate of the Republic",
      shortName: "Senato",
      seats: 184,
      description:
        "184 senators (the Cumhuriyet Senatosu, abolished after the 1980 coup), partly elected and partly appointed.",
      elected: true,
    },
    lowerChamber: {
      key: "milletMeclisi",
      name: "National Assembly",
      shortName: "Meclis",
      seats: 450,
      description:
        "450 deputies elected by proportional representation (D'Hondt) for four-year terms.",
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
    termYears: 6,
    seatsContested: "all",
    singleMemberConstituencies: false,
    snapElectionsAllowed: false,
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
      key: "president",
      label: "President",
      labelPlural: "Presidents",
      isExecutive: true,
      isHeadOfState: true,
      isSubNational: false,
      termYears: 7,
      actionBonus: 0,
      partyStrengthWeight: 0,
    },
    {
      key: "deputy",
      label: "Deputy",
      labelPlural: "Deputies",
      chamberKey: "milletMeclisi",
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
      chamberKey: "senato",
      isExecutive: false,
      isSubNational: false,
      termYears: 6,
      actionBonus: 1,
      partyStrengthWeight: 0.8,
    },
    {
      key: "centralBankChair",
      label: "Governor of the Central Bank of Turkey",
      labelPlural: "Governors of the Central Bank of Turkey",
      isExecutive: false,
      isSubNational: false,
      termYears: 5,
      actionBonus: 3,
      partyStrengthWeight: 0,
    },
  ],
  majorPartyIds: ["tr_ap", "tr_chp"],
  partyCreationNPPs: {
    statesRequired: 2,
    lockHomeState: false,
    nppsPerState: 1,
  },
  demographicProfileId: "tr_archetypes",
  centralBank: {
    name: "Central Bank of the Republic of Turkey",
    abbreviation: "TCMB",
    chairTitle: "Governor of the Central Bank of Turkey",
    defaultPrimeRate: 20,
    heroImage: "https://flagcdn.com/w640/tr.png",
  },
  usdExchangeRate: 0.029,
  currencyCode: "TRL",
  fiscalYearStartTurnInYear: 40,
  financeMinisterCabinetId: "minister_of_finance",
  status: "coming-soon",
  tagline:
    "A republic on the brink - fragile coalitions, economic crisis and political violence in the year before the 1980 coup, balanced between secular Kemalism and rising religious and nationalist movements.",
  descriptor:
    "A parliamentary republic where a Prime Minister governs at the confidence of a 450-seat National Assembly and a 184-seat Senate, amid the unstable AP/CHP coalitions of the late 1970s.",
  heroImage: "https://flagcdn.com/w640/tr.png",
  entryPath: "/country/tr",
  overviewPath: "/country/tr",
  mapPath: "/country/tr/map",
  executivePath: "/country/tr/executive",
  executiveLabel: "Çankaya",
  centralGovernmentLabel: "State Budget",
};

/* No TR_LEGISLATIVE_PROCESS: the registry has no TR row, and readers
   fall through to DEFAULT_PROCESS. The registry holds six keys; a country absent
   from it has never had its own process, and writing the default here would say
   it did. */

export const TR_ORDERS_OF_BATTLE: OrderOfBattleEntry[] = [
  {
    branchId: "ground",
    type: "Infantry Division",
    count: 6,
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
    branchId: "navy",
    type: "Frigate Squadron",
    count: 2,
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
];

export const TR_MILITARY_BRANCHES: Branch[] = [
  {
    id: "ground",
    name: "Land Forces",
    abbr: "KKK",
    domain: "ground",
  },
  {
    id: "navy",
    name: "Naval Forces",
    abbr: "DzKK",
    domain: "naval",
  },
  {
    id: "airforce",
    name: "Air Force",
    abbr: "HvKK",
    domain: "air",
  },
];

/* No TR_ESTATE_PORTFOLIO: no row; seedCabinetEstates skips the country. */

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
export const TR_CABINET_SEAT_IDS = {
  energy: undefined,
  infrastructure: undefined,
  defense: "minister_of_defence",
  foreignAffairs: "minister_of_foreign_affairs",
  tradeMinister: "minister_of_trade_industry",
} as const;

/** Military scale multiplier. */
export const TR_MILITARY_SCALE = 1;

/** Which office assents to regional bills. */
/* No TR_REGIONAL_BILL_ASSENT_OFFICE_KEY: the registry has no TR entry.
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
/* No TR_CABINET_GROUPS: the registry has no TR row, and its only
   reader already falls back to "Centre" per position. */
