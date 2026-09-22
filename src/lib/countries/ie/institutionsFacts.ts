import type { Branch } from "@/lib/constants/military";
import type { CabinetGroup } from "@/lib/constants/cabinetPositionGroups";
import type { CountryConfig } from "@/lib/constants/countries";
import type { LegislativeProcess } from "@/lib/legislature/process";
import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";

/**
 * IE's institutions, as pure data.
 *
 * ⚠ GENERATED FROM `__snapshots__/ie.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-institutions.ts IE --force
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair:
 * registries that want one seat id or the legislative process import from HERE,
 * while `institutions.ts` composes these with the cabinet and is heavy. A
 * registry that reads a single string through the heavy module ships the whole
 * cabinet to the browser, which is a regression this work has already shipped
 * once. `clientSafeLeafModules.test.ts` enforces it.
 */

export const IE_CONFIG: CountryConfig = {
  id: "IE",
  seedEconomicModel: {
    "1991": "agrarian",
    "2019": "techInnovation",
  },
  name: "Ireland",
  flagEmoji: "🇮🇪",
  code: "IE",
  socialAxisBaseline: -1.5,
  regionLabel: "Region",
  regionLabelPlural: "Regions",
  executiveTitle: "Taoiseach",
  headOfStateTitle: "Uachtarán na hÉireann",
  executiveRealmPhrase: "Ireland",
  governmentType: "parliamentaryRepublic",
  governmentTypeLabel: "Parliamentary Republic",
  discordWebhookNote: "ECB rate decisions (shared with Germany).",
  coalitionThreshold: 81,
  legislature: {
    name: "Oireachtas",
    path: "/country/ie/legislature",
    bicameral: false,
    upperChamber: {
      key: "seanad",
      name: "Seanad Éireann",
      shortName: "Seanad",
      seats: 60,
      description:
        "60 senators - 43 elected from vocational panels, 11 nominated by the Taoiseach, 6 from universities.",
    },
    lowerChamber: {
      key: "dail",
      name: "Dáil Éireann",
      shortName: "Dáil",
      seats: 160,
      description:
        "160 TDs elected by proportional representation using the Single Transferable Vote across multi-seat constituencies.",
      elected: true,
    },
  },
  lowerElectionSystem: {
    termYears: 5,
    seatsContested: "all",
    singleMemberConstituencies: false,
    snapElectionsAllowed: true,
  },
  electionSystems: {
    lowerChamber: "pr_hareQuota",
    upperChamber: "pr_hareQuota",
    subNationalChamber: "pr_hareQuota",
    headOfGovernment: "parliamentary",
    headOfState: "fptp",
  },
  officeTypes: [
    {
      key: "taoiseach",
      label: "Taoiseach",
      labelPlural: "Taoisigh",
      isExecutive: true,
      isSubNational: false,
      actionBonus: 4,
      partyStrengthWeight: 1,
    },
    {
      key: "tanaiste",
      label: "Tánaiste",
      labelPlural: "Tánaistí",
      isExecutive: true,
      isSubNational: false,
      actionBonus: 2,
      partyStrengthWeight: 1,
    },
    {
      key: "uachtaran",
      label: "Uachtarán",
      labelPlural: "Uachtaráin",
      isExecutive: true,
      isHeadOfState: true,
      isSubNational: false,
      termYears: 7,
      actionBonus: 3,
      partyStrengthWeight: 0.5,
    },
    {
      key: "dail",
      label: "Teachta Dála",
      labelPlural: "Teachtaí Dála",
      chamberKey: "dail",
      isExecutive: false,
      isSubNational: false,
      termYears: 5,
      actionBonus: 1,
      partyStrengthWeight: 0.85,
    },
    {
      key: "centralBankChair",
      label: "Governor of the Central Bank of Ireland",
      labelPlural: "Governors of the Central Bank of Ireland",
      isExecutive: false,
      isSubNational: false,
      termYears: 7,
      actionBonus: 3,
      partyStrengthWeight: 0,
    },
    {
      key: "localCouncil",
      label: "Councillor",
      labelPlural: "Councillors",
      chamberKey: "localCouncil",
      isExecutive: false,
      isSubNational: true,
      termYears: 5,
      actionBonus: 1,
      partyStrengthWeight: 0.8,
    },
    {
      key: "governor",
      label: "Cathaoirleach",
      labelPlural: "Cathaoirligh",
      isExecutive: false,
      isSubNational: true,
      termYears: 5,
      actionBonus: 2,
      partyStrengthWeight: 1,
    },
  ],
  subNationalChamber: {
    key: "localCouncil",
    name: "Local Council",
    shortName: "Council",
    seats: 200,
    description:
      "Elected councillors representing Ireland's NUTS-III planning regions, exercising delegated local-government functions.",
    elected: true,
    regionalModel: true,
  },
  regionalBillAssentTitle: "Cathaoirleach",
  majorPartyIds: ["fine_gael", "fianna_fail"],
  partyCreationNPPs: {
    statesRequired: 2,
    lockHomeState: false,
    nppsPerState: 1,
  },
  demographicProfileId: "ie_archetypes",
  executiveTermLimit: {
    officeKey: "uachtaran",
    maxTermsPerCharacter: 2,
    blocksRunningMateSelection: false,
  },
  centralBank: {
    name: "Central Bank of Ireland",
    abbreviation: "CBI",
    chairTitle: "Governor of the Central Bank of Ireland",
    defaultPrimeRate: 3,
    heroImage: "/api/images/hero/ecb",
  },
  exchangeName: "ISEQ",
  usdExchangeRate: 1,
  currencyCode: "IEP",
  fiscalYearStartTurnInYear: 40,
  financeMinisterCabinetId: "minister_for_finance",
  status: "active",
  tagline:
    "Parliamentary republic on the Atlantic edge of Europe - coalition politics, PR-STV elections, and a rapidly modernising economy.",
  descriptor:
    "A parliamentary republic where the Taoiseach leads government through a Dáil majority, elected by proportional representation using the Single Transferable Vote across multi-seat constituencies.",
  heroImage: "https://flagcdn.com/w640/ie.png",
  entryPath: "/country/ie",
  overviewPath: "/country/ie",
  mapPath: "/country/ie/map",
  executivePath: "/country/ie/executive",
  executiveLabel: "Government Buildings",
  centralGovernmentLabel: "Exchequer Grants",
};

