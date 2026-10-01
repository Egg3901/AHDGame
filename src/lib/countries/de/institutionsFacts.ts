import type { Branch } from "@/lib/constants/military";
import type { CabinetGroup } from "@/lib/constants/cabinetPositionGroups";
import type { CountryConfig } from "@/lib/constants/countries";
import type { LegislativeProcess } from "@/lib/legislature/process";
import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";

/**
 * DE's institutions, as pure data.
 *
 * ⚠ GENERATED FROM `__snapshots__/de.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-institutions.ts DE --force
 *
 * ⚠ KEEP THIS FILE FREE OF VALUE IMPORTS. It is the light half of the pair:
 * registries that want one seat id or the legislative process import from HERE,
 * while `institutions.ts` composes these with the cabinet and is heavy. A
 * registry that reads a single string through the heavy module ships the whole
 * cabinet to the browser, which is a regression this work has already shipped
 * once. `clientSafeLeafModules.test.ts` enforces it.
 */

export const DE_CONFIG: CountryConfig = {
  id: "DE",
  seedEconomicModel: {
    "1991": "industrialPowerhouse",
    "2019": "socialMarket",
  },
  name: "Germany",
  flagEmoji: "🇩🇪",
  code: "DE",
  socialAxisBaseline: 0,
  federalEqualizationGrantPerCapita: 500,
  regionLabel: "Land",
  regionLabelPlural: "Länder",
  executiveTitle: "Chancellor",
  governmentType: "parliamentaryRepublic",
  governmentTypeLabel: "Parliamentary Republic",
  discordWebhookNote: "ECB rate decisions (shared with Ireland).",
  coalitionThreshold: 316,
  legislature: {
    name: "Bundestag",
    path: "/country/de/legislature",
    bicameral: false,
    upperChamber: {
      key: "bundesrat",
      name: "Bundesrat",
      shortName: "Bundesrat",
      seats: 69,
      description: "69 members representing the 16 German Länder.",
    },
    lowerChamber: {
      key: "bundestag",
      name: "Bundestag",
      shortName: "Bundestag",
      seats: 630,
      description:
        "630 members elected via mixed-member proportional representation (2023 reform).",
    },
  },
  lowerElectionSystem: {
    termYears: 4,
    seatsContested: "all",
    singleMemberConstituencies: false,
    snapElectionsAllowed: true,
  },
  electionSystems: {
    lowerChamber: "ams",
    subNationalChamber: "pr_sainteLague",
    subNationalExecutive: "fptp",
    headOfGovernment: "parliamentary",
    headOfState: "ceremonial",
  },
  subNationalChamber: {
    key: "landtag",
    name: "Landtag",
    shortName: "Landtag",
    seats: 1901,
    description: "Elected state legislature of each Bundesland.",
    elected: true,
    regionalModel: true,
  },
  regionalBillAssentTitle: "Minister-President",
  officeTypes: [
    {
      key: "chancellor",
      label: "Chancellor",
      labelPlural: "Chancellors",
      isExecutive: true,
      isSubNational: false,
      actionBonus: 4,
      partyStrengthWeight: 1,
    },
    {
      key: "bundestag",
      label: "Member of Bundestag",
      labelPlural: "Members of Bundestag",
      chamberKey: "bundestag",
      isExecutive: false,
      isSubNational: false,
      termYears: 4,
      actionBonus: 1,
      partyStrengthWeight: 0.85,
    },
    {
      key: "ministerPresident",
      label: "Minister-President",
      labelPlural: "Minister-Presidents",
      isExecutive: false,
      isSubNational: true,
      termYears: 5,
      actionBonus: 2,
      partyStrengthWeight: 1,
    },
    {
      key: "landtag",
      label: "Mitglied des Landtags",
      labelPlural: "Mitglieder des Landtags",
      chamberKey: "landtag",
      isExecutive: false,
      isSubNational: true,
      termYears: 5,
      actionBonus: 1,
      partyStrengthWeight: 0.85,
    },
    {
      key: "centralBankChair",
      label: "President of the ECB",
      labelPlural: "Presidents of the ECB",
      isExecutive: false,
      isSubNational: false,
      termYears: 4,
      actionBonus: 3,
      partyStrengthWeight: 0,
    },
  ],
  majorPartyIds: ["spd", "cdu"],
  partyCreationNPPs: {
    statesRequired: 2,
    lockHomeState: false,
    nppsPerState: 1,
  },
  demographicProfileId: "de_archetypes",
  centralBank: {
    name: "European Central Bank",
    abbreviation: "ECB",
    chairTitle: "President of the ECB",
    defaultPrimeRate: 3,
    sharedBankId: "ECB",
    centralBankIntorgId: "EU",
    heroImage: "/api/images/hero/ecb",
  },
  exchangeName: "DAX",
  usdExchangeRate: 1,
  currencyCode: "EUR",
  fiscalYearStartTurnInYear: 40,
  financeMinisterCabinetId: "finance_minister",
  imperialTitles: {
    male: "Bundespräsident",
    female: "Bundespräsidentin",
    nonbinary: "Bundespräsident",
  },
  imperialCorporation: {
    name: "Federal Cultural Foundation",
    sector: "media",
  },
  status: "active",
  tagline:
    "Federal parliamentary republic with mixed-member proportional representation across 16 Länder.",
  descriptor:
    "A federal parliamentary republic where the Chancellor leads government through a Bundestag majority, elected via mixed-member proportional representation.",
  heroImage: "https://flagcdn.com/w640/de.png",
  entryPath: "/country/de",
  overviewPath: "/country/de",
  mapPath: "/country/de/map",
  executivePath: "/country/de/executive",
  executiveLabel: "Federal Chancellery",
  centralGovernmentLabel: "Federal Grants",
};

