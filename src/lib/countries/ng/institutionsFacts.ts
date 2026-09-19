import type { Branch } from "@/lib/constants/military";
import type { CabinetGroup } from "@/lib/constants/cabinetPositionGroups";
import type { CountryConfig } from "@/lib/constants/countries";

import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";

/**
 * NG's institutions, as pure data.
 *
 * ⚠ GENERATED FROM `__snapshots__/ng.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-institutions.ts NG --force
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair:
 * registries that want one seat id or the legislative process import from HERE,
 * while `institutions.ts` composes these with the cabinet and is heavy. A
 * registry that reads a single string through the heavy module ships the whole
 * cabinet to the browser, which is a regression this work has already shipped
 * once. `clientSafeLeafModules.test.ts` enforces it.
 */

export const NG_CONFIG: CountryConfig = {
  id: "NG",
  name: "Nigeria",
  flagEmoji: "🇳🇬",
  code: "NG",
  regionLabel: "Zone",
  regionLabelPlural: "Zones",
  executiveTitle: "President",
  executiveRealmPhrase: "Nigeria",
  governmentType: "presidential",
  governmentTypeLabel: "Presidential Republic",
  coalitionThreshold: 181,
  legislature: {
    name: "National Assembly",
    path: "/country/ng/legislature",
    bicameral: true,
    upperChamber: {
      key: "senate",
      name: "Senate",
      shortName: "Senate",
      seats: 109,
      description:
        "109 senators elected from constituencies across the Nigerian federation for four-year terms.",
      elected: true,
    },
    lowerChamber: {
      key: "house",
      name: "House of Representatives",
      shortName: "House",
      seats: 360,
      description:
        "360 representatives elected from single-member constituencies across the Nigerian federation.",
      elected: true,
    },
  },
  lowerElectionSystem: {
    termYears: 4,
    seatsContested: "all",
    singleMemberConstituencies: true,
    snapElectionsAllowed: false,
  },
  upperElectionSystem: {
    termYears: 4,
    seatsContested: "all",
    singleMemberConstituencies: true,
    snapElectionsAllowed: false,
  },
  electionSystems: {
    lowerChamber: "fptp",
    upperChamber: "fptp",
    headOfState: "fptp",
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
      termYears: 4,
      actionBonus: 2,
      partyStrengthWeight: 0.8,
    },
    {
      key: "house",
      label: "Representative",
      labelPlural: "Representatives",
      chamberKey: "house",
      isExecutive: false,
      isSubNational: false,
      termYears: 4,
      actionBonus: 1,
      partyStrengthWeight: 0.9,
    },
    {
      key: "regionalCouncil",
      label: "Assembly Member",
      labelPlural: "Assembly Members",
      isExecutive: false,
      isSubNational: true,
      termYears: 4,
      actionBonus: 1,
      partyStrengthWeight: 0.85,
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
      label: "Governor of the CBN",
      labelPlural: "Governors of the CBN",
      isExecutive: false,
      isSubNational: false,
      termYears: 5,
      actionBonus: 3,
      partyStrengthWeight: 0,
    },
  ],
  majorPartyIds: ["apc", "pdp"],
  partyCreationNPPs: {
    statesRequired: 3,
    lockHomeState: true,
    nppsPerState: 2,
  },
  demographicProfileId: "ng_archetypes",
  executiveTermLimit: {
    officeKey: "president",
    maxTermsPerCharacter: 2,
    blocksRunningMateSelection: true,
  },
  centralBank: {
    name: "Central Bank of Nigeria",
    abbreviation: "CBN",
    chairTitle: "Governor of the CBN",
    defaultPrimeRate: 12,
    heroImage: "/api/images/hero/central-bank-of-nigeria",
  },
  exchangeName: "NGX",
  usdExchangeRate: 0.00064,
  currencyCode: "NGN",
  fiscalYearStartTurnInYear: 40,
  financeMinisterCabinetId: "minister_of_finance",
  status: "coming-soon",
  tagline:
    "Africa's most populous democracy — a federal presidential republic of six geopolitical zones, governed by a directly elected President and a bicameral National Assembly.",
  descriptor:
    "A federal presidential republic where a directly elected President governs alongside a bicameral National Assembly — a 109-seat Senate and a 360-seat House of Representatives — across six geopolitical zones spanning the Nigerian federation.",
  heroImage: "https://flagcdn.com/w640/ng.png",
  entryPath: "/country/ng",
  overviewPath: "/country/ng",
  mapPath: "/country/ng/map",
  executivePath: "/country/ng/executive",
  executiveLabel: "Aso Rock",
  centralGovernmentLabel: "Federal Allocations",
};

/* No NG_LEGISLATIVE_PROCESS: the registry has no NG row, and readers
   fall through to DEFAULT_PROCESS. The registry holds six keys; a country absent
   from it has never had its own process, and writing the default here would say
   it did. */

export const NG_ORDERS_OF_BATTLE: OrderOfBattleEntry[] = [
  {
    branchId: "army",
    type: "Infantry Division",
    count: 2,
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

export const NG_MILITARY_BRANCHES: Branch[] = [
  {
    id: "army",
    name: "Nigerian Army",
    abbr: "NA",
    domain: "ground",
    establishedYear: 1960,
  },
  {
    id: "navy",
    name: "Nigerian Navy",
    abbr: "NN",
    domain: "naval",
    establishedYear: 1956,
  },
  {
    id: "airforce",
    name: "Nigerian Air Force",
    abbr: "NAF",
    domain: "air",
    establishedYear: 1964,
  },
];

/* No NG_ESTATE_PORTFOLIO: no row; seedCabinetEstates skips the country. */

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
export const NG_CABINET_SEAT_IDS = {
  energy: undefined,
  infrastructure: undefined,
  defense: "minister_of_defence",
  foreignAffairs: "minister_of_foreign_affairs",
  tradeMinister: "minister_of_trade_industry",
} as const;

/** Military scale multiplier. */
export const NG_MILITARY_SCALE = 0.85;

/** Which office assents to regional bills. */
/* No NG_REGIONAL_BILL_ASSENT_OFFICE_KEY: the registry has no NG entry.
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
export const NG_CABINET_GROUPS: Record<string, CabinetGroup> = {
  director_of_intelligence: "Security & Foreign",
  secretary_to_government: "Centre",
  minister_of_finance: "Economy",
  minister_of_petroleum_resources: "Economy",
  minister_of_power: "Economy",
  minister_of_trade_industry: "Economy",
  minister_of_labour: "Economy",
  minister_of_agriculture: "Economy",
  minister_of_defence: "Security & Foreign",
  minister_of_foreign_affairs: "Security & Foreign",
  minister_of_interior: "Security & Foreign",
  minister_of_justice: "Security & Foreign",
  minister_of_health: "Society",
  minister_of_education: "Society",
  minister_of_works_housing: "Society",
  minister_of_information: "Society",
  minister_of_environment: "Domestic",
};
