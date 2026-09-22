import type { Branch } from "@/lib/constants/military";

import type { CountryConfig } from "@/lib/constants/countries";

import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";

/**
 * AT's institutions, as pure data.
 *
 * ⚠ GENERATED FROM `__snapshots__/at.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-institutions.ts AT --force
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair:
 * registries that want one seat id or the legislative process import from HERE,
 * while `institutions.ts` composes these with the cabinet and is heavy. A
 * registry that reads a single string through the heavy module ships the whole
 * cabinet to the browser, which is a regression this work has already shipped
 * once. `clientSafeLeafModules.test.ts` enforces it.
 */

export const AT_CONFIG: CountryConfig = {
  id: "AT",
  name: "Austria",
  flagEmoji: "🇦🇹",
  code: "AT",
  socialAxisBaseline: 0,
  regionLabel: "Region",
  regionLabelPlural: "Regions",
  executiveTitle: "Chancellor",
  headOfStateTitle: "President",
  executiveRealmPhrase: "Austria",
  governmentType: "parliamentaryRepublic",
  governmentTypeLabel: "Parliamentary Republic",
  coalitionThreshold: 92,
  legislature: {
    name: "Nationalrat",
    path: "/country/at/legislature",
    bicameral: false,
    upperChamber: {
      key: "bundesrat",
      name: "Bundesrat",
      shortName: "Bundesrat",
      seats: 61,
      description:
        "61 members delegated by the nine Landtage in proportion to Land population; a suspensive-veto chamber outside the confidence loop.",
    },
    lowerChamber: {
      key: "nationalrat",
      name: "Nationalrat",
      shortName: "Nationalrat",
      seats: 183,
      description: "183 deputies elected by proportional representation for four-year terms.",
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
      label: "Chancellor",
      labelPlural: "Chancellors",
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
      label: "Deputy",
      labelPlural: "Deputies",
      chamberKey: "nationalrat",
      isExecutive: false,
      isSubNational: false,
      termYears: 4,
      actionBonus: 1,
      partyStrengthWeight: 0.9,
    },
    {
      key: "centralBankChair",
      label: "Governor of the Oesterreichische Nationalbank",
      labelPlural: "Governors of the Oesterreichische Nationalbank",
      isExecutive: false,
      isSubNational: false,
      termYears: 6,
      actionBonus: 3,
      partyStrengthWeight: 0,
    },
  ],
  majorPartyIds: ["at_spo", "at_ovp"],
  partyCreationNPPs: {
    statesRequired: 2,
    lockHomeState: false,
    nppsPerState: 1,
  },
  demographicProfileId: "at_archetypes",
  centralBank: {
    name: "Oesterreichische Nationalbank",
    abbreviation: "OeNB",
    chairTitle: "Governor of the Oesterreichische Nationalbank",
    defaultPrimeRate: 5.5,
    heroImage: "https://flagcdn.com/w640/at.png",
  },
  usdExchangeRate: 0.075,
  currencyCode: "ATS",
  fiscalYearStartTurnInYear: 40,
  financeMinisterCabinetId: "minister_of_finance",
  status: "coming-soon",
  tagline:
    "Kreisky's neutral social democracy at its zenith — an absolute SPÖ majority, Austro-Keynesian full employment, the hard schilling, and active bridge-building between the blocs from a permanently neutral Vienna.",
  descriptor:
    "A parliamentary republic where a Chancellor governs at the confidence of the unicameral 183-seat Nationalrat; constitutionally neutral since 1955 and outside both alliances.",
  heroImage: "https://flagcdn.com/w640/at.png",
  entryPath: "/country/at",
  overviewPath: "/country/at",
  mapPath: "/country/at/map",
  executivePath: "/country/at/executive",
  executiveLabel: "Ballhausplatz",
  centralGovernmentLabel: "Federal Budget",
};

/* No AT_LEGISLATIVE_PROCESS: the registry has no AT row, and readers
   fall through to DEFAULT_PROCESS. The registry holds six keys; a country absent
   from it has never had its own process, and writing the default here would say
   it did. */

export const AT_ORDERS_OF_BATTLE: OrderOfBattleEntry[] = [
  {
    branchId: "heer",
    type: "Infantry Division",
    count: 2,
  },
  {
    branchId: "heer",
    type: "Artillery Regiment",
    count: 1,
  },
  {
    branchId: "luft",
    type: "Fighter Wing",
    count: 1,
  },
];

export const AT_MILITARY_BRANCHES: Branch[] = [
  {
    id: "heer",
    name: "Land Forces",
    abbr: "ÖBH",
    domain: "ground",
    establishedYear: 1955,
  },
  {
    id: "luft",
    name: "Air Forces",
    abbr: "ÖLK",
    domain: "air",
    establishedYear: 1955,
  },
];

/* No AT_ESTATE_PORTFOLIO: no row; seedCabinetEstates skips the country. */

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
export const AT_CABINET_SEAT_IDS = {
  energy: undefined,
  infrastructure: undefined,
  defense: "minister_of_defence",
  foreignAffairs: "minister_of_foreign_affairs",
  tradeMinister: "minister_of_trade_industry",
} as const;

/** Military scale multiplier. */
export const AT_MILITARY_SCALE = 0.85;

/** Which office assents to regional bills. */
/* No AT_REGIONAL_BILL_ASSENT_OFFICE_KEY: the registry has no AT entry.
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
/* No AT_CABINET_GROUPS: the registry has no AT row, and its only
   reader already falls back to "Centre" per position. */
