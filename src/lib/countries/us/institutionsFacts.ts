import type { Branch } from "@/lib/constants/military";
import type { CabinetGroup } from "@/lib/constants/cabinetPositionGroups";
import type { CountryConfig } from "@/lib/constants/countries";
import type { LegislativeProcess } from "@/lib/legislature/process";
import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";

/**
 * US's institutions, as pure data.
 *
 * ⚠ GENERATED FROM `__snapshots__/us.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-institutions.ts US --force
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair:
 * registries that want one seat id or the legislative process import from HERE,
 * while `institutions.ts` composes these with the cabinet and is heavy. A
 * registry that reads a single string through the heavy module ships the whole
 * cabinet to the browser, which is a regression this work has already shipped
 * once. `clientSafeLeafModules.test.ts` enforces it.
 */

export const US_CONFIG: CountryConfig = {
  id: "US",
  seedEconomicModel: {
    "1991": "militaryIndustrial",
    "2019": "techInnovation",
  },
  name: "United States",
  flagEmoji: "🇺🇸",
  code: "US",
  socialAxisBaseline: -1.5,
  regionLabel: "State",
  regionLabelPlural: "States",
  executiveTitle: "President",
  executiveRealmPhrase: "the United States",
  governmentType: "presidential",
  governmentTypeLabel: "Presidential Republic",
  campaignManagerNonPresidentialEnabled: true,
  coalitionThreshold: 218,
  legislature: {
    name: "Congress",
    path: "/country/us/legislature",
    bicameral: true,
    upperChamber: {
      key: "senate",
      name: "Senate",
      shortName: "Senate",
      seats: 100,
      description: "100 senators, six-year staggered terms. Confirms judges and cabinet.",
      elected: true,
      regionElectedClasses: true,
    },
    lowerChamber: {
      key: "house",
      name: "House of Representatives",
      shortName: "House",
      seats: 435,
      description: "435 representatives, two-year terms. All revenue bills originate here.",
    },
  },
  lowerElectionSystem: {
    termYears: 2,
    seatsContested: "all",
    singleMemberConstituencies: false,
    snapElectionsAllowed: false,
  },
  upperElectionSystem: {
    termYears: 6,
    seatsContested: "partial",
    staggeredClasses: 3,
    singleMemberConstituencies: true,
    snapElectionsAllowed: false,
  },
  electionSystems: {
    lowerChamber: "pr_hareQuota",
    upperChamber: "fptp",
    subNationalChamber: "pr_hareQuota",
    subNationalExecutive: "fptp",
    headOfState: "electoralCollege",
  },
  subNationalChamber: {
    key: "stateSenate",
    name: "State Senate",
    shortName: "State Senate",
    seats: 1972,
    description: "Each state's elected legislature, which sets state law and budgets.",
    elected: true,
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
      termYears: 6,
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
      termYears: 2,
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
      key: "stateSenate",
      label: "State Senator",
      labelPlural: "State Senators",
      isExecutive: false,
      isSubNational: true,
      termYears: 4,
      actionBonus: 1,
      partyStrengthWeight: 0.85,
    },
    {
      key: "centralBankChair",
      label: "Federal Reserve Chair",
      labelPlural: "Federal Reserve Chairs",
      isExecutive: false,
      isSubNational: false,
      termYears: 4,
      actionBonus: 3,
      partyStrengthWeight: 0,
    },
  ],
  majorPartyIds: ["democrat", "republican"],
  partyCreationNPPs: {
    statesRequired: 4,
    lockHomeState: true,
    nppsPerState: 2,
  },
  demographicProfileId: "us_archetypes",
  executiveTermLimit: {
    officeKey: "president",
    maxTermsPerCharacter: 2,
    blocksRunningMateSelection: true,
  },
  centralBank: {
    name: "Federal Reserve",
    abbreviation: "Fed",
    chairTitle: "Federal Reserve Chair",
    defaultPrimeRate: 3,
    heroImage: "/api/images/hero/federal-reserve",
    heroAlt: "Marriner S. Eccles Federal Reserve Board Building, Washington D.C.",
  },
  exchangeName: "NYSE",
  usdExchangeRate: 1,
  currencyCode: "USD",
  fiscalYearStartTurnInYear: 40,
  financeMinisterCabinetId: "secretary_of_treasury",
  status: "active",
  tagline:
    "The original simulation - all 50 states, a bicameral Congress, and a presidential executive.",
  descriptor:
    "A federal presidential republic with 50 states, a bicameral Congress, and a directly elected President who serves as both head of state and government.",
  heroImage: "https://flagcdn.com/w640/us.png",
  overviewHeroImage: "/api/images/hero/us-overview-mount-rushmore",
  entryPath: "/dashboard",
  overviewPath: "/country/us",
  mapPath: "/country/us/map",
  executivePath: "/country/us/executive",
  executiveLabel: "White House",
  centralGovernmentLabel: "Federal Grants",
};

