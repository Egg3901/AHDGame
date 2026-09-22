import type { Branch } from "@/lib/constants/military";

import type { CountryConfig } from "@/lib/constants/countries";

import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";

/**
 * FI's institutions, as pure data.
 *
 * ⚠ GENERATED FROM `__snapshots__/fi.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-institutions.ts FI --force
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair:
 * registries that want one seat id or the legislative process import from HERE,
 * while `institutions.ts` composes these with the cabinet and is heavy. A
 * registry that reads a single string through the heavy module ships the whole
 * cabinet to the browser, which is a regression this work has already shipped
 * once. `clientSafeLeafModules.test.ts` enforces it.
 */

export const FI_CONFIG: CountryConfig = {
  id: "FI",
  name: "Finland",
  flagEmoji: "🇫🇮",
  code: "FI",
  socialAxisBaseline: 0,
  regionLabel: "Region",
  regionLabelPlural: "Regions",
  executiveTitle: "Prime Minister",
  headOfStateTitle: "President",
  executiveRealmPhrase: "Finland",
  governmentType: "parliamentaryRepublic",
  governmentTypeLabel: "Parliamentary Republic",
  coalitionThreshold: 101,
  legislature: {
    name: "Eduskunta",
    path: "/country/fi/legislature",
    bicameral: false,
    lowerChamber: {
      key: "eduskunta",
      name: "Eduskunta",
      shortName: "Eduskunta",
      seats: 200,
      description:
        "200 members elected by open-list proportional representation for four-year terms — the unicameral parliament Finland has kept since 1906.",
      elected: true,
    },
  },
  lowerElectionSystem: {
    termYears: 4,
    seatsContested: "all",
    singleMemberConstituencies: false,
    snapElectionsAllowed: true,
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
      termYears: 6,
      actionBonus: 0,
      partyStrengthWeight: 0,
    },
    {
      key: "deputy",
      label: "Member of Parliament",
      labelPlural: "Members of Parliament",
      chamberKey: "eduskunta",
      isExecutive: false,
      isSubNational: false,
      termYears: 4,
      actionBonus: 1,
      partyStrengthWeight: 0.9,
    },
    {
      key: "centralBankChair",
      label: "Governor of the Bank of Finland",
      labelPlural: "Governors of the Bank of Finland",
      isExecutive: false,
      isSubNational: false,
      termYears: 6,
      actionBonus: 3,
      partyStrengthWeight: 0,
    },
  ],
  majorPartyIds: ["fi_sdp", "fi_kesk"],
  partyCreationNPPs: {
    statesRequired: 2,
    lockHomeState: false,
    nppsPerState: 1,
  },
  demographicProfileId: "fi_archetypes",
  centralBank: {
    name: "Bank of Finland",
    abbreviation: "BoF",
    chairTitle: "Governor of the Bank of Finland",
    defaultPrimeRate: 8.5,
    heroImage: "https://flagcdn.com/w640/fi.png",
  },
  usdExchangeRate: 0.256,
  currencyCode: "FIM",
  fiscalYearStartTurnInYear: 40,
  financeMinisterCabinetId: "minister_of_finance",
  status: "coming-soon",
  tagline:
    "Kekkonen's balancing act — a neutral Nordic democracy trading both ways across the Iron Curtain, multiparty coalitions under a dominant president, and the forest economy that pays for the welfare state.",
  descriptor:
    "A parliamentary republic where a Prime Minister governs at the confidence of the unicameral 200-seat Eduskunta, under a strong presidency that steers foreign policy between East and West.",
  heroImage: "https://flagcdn.com/w640/fi.png",
  entryPath: "/country/fi",
  overviewPath: "/country/fi",
  mapPath: "/country/fi/map",
  executivePath: "/country/fi/executive",
  executiveLabel: "Government Palace",
  centralGovernmentLabel: "State Budget",
};

/* No FI_LEGISLATIVE_PROCESS: the registry has no FI row, and readers
   fall through to DEFAULT_PROCESS. The registry holds six keys; a country absent
   from it has never had its own process, and writing the default here would say
   it did. */

export const FI_ORDERS_OF_BATTLE: OrderOfBattleEntry[] = [
  {
    branchId: "army",
    type: "Infantry Division",
    count: 3,
  },
  {
    branchId: "army",
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
    count: 1,
  },
];

export const FI_MILITARY_BRANCHES: Branch[] = [
  {
    id: "army",
    name: "Army",
    abbr: "MAAV",
    domain: "ground",
  },
  {
    id: "navy",
    name: "Navy",
    abbr: "MERIV",
    domain: "naval",
  },
  {
    id: "airforce",
    name: "Air Force",
    abbr: "ILMAV",
    domain: "air",
  },
];

/* No FI_ESTATE_PORTFOLIO: no row; seedCabinetEstates skips the country. */

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
export const FI_CABINET_SEAT_IDS = {
  energy: undefined,
  infrastructure: undefined,
  defense: "minister_of_defence",
  foreignAffairs: "minister_of_foreign_affairs",
  tradeMinister: "minister_of_trade_industry",
} as const;

/** Military scale multiplier. */
export const FI_MILITARY_SCALE = 0.9;

/** Which office assents to regional bills. */
/* No FI_REGIONAL_BILL_ASSENT_OFFICE_KEY: the registry has no FI entry.
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
/* No FI_CABINET_GROUPS: the registry has no FI row, and its only
   reader already falls back to "Centre" per position. */
