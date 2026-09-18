import type { Branch } from "@/lib/constants/military";

import type { CountryConfig } from "@/lib/constants/countries";

/**
 * WAL's institutions, as pure data.
 *
 * ⚠ GENERATED FROM `__snapshots__/wal.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-institutions.ts WAL --force
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair:
 * registries that want one seat id or the legislative process import from HERE,
 * while `institutions.ts` composes these with the cabinet and is heavy. A
 * registry that reads a single string through the heavy module ships the whole
 * cabinet to the browser, which is a regression this work has already shipped
 * once. `clientSafeLeafModules.test.ts` enforces it.
 */

export const WAL_CONFIG: CountryConfig = {
  id: "WAL",
  seedEconomicModel: {
    "1991": "financialized",
    "2019": "financialized",
  },
  name: "Wales",
  flagEmoji: "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
  code: "WAL",
  socialAxisBaseline: -2,
  regionLabel: "Region",
  regionLabelPlural: "Regions",
  executiveTitle: "First Minister",
  executiveRealmPhrase: "Wales",
  governmentType: "parliamentaryRepublic",
  governmentTypeLabel: "Parliamentary Republic",
  coalitionThreshold: 31,
  legislature: {
    name: "Senedd Cymru",
    path: "/country/wal/legislature",
    bicameral: false,
    lowerChamber: {
      key: "senedd",
      name: "Senedd Cymru",
      shortName: "Senedd",
      seats: 60,
      description:
        "60 Members of the Senedd elected by the Additional Member System - 40 constituency seats plus 20 regional list seats.",
      elected: true,
    },
  },
  lowerElectionSystem: {
    termYears: 5,
    seatsContested: "all",
    singleMemberConstituencies: false,
    snapElectionsAllowed: true,
  },
  subNationalChamber: {
    key: "regionalCouncil",
    name: "Regional Council",
    shortName: "Council",
    seats: 22,
    description: "Elected councillors representing Wales's principal areas.",
    regionalModel: true,
  },
  regionalBillAssentTitle: "Leader",
  electionSystems: {
    lowerChamber: "ams",
    subNationalChamber: "pr_hareQuota",
    headOfGovernment: "parliamentary",
    headOfState: "ceremonial",
  },
  officeTypes: [
    {
      key: "firstMinister",
      label: "First Minister",
      labelPlural: "First Ministers",
      isExecutive: true,
      isSubNational: false,
      actionBonus: 4,
      partyStrengthWeight: 1,
    },
    {
      key: "senedd",
      label: "Member of the Senedd",
      labelPlural: "Members of the Senedd",
      chamberKey: "senedd",
      isExecutive: false,
      isSubNational: false,
      termYears: 5,
      actionBonus: 1,
      partyStrengthWeight: 0.85,
    },
    {
      key: "governor",
      label: "Leader",
      labelPlural: "Leaders",
      isExecutive: false,
      isSubNational: true,
      termYears: 4,
      actionBonus: 2,
      partyStrengthWeight: 1,
    },
    {
      key: "regionalCouncil",
      label: "Regional Councillor",
      labelPlural: "Regional Councillors",
      chamberKey: "regionalCouncil",
      isExecutive: false,
      isSubNational: true,
      termYears: 5,
      actionBonus: 1,
      partyStrengthWeight: 0.85,
    },
    {
      key: "centralBankChair",
      label: "Governor of the Bank of England",
      labelPlural: "Governors of the Bank of England",
      isExecutive: false,
      isSubNational: false,
      termYears: 4,
      actionBonus: 3,
      partyStrengthWeight: 0,
    },
  ],
  majorPartyIds: ["PC", "LAB"],
  partyCreationNPPs: {
    statesRequired: 2,
    lockHomeState: false,
    nppsPerState: 1,
  },
  demographicProfileId: "uk_archetypes",
  centralBank: {
    name: "Bank of England",
    abbreviation: "BoE",
    chairTitle: "Governor of the Bank of England",
    defaultPrimeRate: 3,
    sharedBankId: "UK",
    heroImage: "/api/images/hero/bank-of-england",
  },
  exchangeName: "FTSE",
  usdExchangeRate: 1,
  currencyCode: "GBP",
  fiscalYearStartTurnInYear: 40,
  financeMinisterCabinetId: "financeSecretary",
  status: "coming-soon",
  tagline:
    "An independent Wales - a single-chamber Senedd, Additional Member System elections, and a sterling-zone economy.",
  descriptor:
    "A parliamentary republic where the First Minister leads government through a Senedd majority, elected by the Additional Member System across Wales's regions.",
  heroImage: "https://flagcdn.com/w640/gb-wls.png",
  entryPath: "/country/wal",
  overviewPath: "/country/wal",
  mapPath: "/country/wal/map",
  executivePath: "/country/wal/executive",
  executiveLabel: "Welsh Government",
  centralGovernmentLabel: "Welsh Block Grant",
};

/* No WAL_LEGISLATIVE_PROCESS: the registry has no WAL row, and readers
   fall through to DEFAULT_PROCESS. The registry holds six keys; a country absent
   from it has never had its own process, and writing the default here would say
   it did. */

/* No WAL_ORDERS_OF_BATTLE: no row; getOrderOfBattle returns null. */

export const WAL_MILITARY_BRANCHES: Branch[] = [];

/* No WAL_ESTATE_PORTFOLIO: no row; seedCabinetEstates skips the country. */

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
export const WAL_CABINET_SEAT_IDS = {
  energy: undefined,
  infrastructure: undefined,
  defense: null,
  foreignAffairs: null,
  tradeMinister: null,
} as const;

/** Military scale multiplier. */
export const WAL_MILITARY_SCALE = 1;

/** Which office assents to regional bills. */
/* No WAL_REGIONAL_BILL_ASSENT_OFFICE_KEY: the registry has no WAL entry.
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
/* No WAL_CABINET_GROUPS: the registry has no WAL row, and its only
   reader already falls back to "Centre" per position. */
