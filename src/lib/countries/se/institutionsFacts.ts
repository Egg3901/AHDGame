import type { Branch } from "@/lib/constants/military";

import type { CountryConfig } from "@/lib/constants/countries";

import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";

/**
 * SE's institutions, as pure data.
 *
 * ⚠ GENERATED FROM `__snapshots__/se.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-institutions.ts SE --force
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair:
 * registries that want one seat id or the legislative process import from HERE,
 * while `institutions.ts` composes these with the cabinet and is heavy. A
 * registry that reads a single string through the heavy module ships the whole
 * cabinet to the browser, which is a regression this work has already shipped
 * once. `clientSafeLeafModules.test.ts` enforces it.
 */

export const SE_CONFIG: CountryConfig = {
  id: "SE",
  name: "Sweden",
  flagEmoji: "🇸🇪",
  code: "SE",
  socialAxisBaseline: -1,
  regionLabel: "County",
  regionLabelPlural: "Counties",
  executiveTitle: "Prime Minister",
  headOfStateTitle: "King",
  executiveRealmPhrase: "Sweden",
  governmentType: "parliamentaryMonarchy",
  governmentTypeLabel: "Constitutional Monarchy",
  coalitionThreshold: 175,
  legislature: {
    name: "Riksdag",
    path: "/country/se/legislature",
    bicameral: false,
    upperChamber: {
      key: "forstaKammaren",
      name: "First Chamber (abolished 1970)",
      shortName: "First Chamber",
      seats: 151,
      description:
        "The former indirectly-elected upper house, abolished in the 1970 unicameral reform. Not part of the legislative loop.",
    },
    lowerChamber: {
      key: "riksdag",
      name: "Riksdag",
      shortName: "Riksdag",
      seats: 349,
      description:
        "349 members elected by proportional representation (with a 4% threshold) for fixed terms.",
      elected: true,
    },
  },
  lowerElectionSystem: {
    termYears: 3,
    seatsContested: "all",
    singleMemberConstituencies: false,
    snapElectionsAllowed: false,
  },
  electionSystems: {
    lowerChamber: "pr_hareQuota",
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
      termYears: 3,
      actionBonus: 4,
      partyStrengthWeight: 1,
    },
    {
      key: "monarch",
      label: "King",
      labelPlural: "Kings",
      isExecutive: true,
      isHeadOfState: true,
      isSubNational: false,
      termYears: 0,
      actionBonus: 0,
      partyStrengthWeight: 0,
    },
    {
      key: "member",
      label: "Member of the Riksdag",
      labelPlural: "Members of the Riksdag",
      chamberKey: "riksdag",
      isExecutive: false,
      isSubNational: false,
      termYears: 3,
      actionBonus: 1,
      partyStrengthWeight: 0.9,
    },
    {
      key: "centralBankChair",
      label: "Governor of the Riksbank",
      labelPlural: "Governors of the Riksbank",
      isExecutive: false,
      isSubNational: false,
      termYears: 6,
      actionBonus: 3,
      partyStrengthWeight: 0,
    },
  ],
  majorPartyIds: ["se_sap", "se_m"],
  partyCreationNPPs: {
    statesRequired: 2,
    lockHomeState: false,
    nppsPerState: 1,
  },
  demographicProfileId: "se_archetypes",
  centralBank: {
    name: "Sveriges Riksbank",
    abbreviation: "Riksbank",
    chairTitle: "Governor of the Riksbank",
    defaultPrimeRate: 9,
    heroImage: "https://flagcdn.com/w640/se.png",
  },
  usdExchangeRate: 0.233,
  currencyCode: "SEK",
  fiscalYearStartTurnInYear: 40,
  financeMinisterCabinetId: "minister_of_finance",
  status: "coming-soon",
  tagline:
    "The Swedish model - a generous welfare state and powerful unions, where a non-socialist coalition now governs with the long-dominant Social Democrats in opposition.",
  descriptor:
    "A constitutional monarchy with a unicameral 349-seat Riksdag elected by proportional representation, home to the world's most developed social-democratic welfare state.",
  heroImage: "https://flagcdn.com/w640/se.png",
  entryPath: "/country/se",
  overviewPath: "/country/se",
  mapPath: "/country/se/map",
  executivePath: "/country/se/executive",
  executiveLabel: "Rosenbad",
  centralGovernmentLabel: "State Budget",
};

/* No SE_LEGISLATIVE_PROCESS: the registry has no SE row, and readers
   fall through to DEFAULT_PROCESS. The registry holds six keys; a country absent
   from it has never had its own process, and writing the default here would say
   it did. */

export const SE_ORDERS_OF_BATTLE: OrderOfBattleEntry[] = [
  {
    branchId: "army",
    type: "Infantry Division",
    count: 3,
  },
  {
    branchId: "army",
    type: "Armored Division",
    count: 1,
  },
  {
    branchId: "army",
    type: "Artillery Regiment",
    count: 1,
  },
  {
    branchId: "navy",
    type: "Frigate Squadron",
    count: 2,
  },
  {
    branchId: "navy",
    type: "Attack Submarine",
    count: 2,
  },
  {
    branchId: "airforce",
    type: "Fighter Wing",
    count: 4,
  },
  {
    branchId: "airforce",
    type: "Air Defense Wing",
    count: 1,
  },
];

export const SE_MILITARY_BRANCHES: Branch[] = [
  {
    id: "army",
    name: "Army",
    abbr: "Armén",
    domain: "ground",
  },
  {
    id: "navy",
    name: "Navy",
    abbr: "Marinen",
    domain: "naval",
  },
  {
    id: "airforce",
    name: "Air Force",
    abbr: "Flygvapnet",
    domain: "air",
  },
];

/* No SE_ESTATE_PORTFOLIO: no row; seedCabinetEstates skips the country. */

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
export const SE_CABINET_SEAT_IDS = {
  energy: undefined,
  infrastructure: undefined,
  defense: "minister_of_defence",
  foreignAffairs: "minister_of_foreign_affairs",
  tradeMinister: "minister_of_trade_industry",
} as const;

/** Military scale multiplier. */
export const SE_MILITARY_SCALE = 1.1;

/** Which office assents to regional bills. */
/* No SE_REGIONAL_BILL_ASSENT_OFFICE_KEY: the registry has no SE entry.
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
/* No SE_CABINET_GROUPS: the registry has no SE row, and its only
   reader already falls back to "Centre" per position. */