export const US_LEGISLATIVE_PROCESS: LegislativeProcess = {
  executive: {
    title: "President",
    canVeto: true,
    signLabel: "President signs",
    vetoLabel: "Veto",
    signNote: "The President may sign the bill into law or return it with a veto.",
    override: {
      threshold: "two-thirds",
      body: "both chambers",
      note: "A two-thirds vote in both the House and Senate overrides a presidential veto.",
    },
  },
  upperNote:
    "Both chambers are co-equal — the bill must pass the House and the Senate in identical form.",
  dissolution: null,
  quirks: [
    {
      icon: "shield",
      title: "Presidential veto",
      body: "Enrolled bills go to the President's desk to be signed or vetoed.",
    },
    {
      icon: "users",
      title: "Veto override",
      body: "Congress can override a veto with a two-thirds majority in both chambers.",
    },
    {
      icon: "scale",
      title: "Bicameral identical text",
      body: "House and Senate must agree on the same text before enrollment.",
    },
  ],
  seatingStyle: "hemicycle",
};

export const US_ORDERS_OF_BATTLE: OrderOfBattleEntry[] = [
  {
    branchId: "army",
    type: "Infantry Division",
    count: 8,
  },
  {
    branchId: "army",
    type: "Armored Division",
    count: 4,
  },
  {
    branchId: "army",
    type: "Artillery Regiment",
    count: 3,
  },
  {
    branchId: "army",
    type: "Air Defense Battalion",
    count: 2,
  },
  {
    branchId: "army",
    type: "Special Forces Group",
    count: 1,
  },
  {
    branchId: "navy",
    type: "Carrier Strike Group",
    count: 3,
  },
  {
    branchId: "navy",
    type: "Attack Submarine",
    count: 3,
  },
  {
    branchId: "navy",
    type: "Frigate Squadron",
    count: 3,
  },
  {
    branchId: "navy",
    type: "Amphibious Group",
    count: 2,
  },
  {
    branchId: "airforce",
    type: "Fighter Wing",
    count: 5,
  },
  {
    branchId: "airforce",
    type: "Bomber Squadron",
    count: 5,
  },
  {
    branchId: "airforce",
    type: "Airlift Wing",
    count: 3,
  },
  {
    branchId: "airforce",
    type: "Air Defense Wing",
    count: 2,
  },
  {
    branchId: "marines",
    type: "Marine Division",
    count: 3,
  },
  {
    branchId: "marines",
    type: "Marine Expeditionary Unit",
    count: 1,
  },
];

export const US_MILITARY_BRANCHES: Branch[] = [
  {
    id: "army",
    name: "U.S. Army",
    abbr: "USA",
    domain: "ground",
  },
  {
    id: "navy",
    name: "U.S. Navy",
    abbr: "USN",
    domain: "naval",
  },
  {
    id: "airforce",
    name: "U.S. Air Force",
    abbr: "USAF",
    domain: "air",
    establishedYear: 1947,
  },
  {
    id: "marines",
    name: "U.S. Marine Corps",
    abbr: "USMC",
    domain: "marine",
  },
  {
    id: "space",
    name: "U.S. Space Force",
    abbr: "USSF",
    domain: "space",
    establishedYear: 2019,
  },
];

export const US_ESTATE_PORTFOLIO: Record<string, string> = {
  secretary_of_state: "foreign",
  attorney_general: "justice",
  secretary_of_interior: "interior",
  secretary_of_agriculture: "agriculture",
  secretary_of_commerce: "commerce",
  secretary_of_labor: "labor",
  secretary_of_health: "health",
  secretary_of_hud: "housing",
  secretary_of_education: "education",
  secretary_of_veterans: "veterans",
  secretary_of_homeland: "homeland",
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
export const US_CABINET_SEAT_IDS = {
  energy: "secretary_of_energy",
  infrastructure: "secretary_of_transportation",
  defense: "secretary_of_defense",
  foreignAffairs: "secretary_of_state",
  tradeMinister: "secretary_of_commerce",
} as const;

/** Military scale multiplier. */
export const US_MILITARY_SCALE = 2.6;

/** Which office assents to regional bills. */
export const US_REGIONAL_BILL_ASSENT_OFFICE_KEY = "governor";

/**
 * Which policy bucket each cabinet seat belongs to, for the cabinet UI.
 *
 * ⚠ THE CAST IS LOAD-BEARING. `CabinetGroup` is a union of bucket names, and
 * JSON.parse widens every one of them to `string`. Without it the object is
 * `Record<string, string>`, which is not assignable to `Record<string, CabinetGroup>`
 * and fails only under `npm run typecheck` -- eslint and the test suite both pass.
 */
export const US_CABINET_GROUPS: Record<string, CabinetGroup> = {
  director_of_intelligence: "Security & Foreign",
  secretary_of_state: "Security & Foreign",
  secretary_of_defense: "Security & Foreign",
  attorney_general: "Security & Foreign",
  secretary_of_homeland: "Security & Foreign",
  secretary_of_treasury: "Economy",
  secretary_of_commerce: "Economy",
  secretary_of_labor: "Economy",
  secretary_of_agriculture: "Economy",
  secretary_of_health: "Society",
  secretary_of_education: "Society",
  secretary_of_hud: "Society",
  secretary_of_veterans: "Society",
  secretary_of_energy: "Domestic",
  secretary_of_interior: "Domestic",
  secretary_of_transportation: "Domestic",
};
