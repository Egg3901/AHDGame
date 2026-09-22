import type { Branch } from "@/lib/constants/military";

import type { CountryConfig } from "@/lib/constants/countries";

import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";

/**
 * GR's institutions, as pure data.
 *
 * ⚠ GENERATED FROM `__snapshots__/gr.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-institutions.ts GR --force
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair:
 * registries that want one seat id or the legislative process import from HERE,
 * while `institutions.ts` composes these with the cabinet and is heavy. A
 * registry that reads a single string through the heavy module ships the whole
 * cabinet to the browser, which is a regression this work has already shipped
 * once. `clientSafeLeafModules.test.ts` enforces it.
 */

export const GR_CONFIG: CountryConfig = {
  id: "GR",
  name: "Greece",
  flagEmoji: "🇬🇷",
  code: "GR",
  socialAxisBaseline: 1,
  regionLabel: "Region",
  regionLabelPlural: "Regions",
  executiveTitle: "Prime Minister",
  headOfStateTitle: "President",
  executiveRealmPhrase: "Greece",
  governmentType: "parliamentaryRepublic",
  governmentTypeLabel: "Parliamentary Republic",
  coalitionThreshold: 151,
  legislature: {
    name: "Hellenic Parliament",
    path: "/country/gr/legislature",
    bicameral: false,
    lowerChamber: {
      key: "vouli",
      name: "Hellenic Parliament",
      shortName: "Vouli",
      seats: 300,
      description:
        "300 deputies of the unicameral Vouli ton Ellinon, elected by reinforced proportional representation for four-year terms.",
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
      termYears: 5,
      actionBonus: 0,
      partyStrengthWeight: 0,
    },
    {
      key: "deputy",
      label: "Deputy",
      labelPlural: "Deputies",
      chamberKey: "vouli",
      isExecutive: false,
      isSubNational: false,
      termYears: 4,
      actionBonus: 1,
      partyStrengthWeight: 0.9,
    },
    {
      key: "centralBankChair",
      label: "Governor of the Bank of Greece",
      labelPlural: "Governors of the Bank of Greece",
      isExecutive: false,
      isSubNational: false,
      termYears: 6,
      actionBonus: 3,
      partyStrengthWeight: 0,
    },
  ],
  majorPartyIds: ["gr_nd", "gr_pasok"],
  partyCreationNPPs: {
    statesRequired: 2,
    lockHomeState: false,
    nppsPerState: 1,
  },
  demographicProfileId: "gr_archetypes",
  centralBank: {
    name: "Bank of Greece",
    abbreviation: "BoG",
    chairTitle: "Governor of the Bank of Greece",
    defaultPrimeRate: 16.5,
    heroImage: "https://flagcdn.com/w640/gr.png",
  },
  usdExchangeRate: 0.027,
  currencyCode: "GRD",
  fiscalYearStartTurnInYear: 40,
  financeMinisterCabinetId: "minister_of_finance",
  status: "coming-soon",
  tagline:
    "A restored democracy finding its feet — Karamanlis's republic between NATO, an EEC accession course, and PASOK's rising challenge, with the junta years still a fresh memory.",
  descriptor:
    "A parliamentary republic where a Prime Minister governs at the confidence of the unicameral 300-seat Vouli, elected by reinforced proportional representation.",
  heroImage: "https://flagcdn.com/w640/gr.png",
  entryPath: "/country/gr",
  overviewPath: "/country/gr",
  mapPath: "/country/gr/map",
  executivePath: "/country/gr/executive",
  executiveLabel: "Maximos Mansion",
  centralGovernmentLabel: "State Budget",
};

/* No GR_LEGISLATIVE_PROCESS: the registry has no GR row, and readers
   fall through to DEFAULT_PROCESS. The registry holds six keys; a country absent
   from it has never had its own process, and writing the default here would say
   it did. */

export const GR_ORDERS_OF_BATTLE: OrderOfBattleEntry[] = [
  {
    branchId: "army",
    type: "Infantry Division",
    count: 4,
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
    count: 2,
  },
];

export const GR_MILITARY_BRANCHES: Branch[] = [
  {
    id: "army",
    name: "Hellenic Army",
    abbr: "ES",
    domain: "ground",
  },
  {
    id: "navy",
    name: "Hellenic Navy",
    abbr: "PN",
    domain: "naval",
  },
  {
    id: "airforce",
    name: "Hellenic Air Force",
    abbr: "PA",
    domain: "air",
  },
];

/* No GR_ESTATE_PORTFOLIO: no row; seedCabinetEstates skips the country. */

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
export const GR_CABINET_SEAT_IDS = {
  energy: undefined,
  infrastructure: undefined,
  defense: "minister_of_defence",
  foreignAffairs: "minister_of_foreign_affairs",
  tradeMinister: "minister_of_trade_industry",
} as const;

/** Military scale multiplier. */
export const GR_MILITARY_SCALE = 0.9;

/** Which office assents to regional bills. */
/* No GR_REGIONAL_BILL_ASSENT_OFFICE_KEY: the registry has no GR entry.
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
/* No GR_CABINET_GROUPS: the registry has no GR row, and its only
   reader already falls back to "Centre" per position. */