export const IE_LEGISLATIVE_PROCESS: LegislativeProcess = {
  executive: {
    title: "Enactment",
    canVeto: false,
    signLabel: "Signed into law",
    signNote: "Once passed by the Dáil, the bill is enacted into law.",
    override: null,
  },
  upperNote:
    "The Seanad may revise or delay a bill, but the Dáil ultimately prevails. Seanad business is not player-managed.",
  dissolution: {
    actor: "Taoiseach",
    body: "The Taoiseach may seek a dissolution of the Dáil; a general election is called and all bills in progress fall.",
  },
  quirks: [
    {
      icon: "building",
      title: "Dáil supremacy",
      body: "The Dáil drives all legislation; the Seanad can delay but not block.",
    },
    {
      icon: "bolt",
      title: "Dissolution",
      body: "A Taoiseach-sought election dissolves the Dáil and ends pending bills.",
    },
  ],
  seatingStyle: "horseshoe",
};

export const IE_ORDERS_OF_BATTLE: OrderOfBattleEntry[] = [
  {
    branchId: "army",
    type: "Infantry Division",
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
    count: 1,
  },
  {
    branchId: "aircorps",
    type: "Fighter Wing",
    count: 1,
  },
];

export const IE_MILITARY_BRANCHES: Branch[] = [
  {
    id: "army",
    name: "Irish Army",
    abbr: "Army",
    domain: "ground",
  },
  {
    id: "navy",
    name: "Naval Service",
    abbr: "NS",
    domain: "naval",
  },
  {
    id: "aircorps",
    name: "Air Corps",
    abbr: "AC",
    domain: "air",
  },
];

export const IE_ESTATE_PORTFOLIO: Record<string, string> = {
  minister_for_foreign_affairs: "foreign",
  minister_for_enterprise: "commerce",
  minister_for_health: "health",
  minister_for_education: "education",
  minister_for_further_higher_education: "education",
  minister_for_housing: "housing",
  minister_for_social_protection: "labor",
  minister_for_justice: "justice",
  minister_for_environment_climate: "interior",
  minister_for_agriculture: "agriculture",
};

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
export const IE_CABINET_SEAT_IDS = {
  energy: "minister_for_environment_climate",
  infrastructure: "minister_for_transport",
  defense: "minister_for_defence",
  foreignAffairs: "minister_for_foreign_affairs",
  tradeMinister: "minister_for_enterprise",
} as const;

/** Military scale multiplier. */
export const IE_MILITARY_SCALE = 1;

/** Which office assents to regional bills. */
export const IE_REGIONAL_BILL_ASSENT_OFFICE_KEY = "governor";

/**
 * Which policy bucket each cabinet seat belongs to, for the cabinet UI.
 *
 * ⚠ THE CAST IS LOAD-BEARING. `CabinetGroup` is a union of bucket names, and
 * JSON.parse widens every one of them to `string`. Without it the object is
 * `Record<string, string>`, which is not assignable to `Record<string, CabinetGroup>`
 * and fails only under `npm run typecheck` -- eslint and the test suite both pass.
 */
export const IE_CABINET_GROUPS: Record<string, CabinetGroup> = {
  taoiseach: "Centre",
  tanaiste: "Centre",
  minister_for_finance: "Economy",
  minister_for_public_expenditure: "Economy",
  minister_for_enterprise: "Economy",
  minister_for_social_protection: "Economy",
  minister_for_agriculture: "Economy",
  minister_for_foreign_affairs: "Security & Foreign",
  minister_for_justice: "Security & Foreign",
  minister_for_defence: "Security & Foreign",
  minister_for_health: "Society",
  minister_for_education: "Society",
  minister_for_further_higher_education: "Society",
  minister_for_housing: "Society",
  minister_for_children: "Society",
  minister_for_tourism_culture: "Society",
  minister_for_environment_climate: "Domestic",
  minister_for_transport: "Domestic",
  minister_for_rural_community: "Domestic",
};