export const DE_LEGISLATIVE_PROCESS: LegislativeProcess = {
  executive: {
    title: "Federal President",
    canVeto: false,
    signLabel: "Presidential signature",
    signNote:
      "The Federal President signs and promulgates the law, and may decline only on constitutional grounds.",
    override: null,
  },
  upperNote:
    "The Bundesrat represents the Länder. Consent bills require its approval; for objection bills it can be overruled by the Bundestag.",
  dissolution: {
    actor: "Chancellor",
    body: "There is no free dissolution. A constructive vote of no confidence must name a successor Chancellor (Art. 67).",
  },
  quirks: [
    {
      icon: "building",
      title: "Bundesrat consent",
      body: "Bills affecting the Länder need Bundesrat approval; others it may only delay.",
    },
    {
      icon: "users",
      title: "Constructive no-confidence",
      body: "The Chancellor can only be removed by electing a replacement in the same vote.",
    },
    {
      icon: "doc",
      title: "Promulgation",
      body: "The Federal President's signature is largely ceremonial.",
    },
  ],
  seatingStyle: "hemicycle",
};

export const DE_ORDERS_OF_BATTLE: OrderOfBattleEntry[] = [
  {
    branchId: "heer",
    type: "Infantry Division",
    count: 5,
  },
  {
    branchId: "heer",
    type: "Armored Division",
    count: 4,
  },
  {
    branchId: "heer",
    type: "Mechanized Brigade",
    count: 3,
  },
  {
    branchId: "heer",
    type: "Artillery Regiment",
    count: 2,
  },
  {
    branchId: "heer",
    type: "Air Defense Battalion",
    count: 2,
  },
  {
    branchId: "marine",
    type: "Frigate Squadron",
    count: 3,
  },
  {
    branchId: "marine",
    type: "Attack Submarine",
    count: 2,
  },
  {
    branchId: "luftwaffe",
    type: "Fighter Wing",
    count: 4,
  },
  {
    branchId: "luftwaffe",
    type: "Air Defense Wing",
    count: 2,
  },
  {
    branchId: "luftwaffe",
    type: "Airlift Wing",
    count: 1,
  },
];

export const DE_MILITARY_BRANCHES: Branch[] = [
  {
    id: "heer",
    name: "Heer",
    abbr: "Heer",
    domain: "ground",
    establishedYear: 1955,
  },
  {
    id: "marine",
    name: "Marine",
    abbr: "Marine",
    domain: "naval",
    establishedYear: 1955,
  },
  {
    id: "luftwaffe",
    name: "Luftwaffe",
    abbr: "Lw",
    domain: "air",
    establishedYear: 1955,
  },
];

export const DE_ESTATE_PORTFOLIO: Record<string, string> = {
  foreign_minister: "foreign",
  interior_minister: "homeland",
  justice_minister: "justice",
  labour_minister: "labor",
  health_minister: "health",
  education_minister: "education",
  environment_minister: "interior",
  economy_minister: "commerce",
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
export const DE_CABINET_SEAT_IDS = {
  energy: "economy_minister",
  infrastructure: "transport_minister",
  defense: "defense_minister",
  foreignAffairs: "foreign_minister",
  tradeMinister: "economy_minister",
} as const;

/** Military scale multiplier. */
export const DE_MILITARY_SCALE = 1;

/** Which office assents to regional bills. */
export const DE_REGIONAL_BILL_ASSENT_OFFICE_KEY = "ministerPresident";

/**
 * Which policy bucket each cabinet seat belongs to, for the cabinet UI.
 *
 * ⚠ THE CAST IS LOAD-BEARING. `CabinetGroup` is a union of bucket names, and
 * JSON.parse widens every one of them to `string`. Without it the object is
 * `Record<string, string>`, which is not assignable to `Record<string, CabinetGroup>`
 * and fails only under `npm run typecheck` -- eslint and the test suite both pass.
 */
export const DE_CABINET_GROUPS: Record<string, CabinetGroup> = {
  finance_minister: "Economy",
  economy_minister: "Economy",
  labour_minister: "Economy",
  foreign_minister: "Security & Foreign",
  interior_minister: "Security & Foreign",
  defense_minister: "Security & Foreign",
  justice_minister: "Security & Foreign",
  health_minister: "Society",
  education_minister: "Society",
  transport_minister: "Domestic",
  environment_minister: "Domestic",
};
