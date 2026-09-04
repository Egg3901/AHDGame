/**
 * Country configuration for multi-country expansion.
 *
 * Each country defines its complete political structure: legislature names,
 * chamber labels, region terminology, executive title, election system,
 * government type, office definitions, and party/demographic profile IDs.
 *
 * The engine, turn processor, and action systems read from CountryConfig
 * rather than from hardcoded US-specific constants.
 */

import { getCountryFlagUrl } from "./flags";
import type { CorporationType } from "./corporations";
import type { CurrencyCode } from "./currencies";
import {
  DEFAULT_CN_PRIORITY_PROFILE,
  DEFAULT_POLICY_AXIS_EFFECTS,
} from "@/lib/turn/rulingPartyPriorities";
import { CN_POPULAR_MOOD_PROFILE } from "./popularMoodProfiles";
import { RU_NATIONALITIES_SEATS } from "./ruSeats";

import type { EraSeedModels } from "./economicModels";

export type CountryId =
  | "US"
  | "UK"
  | "DE"
  | "JP"
  | "IE"
  | "BR"
  | "CN"
  | "NG"
  | "HU"
  | "PL"
  | "RO"
  | "YU"
  | "BG"
  | "BLR"
  | "UKR"
  | "CS"
  | "BAL"
  | "RU"
  | "FR"
  | "IT"
  | "ES"
  | "SE"
  | "TR"
  | "GR"
  | "AT"
  | "FI"
  | "DD"
  | "SCO"
  | "WAL";

/**
 * Discrete government system enum driving executive / election mechanics.
 * Mirrors the inline union previously declared on {@link CountryConfig.governmentType}.
 * Promoted to a named export so other modules (countryState runtime collection,
 * regime-conversion code paths) can reference it without re-declaring.
 */
export type GovernmentType =
  "presidential" | "parliamentaryMonarchy" | "parliamentaryRepublic" | "onePartyState";
export type CountryStatus = "active" | "beta" | "coming-soon";

export interface ChamberConfig {
  /** Internal key used in APIs, URLs, and BillChamber values */
  key: string;
  /** Display name shown in UI */
  name: string;
  /** Short label for tabs/chips */
  shortName: string;
  /** Total number of seats */
  seats: number;
  /** Description shown to players */
  description: string;
  /** True for elected chambers (US Senate, JP Sangiin); false/omitted for appointed (CA Senate, DE Bundesrat, UK Lords) */
  elected?: boolean;
  /**
   * True only for an upper chamber elected per-region in rotating classes
   * (US Senate: 2 per state across 3 classes, keyed by `SENATE_CLASSES`). Drives
   * the region seat appointer's "classed upper" group. JP Sangiin / BR Senate set
   * `staggeredClasses` on their election system but are NOT region-appointable here
   * and have no per-region class data, so they intentionally omit this flag.
   */
  regionElectedClasses?: boolean;
  /**
   * True when this sub-national tier uses the "regional" governance model:
   * player-facing copy says "Regional" (not "State") and the tier has a regional
   * budget / fiscal layer (regionalBudgets). UK/DE/JP/IE/CN set this; the US omits
   * it (US uses the "State" model with no regional budget). Only meaningful on
   * `subNationalChamber`.
   */
  regionalModel?: boolean;
}

export interface LegislatureConfig {
  /** Display name for the legislature as a whole (e.g. "Congress", "Parliament") */
  name: string;
  /** Upper chamber config — omitted for genuinely unicameral legislatures
   *  (Scotland's Holyrood, the Senedd). Consumers must tolerate `undefined`. */
  upperChamber?: ChamberConfig;
  /** Lower chamber config */
  lowerChamber: ChamberConfig;
  /** Nav link path (e.g. "/congress") */
  path: string;
  /**
   * True when both chambers participate in the player legislative loop
   * (bills require passage in both). False for systems where the upper
   * chamber is appointed / observer-only and doesn't vote on bills as
   * part of normal gameplay — UK Lords (appointed), DE Bundesrat
   * (delegated by Land governments). Used by bill UI to hide bicameral
   * tally tabs and second-chamber/executive-override sections.
   */
  bicameral: boolean;
}

/**
 * Configuration for one type of office within a country.
 * Drives action bonuses, party-strength weights, and achievement triggers.
 */
export interface OfficeTypeConfig {
  /** Matches Character.currentOffice.type and ElectedOfficial.officeType */
  key: string;
  /** Human-readable label (e.g. "Member of Parliament", "Senator") */
  label: string;
  /** Plural label for listings */
  labelPlural: string;
  /** Which chamber key this office maps to, if any */
  chamberKey?: string;
  /** True for President, Prime Minister, etc. */
  isExecutive: boolean;
  /**
   * True for the ceremonial head of state in non-monarchy systems
   * (e.g. CN President of the PRC = CCP chair, IE Uachtarán). Monarchies
   * (parliamentaryMonarchy) render their head of state via the imperial-character
   * system instead, so they do not set this.
   */
  isHeadOfState?: boolean;
  /** True for Governor, State Senator, devolved assembly members, etc. */
  isSubNational: boolean;
  /** Term length in years (undefined = no fixed term, e.g. PM in parliamentary system) */
  termYears?: number;
  /**
   * Extra actions granted per turn while holding this office.
   * Supplements GameConfig.officeActionBonus; the config value is the authoritative source
   * but this is used for display and validation.
   */
  actionBonus: number;
  /**
   * Multiplier applied to the turn vote pool to reflect incumbency / executive power.
   * Replaces the hardcoded PARTY_STRENGTH_BY_OFFICE map in electionEngine.ts.
   */
  partyStrengthWeight: number;
}

/** Vote-to-seat/office allocation method for one political position.
 *  See docs/superpowers/specs/2026-06-27-election-systems-field-design.md. */
export type ElectionMethod =
  | "fptp" // single-seat plurality
  | "pr_hareQuota" // multi-seat Largest Remainder (Hare quota)
  | "pr_sainteLague" // odd-divisor proportional (DE Landtag)
  | "ams" // additional-member system (DE Bundestag)
  | "electoralCollege" // per-unit FPTP aggregated to a majority (US President)
  | "parliamentary" // head of gov via coalition/confidence vote (no popular ballot)
  | "ceremonial"; // head of state not contested in-system (monarch / appointed)

/** Political positions whose election method a country can configure. */
export type ElectionPosition =
  | "lowerChamber"
  | "upperChamber"
  | "subNationalChamber"
  | "subNationalExecutive"
  | "headOfGovernment"
  | "headOfState";

/**
 * Electoral system definition for one chamber.
 */
export interface ElectionSystemConfig {
  /** How many years between elections (undefined = variable, e.g. parliamentary dissolution) */
  termYears?: number;
  /** Whether all seats are up in each cycle or only a fraction */
  seatsContested: "all" | "partial";
  /** For staggered systems (US Senate): number of classes */
  staggeredClasses?: number;
  /** Whether each constituency elects exactly one winner */
  singleMemberConstituencies: boolean;
  /** UK: can elections be called early by the government */
  snapElectionsAllowed: boolean;
}

export interface CentralBankConfig {
  /** Full name (e.g. "Federal Reserve") */
  name: string;
  /** Short abbreviation (e.g. "Fed") */
  abbreviation: string;
  /** Title of the bank's leader (e.g. "Federal Reserve Chair") */
  chairTitle: string;
  /** Default prime rate when the bank document is first created */
  defaultPrimeRate: number;
  /** Hero image path for the central bank page */
  heroImage?: string;
  /** Alt text for the hero image */
  heroAlt?: string;
  /**
   * When set, multiple countries share one central bank document keyed by this
   * ID instead of countryId. Used for supranational institutions like the ECB,
   * where all Eurozone members share a single bank, prime rate, and chair.
   *
   * Example: all EU countries set `sharedBankId: "ECB"`. Queries resolve the
   * bank document as `{ _id: sharedBankId }` rather than `{ _id: countryId }`.
   */
  sharedBankId?: string;
  /**
   * When set, chair selection and nominations are governed by this international
   * organization rather than a single country executive.
   */
  centralBankIntorgId?: string;
}

export interface CountryConfig {
  id: CountryId;
  name: string;
  flagEmoji: string;
  /** ISO 3166-1 alpha-2 code */
  code: string;

  /** Economic-model identity a fresh game starts with (P7), per start-date era,
   *  before enough play has accrued to move the classification. */
  seedEconomicModel?: EraSeedModels;

  // ── Region terminology ─────────────────────────────────────────────────────
  /** What sub-national divisions are called (e.g. "State", "Nation", "Constituency") */
  regionLabel: string;
  /** Plural form of regionLabel */
  regionLabelPlural: string;

  // ── Executive ──────────────────────────────────────────────────────────────
  /** Title of head of government (e.g. "President", "Prime Minister") */
  executiveTitle: string;
  /**
   * Title of head of state (may differ from executive, e.g. "Monarch").
   * Optional — when unset, {@link getHeadOfStateTitle} returns a
   * governmentType-derived default ("President" for presidential /
   * parliamentaryRepublic / onePartyState, "Monarch" for
   * parliamentaryMonarchy). Set explicitly only when a country uses a
   * culturally-specific term (e.g. JP "Emperor").
   */
  headOfStateTitle?: string;
  /**
   * Optional phrase for titles like "President of …" / "Prime Minister of …".
   * When set (e.g. "the United States"), overrides {@link name} for that wording.
   */
  executiveRealmPhrase?: string;
  /**
   * "presidential": executive directly elected; term is fixed.
   * "parliamentaryMonarchy": parliamentary system under a constitutional
   *   monarch (UK, JP). Executive emerges from legislative majority; head of
   *   state is a ceremonial monarch.
   * "parliamentaryRepublic": parliamentary system with a ceremonial president
   *   (DE, IE). Executive emerges from legislative majority; head of state is
   *   a non-executive president.
   * "onePartyState": single dominant party; executive emerges from internal
   *   party confidence. Mechanically follows the parliamentary code paths for
   *   now via {@link isParliamentarySystem}; will diverge as the one-party
   *   subsystem is fleshed out.
   */
  governmentType: GovernmentType;
  /**
   * Display label for the regime classification shown on the country overview
   * page (e.g. "Presidential Republic", "Constitutional Monarchy", "Parliamentary
   * Republic", "One Party State"). Distinct from {@link governmentType}, which
   * is a low-level gameplay enum driving executive/election mechanics.
   */
  governmentTypeLabel: string;
  /**
   * Optional country-specific tail appended to this country's Discord webhook
   * description in Admin Panel > System > Integrations. Carries only what
   * cannot be derived (shared central banks, unusual institutions). Omit when
   * the generated sentence is sufficient.
   */
  discordWebhookNote?: string;
  /**
   * Phase 5.5: whether the Campaign Manager system extends to non-presidential
   * races (senate, governor, house, state senate) in this country. Defaults to
   * `false`; set to `true` only after the country's campaign-finance model has
   * been audited and adapted to fit the per-candidate fundraising loop. UK
   * statutory expense limits, JP mixed FPTP/PR, DE party-list PR, and IE STV
   * all need separate audit + adaptation before flipping this flag (Phase 5.5
   * D4). Presidential races stay gated on `isDirectElection(config)` only —
   * that path is unchanged from pre-Phase-5.5.
   */
  campaignManagerNonPresidentialEnabled?: boolean;
  /**
   * Minimum seats for an outright majority in the lower chamber.
   * US House: 218. UK Commons: 326.
   * Used by the government formation resolver.
   */
  coalitionThreshold: number;
  /**
   * Whether the governing party can trigger a snap election mid-term.
   * Optional — when unset, falls back to the governmentType-derived default
   * returned by {@link supportsSnapElections} (parliamentary systems → `true`,
   * presidential / one-party → `false`). Set explicitly only when a country
   * needs to diverge from its regime-type default. Distinct from the
   * per-chamber {@link ElectionSystemConfig.snapElectionsAllowed} field, which
   * controls whether an individual chamber can be dissolved.
   */
  snapElectionsAllowed?: boolean;
  /**
   * Whether a vote of no confidence can collapse the government. Optional —
   * when unset, falls back to the governmentType-derived default returned by
   * {@link hasConfidenceVoteMechanism} (parliamentary systems → `true`,
   * presidential / one-party → `false`). Set explicitly only when a country
   * needs to diverge from its regime-type default.
   */
  confidenceVoteMechanism?: boolean;
  /**
   * Chamber keys whose seated members are eligible for direct cabinet
   * appointment in parliamentary-style systems. Optional — when unset,
   * {@link getCabinetEligibleChamberKeys} returns `[]` for presidential
   * countries (no parliamentary cabinet concept) and
   * `[legislature.lowerChamber.key]` for parliamentary-style countries.
   * Set explicitly only when a country diverges from the lower-chamber
   * default (e.g. JP includes both chambers).
   */
  cabinetEligibleChamberKeys?: string[];

  // ── Legislature ────────────────────────────────────────────────────────────
  legislature: LegislatureConfig;

  // ── Electoral systems ──────────────────────────────────────────────────────
  /** Electoral rules for the lower (elected) chamber */
  lowerElectionSystem: ElectionSystemConfig;
  /** Electoral rules for the upper chamber (may be "appointed" etc.) */
  upperElectionSystem?: ElectionSystemConfig;
  /**
   * Allocation/selection method per political position. Config holds the
   * DEFAULT; a future in-game layer may override per game. Positions a country
   * lacks are omitted. Single source of truth for "method" — read via
   * {@link ../elections/electionMethod getElectionMethod}.
   */
  electionSystems: Partial<Record<ElectionPosition, ElectionMethod>>;

  // ── Offices ────────────────────────────────────────────────────────────────
  /**
   * All office types that exist in this country.
   * Drives action bonuses, party-strength weights, and achievement triggers.
   * US: president, vicePresident, senate, house, governor, stateSenate.
   * UK: primeMinister, commons, regionalCouncil.
   */
  officeTypes: OfficeTypeConfig[];

  /**
   * Optional sub-national chamber for countries with elected regional bodies.
   * UK: Regional Councils elected within each nation/region.
   */
  subNationalChamber?: ChamberConfig;

  /**
   * Short UI title for the regional chief executive who assents to sub-national legislation.
   * When omitted, {@link getRegionalBillAssentTitle} uses the country's sub-national executive
   * office type (Governor, Premier, Minister-President, etc.).
   */
  regionalBillAssentTitle?: string;

  // ── Parties ────────────────────────────────────────────────────────────────
  /**
   * Party IDs considered "major" for FPTP spoiler modelling at the national level.
   * UK: overridden per-region (see getMajorPartiesForRegion).
   * US: ["democrat", "republican"]
   */
  majorPartyIds: string[];

  /**
   * Configuration for third party creation NPP spawning.
   * - statesRequired: number of regions the creator must select
   * - lockHomeState: whether the creator's home state is auto-included and locked
   * - nppsPerState: number of NPPs spawned per selected region
   *
   * US: 4 states + locked home = 5 states × 2 NPPs = 10 NPPs
   * UK: 2 regions (no locked home) × 1 NPP = 2 NPPs
   */
  partyCreationNPPs: {
    statesRequired: number;
    lockHomeState: boolean;
    nppsPerState: number;
  };

  /**
   * Optional per-country overrides for party leadership / committee labels.
   * Keys map to the generic NationalPosition labels plus the party committee
   * concept. Any key left undefined falls back to the default English label
   * (see getPartyRoleLabel). Used to localize e.g. the CCP's "Chair" →
   * "General Secretary" and "Committee" → "Secretariat" for CN only.
   */
  partyRoleLabels?: {
    chair?: string;
    viceChair?: string;
    treasurer?: string;
    committee?: string;
  };

  // ── Demographics ───────────────────────────────────────────────────────────
  /**
   * ID of the demographic profile used for voter archetypes in this country.
   * Corresponds to a set of DemographicCategory documents in the DB.
   * US: "us_archetypes" (12 voterGroups)
   * UK: "uk_archetypes" (12 UK-specific voterGroups)
   */
  demographicProfileId: string;

  /**
   * Optional executive term-limit rule for this country.
   * Applies to the configured executive office holder, not to the player account.
   */
  executiveTermLimit?: {
    officeKey: string;
    maxTermsPerCharacter: number;
    blocksRunningMateSelection: boolean;
  };

  /**
   * Country has an internal-party leader confidence model (e.g. CN's CPC
   * confidence). When true, leader transitions write to countryLeaderStates
   * and the turn pipeline drives drift via processRulingPartyConfidenceTurn().
   */
  hasLeaderConfidenceModel?: boolean;

  /**
   * Seed baseline for the country's social-axis position (−5 libertarian …
   * +5 authoritarian; matches demographic socialLean and legislation-option
   * `social` scales). Copied onto CountryState at seed time; the runtime
   * value then drifts toward the social stance of enacted national laws
   * (socialAxisDrift turn phase). Omitted ⇒ 0 (mid). First-pass values from
   * the P6 design.
   */
  socialAxisBaseline?: number;

  /**
   * Seed-time pointer to the party that should be marked
   * `regimeStatus: "ruling"` when this country is first seeded. Only
   * meaningful when `governmentType === "onePartyState"`. Authoritative at
   * runtime is the `PoliticalParty.regimeStatus` field, not this pointer.
   *
   * Type matches `PoliticalParty.sequentialId` (number).
   */
  rulingPartyId?: number;

  /**
   * Public-mood axis weights driving the per-turn `popularLegitimacy`
   * drift. Only meaningful when `hasLeaderConfidenceModel === true` —
   * the per-turn driver short-circuits with `null` when this field is
   * absent. See `src/lib/constants/popularMoodProfiles.ts` for the
   * shape and CN seed value.
   */
  popularMoodProfile?: import("./popularMoodProfiles").PopularMoodAxisProfile;

  /**
   * Player-facing name for the spinoff party created when Stage 3
   * (internal challenge) fires the auto-faction-split. Only meaningful
   * for one-party-state countries; missing field → no faction split
   * fires (the regime still transitions to Stage 3, but only the
   * decision-event side runs without spawning a new party).
   *
   * Phase 4 only — the richer faction subsystem on
   * `feature/legislation-update-cn` will supersede this with per-axis
   * caucus structure later.
   */
  factionDefectionName?: string;

  /**
   * Ruling-party priority profile (9-axis ideology weights). Only meaningful
   * when `governmentType === "onePartyState"`. Drives per-turn confidence
   * drift in `processRulingPartyConfidenceTurn`. Use the shape from
   * `RulingPartyPriorityProfile` in `@/lib/turn/rulingPartyPriorities`.
   */
  priorityProfile?: import("@/lib/turn/rulingPartyPriorities").RulingPartyPriorityProfile;

  /**
   * Per-country policy-category → axis-effect map. Each enacted bill's
   * `category` is looked up here to derive axis deltas that fold into
   * ruling-party confidence drift. Only meaningful when
   * `governmentType === "onePartyState"`.
   */
  policyAxisEffects?: Record<
    string,
    Array<import("@/lib/turn/rulingPartyPriorities").PolicyAxisEffect>
  >;

  /**
   * Two-source regional-budget knobs for one-party states with a
   * CN-style "local tax retention + central transfer grant" model.
   * Read by `processCNRegionalBudgets` so a future second one-party
   * country with the same shape can populate this and pick up the
   * processor without code changes.
   */
  onePartyRegionalBudget?: {
    /** Share of the per-region tax that stays local (CN: 0.40 for EIT). */
    localTaxRetentionShare: number;
    /** Corporate profits as a fraction of regional GDP (CN: 0.06). */
    corporateProfitRatio: number;
    /** Default central transfer pool per capita (local currency / year). */
    centralTransferPerCapita: number;
    /** Fallback tax rate (%) when the primary tax has not been enacted. */
    defaultTaxRate: number;
    /** legislationTypeId of the primary regional tax (CN: cn_enterprise_income_tax). */
    primaryTaxLegislationKey: string;
    /**
     * legislationTypeId of an optional per-region resource tax. When set, the
     * processor reads each region's enacted policy rate and feeds it into the
     * resource-tax revenue stream (analogous to DE's Hebesatz/tradeTaxRevenue).
     * CN: cn_provincial_resource_tax. Omit on countries with no resource tax.
     */
    resourceTaxLegislationKey?: string;
    /**
     * Resource-extraction (mining, oil/gas, water, salt) as a fraction of
     * regional GDP. Used as the base for resource-tax revenue. Omit (or set
     * 0) when the country has no resource tax. CN: 0.03 nation-wide proxy.
     */
    resourceExtractionRatio?: number;
    /**
     * Consumption base as a fraction of regional GDP for the standing Business
     * Tax (营业税) — the dominant 1991 Chinese local tax. CN: 0.50 (derived from
     * the national sales-tax implied base). Omit when the country has no
     * standing regional consumption tax.
     */
    businessTaxConsumptionRatio?: number;
    /** Standing Business Tax rate (percent). CN: 24. Omit (or 0) for none. */
    businessTaxRate?: number;
  };

  /**
   * DE's federal fiscal-equalization pool (Länderfinanzausgleich /
   * Bundesergänzungszuweisungen) — the per-capita currency figure
   * `processDERegionalBudgets` (src/lib/turn/deRegionalBudget.ts) uses as the
   * default even split of the national grant pool when a Land has no explicit
   * Finance Minister allocation. Kept as its own top-level field (rather than
   * folded into `onePartyRegionalBudget`) because DE is not a one-party state
   * and that shape doesn't fit. Era-scaled via `ERA_COUNTRY_CONFIG_OVERRIDES`
   * the same way CN's `centralTransferPerCapita` is — see the 1953 entry.
   */
  federalEqualizationGrantPerCapita?: number;

  /**
   * Per-regime vote-weight multipliers for legislative general elections.
   * Only consulted when `governmentType === "onePartyState"`. Defaults to
   * `DEFAULT_OPS_VOTE_MULTIPLIERS` when absent.
   */
  opsVoteMultipliers?: OpsVoteMultipliers;

  /**
   * How a one-party state's ceremonial head of state is seated.
   * - "partyChairSync": auto-reconciled every turn to the ruling party's
   *   chairId (CN President — partyChairHeadOfState.ts).
   * - "legislatureAppointment": elected by the seated legislature through
   *   an appointment vote mirroring the PM flow (RU Chairman of the
   *   Presidium).
   * Only meaningful when `governmentType === "onePartyState"`. Omitted →
   * the country has no synced/appointed ceremonial head of state.
   */
  headOfStateSelection?: "partyChairSync" | "legislatureAppointment";

  // ── Phase-6 collapse / convention ────────────────────────────────────────
  /**
   * Default `governmentType` the country falls into when a Stage-4 forced
   * conversion fires without a convention's negotiated target. Only
   * meaningful on one-party-state countries.
   */
  collapseTargetSystem?: GovernmentType;

  /**
   * Government types the player is allowed to pick when drafting a
   * constitutional convention. Defaults to `[collapseTargetSystem]` when
   * omitted. Excludes `onePartyState` — conversion is one-way.
   */
  collapseTargetAllowlist?: GovernmentType[];

  /**
   * Legacy seat reservation (% of post-conversion legislature) granted to
   * the former ruling party on a voluntary convention path. Range 0..35.
   * The Stage-4 forced path always uses 5% regardless of this default
   * (and halves it to 3% when `stage4Delay.halveLegacyBonusIfStillBelow15`
   * was set by a "resist" decision).
   */
  legacyReservationDefault?: number;

  /**
   * Default delay (turns) between the convention's ratification phase
   * and the snap election. Convention draft can override per submission;
   * the runtime constraint is `{ 12, 24, 48 }`.
   */
  electionDelayDefault?: number;

  /**
   * Optional map-mode overlay this country exposes beyond the default
   * lean/approval layers. Currently "partyOrg" is the only value (CN's
   * per-region party organization heatmap).
   */
  mapOverlay?: "partyOrg";

  // ── Central Bank ──────────────────────────────────────────────────────────
  centralBank: CentralBankConfig;

  // ── Stock Exchange ─────────────────────────────────────────────────────────
  /** Display name of the country's stock exchange (e.g. "NYSE", "FTSE", "Nikkei") */
  exchangeName?: string;
  /**
   * What kind of listing venue `exchangeName` names. "market" (the default) is a
   * tradable stock exchange. "stateRegister" is a command economy's enterprise
   * register: state-owned enterprises are recorded there, but no shares change
   * hands. The distinction exists so planned economies get a listing venue of
   * their own instead of falling through to whichever exchange was the fallback.
   */
  exchangeKind?: "market" | "stateRegister";

  // ── Currency ───────────────────────────────────────────────────────────────
  /** Multiplier to convert GDP millions stored in local currency to USD millions.
   *  US/UK/CA/DE seed GDP in USD-equivalent so this is 1.0.
   *  JP seeds GDP in JPY millions — 2020 avg rate: 1 JPY = $0.00943 USD.
   */
  usdExchangeRate: number;
  /** ISO 4217 currency code for this country's home currency */
  currencyCode: CurrencyCode;

  /**
   * Turn in the 48-turn year when the next fiscal year begins.
   * This keeps fiscal-calendar rules config-driven instead of burying them in
   * budget or turn modules as more countries grow bespoke finance behavior.
   */
  fiscalYearStartTurnInYear: number;

  // ── Cabinet Bills ──────────────────────────────────────────────────────────
  /** Whether this country supports cabinet-origin bills (JP feature). Default false. */
  cabinetBillsEnabled?: boolean;

  // ── FX Intervention ────────────────────────────────────────────────────────
  /** Cabinet seat ID authorized to transfer funds from the federal budget to the
   *  central bank's FX reserve. Resolved against the country's cabinet registry.
   *  Leave unset to disable the FX Reserve Transfer action for that country. */
  financeMinisterCabinetId?: string;

  // ── UI / Navigation ────────────────────────────────────────────────────────
  status: CountryStatus;
  /** Short description shown on the world map */
  tagline: string;
  /**
   * One-sentence blurb displayed on the country overview page.
   * Should describe the political system concisely for new players.
   */
  descriptor: string;
  /** Path to a hero/banner image for the country card */
  heroImage?: string;
  /**
   * Optional wider hero for the country overview page only.
   * When set, `heroImage` is still used for world cards and the overview header flag thumbnail.
   */
  overviewHeroImage?: string;
  /** Route players navigate to when selecting this country (entry/play page) */
  entryPath: string;
  /** Route for the country overview page — defaults to entryPath if not set */
  overviewPath: string;
  /**
   * Path to the country's interactive map subpage.
   * US: "/country/us/map" (state-level approval heatmap)
   * UK: "/country/uk/map" (region clickthrough map)
   */
  mapPath: string;
  /**
   * Path to the country's executive/government page.
   * US: "/country/us/executive" (White House)
   * UK: "/country/uk/executive" (PM + Cabinet)
   */
  executivePath: string;
  /** Display name for the executive residence / seat of government (e.g. "White House", "10 Downing Street") */
  executiveLabel: string;
  /** Label for central government funding to regions (e.g. "Federal Grants", "Westminster Funding") */
  centralGovernmentLabel: string;

  // ── Imperial ──────────────────────────────────────────────────────────────
  /**
   * Whether this country has a ceremonial imperial head of state. Optional —
   * when unset, {@link isImperialCountry} returns the governmentType-derived
   * default: `true` for `parliamentaryMonarchy` (UK monarch, JP emperor),
   * `false` otherwise. Set explicitly to override (e.g. DE's
   * parliamentaryRepublic configures `true` for the ceremonial
   * Bundespräsident; IE leaves it unset so it inherits `false`).
   */
  hasImperialRole?: boolean;
  /** Gender-aware titles for the imperial head of state */
  imperialTitles?: {
    male: string;
    female: string;
    nonbinary: string;
  };
  /**
   * Gender-aware possessive prefix for government/cabinet labels.
   * UK: "His Majesty's" / "Her Majesty's" / "The Monarch's"
   * Only relevant for countries whose government labels include the head of state's style.
   */
  imperialPossessives?: {
    male: string;
    female: string;
    nonbinary: string;
  };
  /** Starter corporation config for imperial character creation */
  imperialCorporation?: {
    name: string;
    sector: CorporationType;
  };
  /**
   * If set, this country shares another country's imperial character
   * (e.g., CA shares UK's monarch). The value is the source CountryId.
   */
  imperialSharedWith?: CountryId;

  /**
   * When true, players in this country cannot found private corporations.
   * Used for command-economy states (USSR, East Germany) where private
   * enterprise is constitutionally prohibited. The server-side POST
   * /api/corporations guard rejects the request; the UI hides the
   * "Found Corp" button.
   */
  disallowPrivateCorporationFounding?: boolean;
}

export const COUNTRY_CONFIGS: Record<CountryId, CountryConfig> = {
  US: {
    id: "US",
    seedEconomicModel: { "1991": "militaryIndustrial", "2019": "techInnovation" },
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
    campaignManagerNonPresidentialEnabled: true, // Phase 5.5 D2 - US senate/gov/house/stateSenate
    coalitionThreshold: 218, // House majority

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
      headOfState: "electoralCollege", // President fuses head of state + head of government
    },

    subNationalChamber: {
      key: "stateSenate",
      name: "State Senate",
      shortName: "State Senate",
      seats: 1972, // sum of STATE_SENATE_SEATS across the 50 states (informational)
      description: "Each state's elected legislature, which sets state law and budgets.",
      elected: true,
      // No regionalModel: the US uses the "State" model (not "Regional") and has no
      // regional budget layer.
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
        partyStrengthWeight: 1.0,
      },
      {
        key: "vicePresident",
        label: "Vice President",
        labelPlural: "Vice Presidents",
        isExecutive: true,
        isSubNational: false,
        termYears: 4,
        actionBonus: 2,
        partyStrengthWeight: 1.0,
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
        partyStrengthWeight: 1.0,
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
    partyCreationNPPs: { statesRequired: 4, lockHomeState: true, nppsPerState: 2 },
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
      defaultPrimeRate: 3.0,
      heroImage: "/api/images/hero/federal-reserve",
      heroAlt: "Marriner S. Eccles Federal Reserve Board Building, Washington D.C.",
    },

    exchangeName: "NYSE",
    usdExchangeRate: 1.0,
    currencyCode: "USD",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "secretary_of_treasury",

    status: "active",
    tagline:
      "The original simulation - all 50 states, a bicameral Congress, and a presidential executive.",
    descriptor:
      "A federal presidential republic with 50 states, a bicameral Congress, and a directly elected President who serves as both head of state and government.",
    heroImage: getCountryFlagUrl("US"),
    overviewHeroImage: "/api/images/hero/us-overview-mount-rushmore",
    entryPath: "/dashboard",
    overviewPath: "/country/us",
    mapPath: "/country/us/map",
    executivePath: "/country/us/executive",
    executiveLabel: "White House",
    centralGovernmentLabel: "Federal Grants",
  },

  UK: {
    id: "UK",
    seedEconomicModel: { "1991": "financialized", "2019": "financialized" },
    name: "United Kingdom",
    flagEmoji: "🇬🇧",
    code: "GB",
    socialAxisBaseline: -1.5,

    regionLabel: "Nation",
    regionLabelPlural: "Nations & Regions",

    executiveTitle: "Prime Minister",
    executiveRealmPhrase: "the United Kingdom",
    governmentType: "parliamentaryMonarchy",
    governmentTypeLabel: "Constitutional Monarchy",
    coalitionThreshold: 326, // Commons majority (650 seats / 2 + 1)

    legislature: {
      name: "Parliament",
      path: "/country/uk/legislature",
      // Lords is appointed, not part of the player legislative loop.
      bicameral: false,
      upperChamber: {
        key: "lords",
        name: "House of Lords",
        shortName: "Lords",
        seats: 784,
        description: "Appointed and hereditary peers. Revises and scrutinises legislation.",
      },
      lowerChamber: {
        key: "commons",
        name: "House of Commons",
        shortName: "Commons",
        seats: 650,
        description:
          "650 elected MPs from single-member constituencies. The primary legislative chamber.",
      },
    },

    lowerElectionSystem: {
      // termYears is variable in parliamentary systems; 5-year maximum
      termYears: 5,
      seatsContested: "all",
      singleMemberConstituencies: true,
      snapElectionsAllowed: true,
    },
    // Lords are not elected
    upperElectionSystem: undefined,
    electionSystems: {
      lowerChamber: "pr_hareQuota",
      subNationalChamber: "pr_hareQuota",
      headOfGovernment: "parliamentary",
      headOfState: "ceremonial", // monarch
    },

    subNationalChamber: {
      key: "regionalCouncil",
      name: "Regional Council",
      shortName: "Regional Council",
      seats: 364,
      description:
        "Elected regional councillors representing UK nations and regions on staggered five-year terms.",
      regionalModel: true,
    },

    regionalBillAssentTitle: "First Minister",

    officeTypes: [
      {
        key: "primeMinister",
        label: "Prime Minister",
        labelPlural: "Prime Ministers",
        isExecutive: true,
        isSubNational: false,
        actionBonus: 4,
        partyStrengthWeight: 1.0,
      },
      {
        key: "commons",
        label: "Member of Parliament",
        labelPlural: "Members of Parliament",
        chamberKey: "commons",
        isExecutive: false,
        isSubNational: false,
        termYears: 5,
        actionBonus: 1,
        partyStrengthWeight: 0.85,
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
        // UK devolved chief executive — single-seat per devolved region. Recycles
        // the cross-country `governor` office key so the existing election cycle
        // (CYCLE_TURNS.governor = 192 turns / 4 yr), action-refresh bonus, and
        // bill-assent flow apply unchanged. Display labels diverge by region:
        // First Minister for SCO / WAL / NIR, Mayor of London for LON, and
        // null (no chip) for English non-London regions — resolved by
        // `getRegionalExecutive` (regionalExecutive.ts) at read time.
        key: "governor",
        label: "First Minister",
        labelPlural: "First Ministers",
        isExecutive: false,
        isSubNational: true,
        termYears: 4,
        actionBonus: 2,
        partyStrengthWeight: 1.0,
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

    /**
     * UK major parties vary by region; this is the England/national fallback.
     * getMajorPartiesForRegion() overrides this per nation.
     */
    majorPartyIds: ["LAB", "CON"],
    partyCreationNPPs: { statesRequired: 2, lockHomeState: false, nppsPerState: 1 },
    demographicProfileId: "uk_archetypes",

    centralBank: {
      name: "Bank of England",
      abbreviation: "BoE",
      chairTitle: "Governor of the Bank of England",
      defaultPrimeRate: 3.0,
      heroImage: "/api/images/hero/bank-of-england",
      heroAlt: "Bank of England, Threadneedle Street, London",
    },

    exchangeName: "FTSE",
    usdExchangeRate: 1.0,
    currencyCode: "GBP",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "chancellor",

    status: "active",
    tagline:
      "Westminster parliamentary democracy - 650 constituencies, First Minister elections, and a Prime Minister.",
    descriptor:
      "A constitutional monarchy and parliamentary democracy across four nations, where the Prime Minister leads the government through a majority in the 650-seat House of Commons.",
    heroImage: getCountryFlagUrl("GB"),
    entryPath: "/country/uk",
    overviewPath: "/country/uk",
    mapPath: "/country/uk/map",
    executivePath: "/country/uk/executive",
    executiveLabel: "10 Downing Street",
    centralGovernmentLabel: "Westminster Funding",
    imperialTitles: {
      male: "King",
      female: "Queen",
      nonbinary: "Monarch",
    },
    imperialPossessives: {
      male: "His Majesty's",
      female: "Her Majesty's",
      nonbinary: "The Monarch's",
    },
    imperialCorporation: {
      name: "Royal Estate",
      sector: "real_estate",
    },
  },
  DE: {
    id: "DE",
    seedEconomicModel: { "1991": "industrialPowerhouse", "2019": "socialMarket" },
    name: "Germany",
    flagEmoji: "🇩🇪",
    code: "DE",
    socialAxisBaseline: 0,
    // Matches the module default in deRegionalBudget.ts (DEFAULT_FEDERAL_GRANT_PER_CAPITA).
    // The 1953-default preset overrides this — see ERA_COUNTRY_CONFIG_OVERRIDES.
    federalEqualizationGrantPerCapita: 500,

    regionLabel: "Land",
    regionLabelPlural: "Länder",

    executiveTitle: "Chancellor",
    governmentType: "parliamentaryRepublic",
    governmentTypeLabel: "Parliamentary Republic",
    discordWebhookNote: "ECB rate decisions (shared with Ireland).",
    coalitionThreshold: 316, // Bundestag majority (630 seats / 2 + 1 under 2023 reform, fixed)

    legislature: {
      name: "Bundestag",
      path: "/country/de/legislature",
      // Bundesrat is appointed by Land governments, not part of the player legislative loop.
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
    upperElectionSystem: undefined, // Bundesrat members appointed by state governments
    electionSystems: {
      lowerChamber: "ams", // Bundestag (Additional Member System / MMP)
      subNationalChamber: "pr_sainteLague", // Landtag
      subNationalExecutive: "fptp", // Minister-President — TODO: revisit (Landtag-elected in RL)
      headOfGovernment: "parliamentary", // Chancellor
      headOfState: "ceremonial", // Bundespräsident
    },

    subNationalChamber: {
      key: "landtag",
      name: "Landtag",
      shortName: "Landtag",
      seats: 1901, // sum of stateSenateSeats across the 16 Länder
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
        partyStrengthWeight: 1.0,
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
        partyStrengthWeight: 1.0,
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
    partyCreationNPPs: { statesRequired: 2, lockHomeState: false, nppsPerState: 1 },
    demographicProfileId: "de_archetypes",

    centralBank: {
      name: "European Central Bank",
      abbreviation: "ECB",
      chairTitle: "President of the ECB",
      defaultPrimeRate: 3.0,
      sharedBankId: "ECB",
      centralBankIntorgId: "EU",
      heroImage: "/api/images/hero/ecb",
    },

    exchangeName: "DAX",
    usdExchangeRate: 1.0,
    currencyCode: "EUR",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "finance_minister",

    // Imperial role inherited from the parliamentaryRepublic default (false)
    // via isImperialCountry(). The Bundespräsident titles/corporation below
    // are retained for downstream lookups (`getImperialTitle("DE", ...)`)
    // but DE is no longer surfaced through the imperial-character creation
    // flow.
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
    heroImage: getCountryFlagUrl("DE"),
    entryPath: "/country/de",
    overviewPath: "/country/de",
    mapPath: "/country/de/map",
    executivePath: "/country/de/executive",
    executiveLabel: "Federal Chancellery",
    centralGovernmentLabel: "Federal Grants",
  },
  JP: {
    id: "JP",
    seedEconomicModel: { "1991": "industrialPowerhouse", "2019": "industrialPowerhouse" },
    name: "Japan",
    flagEmoji: "🇯🇵",
    code: "JP",
    socialAxisBaseline: 0,

    regionLabel: "Region",
    regionLabelPlural: "Regions",

    executiveTitle: "Prime Minister",
    headOfStateTitle: "Emperor",
    executiveRealmPhrase: "Japan",
    governmentType: "parliamentaryMonarchy",
    governmentTypeLabel: "Constitutional Monarchy",
    coalitionThreshold: 233, // House of Representatives majority (465 seats / 2 + 1)
    cabinetEligibleChamberKeys: ["shugiin", "sangiin"],

    legislature: {
      name: "Kokkai",
      path: "/country/jp/legislature",
      bicameral: true,
      upperChamber: {
        key: "sangiin",
        name: "Sangiin",
        shortName: "Sangiin",
        seats: 248,
        description:
          "248 councillors elected on staggered 6-year terms. Half are contested every 3 years. Cannot be dissolved.",
        elected: true,
      },
      lowerChamber: {
        key: "shugiin",
        name: "Shūgiin",
        shortName: "Shūgiin",
        seats: 465,
        description:
          "465 members elected by FPTP from regional constituencies. Invests confidence in the Cabinet.",
      },
    },

    lowerElectionSystem: {
      termYears: 4,
      seatsContested: "all",
      singleMemberConstituencies: true,
      snapElectionsAllowed: true,
    },
    upperElectionSystem: {
      termYears: 6,
      seatsContested: "partial",
      staggeredClasses: 2,
      singleMemberConstituencies: true,
      snapElectionsAllowed: false,
    },
    electionSystems: {
      lowerChamber: "pr_hareQuota", // Shūgiin
      upperChamber: "pr_hareQuota", // Sangiin (class-staggered)
      subNationalChamber: "pr_hareQuota",
      headOfGovernment: "parliamentary",
      headOfState: "ceremonial", // Emperor
    },

    officeTypes: [
      {
        key: "primeMinister",
        label: "Prime Minister",
        labelPlural: "Prime Ministers",
        isExecutive: true,
        isSubNational: false,
        actionBonus: 4,
        partyStrengthWeight: 1.0,
      },
      {
        key: "shugiin",
        label: "Member of the House of Representatives",
        labelPlural: "Members of the House of Representatives",
        chamberKey: "shugiin",
        isExecutive: false,
        isSubNational: false,
        termYears: 4,
        actionBonus: 1,
        partyStrengthWeight: 0.85,
      },
      {
        key: "sangiin",
        label: "Member of the House of Councillors",
        labelPlural: "Members of the House of Councillors",
        chamberKey: "sangiin",
        isExecutive: false,
        isSubNational: false,
        termYears: 6,
        actionBonus: 1,
        partyStrengthWeight: 0.85,
      },
      {
        // JP prefectural assembly (Regional Council). Mirrors UK's
        // regionalCouncil office. Declared BEFORE `governor` so the naive
        // "first sub-national non-executive office" lookups resolve to the
        // legislature, not the (also sub-national, non-executive) governor.
        // termYears: 4 matches the Shugiin sync (UK uses 5 to match Commons).
        key: "regionalCouncil",
        label: "Regional Councillor",
        labelPlural: "Regional Councillors",
        chamberKey: "regionalCouncil",
        isExecutive: false,
        isSubNational: true,
        termYears: 4,
        actionBonus: 1,
        partyStrengthWeight: 0.85,
      },
      {
        // JP regional governor — 4-year cycle matches CYCLE_TURNS.governor
        // (192 turns). RL Japanese prefectural-governor terms are 4 years;
        // earlier config metadata read 6, which conflicted with the actual
        // election cycle and was never load-bearing (the cycle constant
        // is authoritative at runtime).
        key: "governor",
        label: "Governor",
        labelPlural: "Governors",
        isExecutive: false,
        isSubNational: true,
        termYears: 4,
        actionBonus: 2,
        partyStrengthWeight: 1.0,
      },
      {
        key: "centralBankChair",
        label: "Governor of the Bank of Japan",
        labelPlural: "Governors of the Bank of Japan",
        isExecutive: false,
        isSubNational: false,
        termYears: 5,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],

    subNationalChamber: {
      key: "regionalCouncil",
      name: "Regional Council",
      shortName: "Regional Council",
      seats: 2679, // sum of stateSenateSeats across the 8 JP regions (informational)
      description: "Elected regional councillors representing Japan's regions.",
      regionalModel: true,
    },

    majorPartyIds: ["ldp", "cdp"],
    partyCreationNPPs: { statesRequired: 2, lockHomeState: false, nppsPerState: 1 },
    demographicProfileId: "jp_archetypes",

    centralBank: {
      name: "Bank of Japan",
      abbreviation: "BoJ",
      chairTitle: "Governor of the Bank of Japan",
      defaultPrimeRate: 1.0,
      heroImage: "/api/images/hero/bank-of-japan",
    },

    exchangeName: "Nikkei",
    cabinetBillsEnabled: true,
    usdExchangeRate: 0.00943,
    currencyCode: "JPY",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "finance_minister",

    status: "active",
    tagline:
      "Parliamentary democracy under the National Diet - FPTP lower house elections and a revising upper chamber.",
    descriptor:
      "A parliamentary constitutional monarchy where the Prime Minister leads government through confidence in the House of Representatives, alongside the House of Councillors and elected regional governments.",
    heroImage: getCountryFlagUrl("JP"),
    entryPath: "/country/jp",
    overviewPath: "/country/jp",
    mapPath: "/country/jp/map",
    executivePath: "/country/jp/executive",
    executiveLabel: "Naikaku Sōri Daijin Kantei",
    centralGovernmentLabel: "National Transfers",
    imperialTitles: {
      male: "Emperor",
      female: "Empress",
      nonbinary: "Emperor",
    },
    imperialCorporation: {
      name: "Chrysanthemum Properties",
      sector: "real_estate",
    },
  },

  IE: {
    id: "IE",
    seedEconomicModel: { "1991": "agrarian", "2019": "techInnovation" },
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
    coalitionThreshold: 81, // Dáil majority (160 seats / 2 + 1)

    legislature: {
      name: "Oireachtas",
      path: "/country/ie/legislature",
      // Seanad is partly elected, partly appointed — not part of the player legislative loop.
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
    upperElectionSystem: undefined, // Seanad partly elected, partly appointed
    electionSystems: {
      lowerChamber: "pr_hareQuota", // Dáil — TODO: declared PR-STV; resolves as Largest Remainder
      upperChamber: "pr_hareQuota", // Seanad
      subNationalChamber: "pr_hareQuota", // Local Councils
      headOfGovernment: "parliamentary", // Taoiseach
      headOfState: "fptp", // Uachtarán — TODO: revisit (direct FPTP today)
    },

    officeTypes: [
      {
        key: "taoiseach",
        label: "Taoiseach",
        labelPlural: "Taoisigh",
        isExecutive: true,
        isSubNational: false,
        actionBonus: 4,
        partyStrengthWeight: 1.0,
      },
      {
        key: "tanaiste",
        label: "Tánaiste",
        labelPlural: "Tánaistí",
        isExecutive: true,
        isSubNational: false,
        actionBonus: 2,
        partyStrengthWeight: 1.0,
      },
      {
        // Office label is the bare title; the executive-label renderer in
        // utils/politics.ts appends "of [realm]" → "Uachtarán of Ireland".
        // The full constitutional title "Uachtarán na hÉireann" lives on
        // `headOfStateTitle` for standalone head-of-state rendering.
        key: "uachtaran",
        label: "Uachtarán",
        labelPlural: "Uachtaráin",
        isExecutive: true,
        // President of Ireland — IE's ceremonial head of state.
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
        // Recycle the cross-country `governor` office key for the council chair —
        // same mechanical shape (single-seat, direct election, sub-national) as
        // UK First Minister / Mayor of London / JP regional governors. Display
        // label diverges per-region via getRegionalExecutive (regionalExecutive.ts):
        // Lord Mayor of Dublin (DUB), Lord Mayor of Cork (COR),
        // Mayor of Limerick (LIM), Mayor of Galway (GAL),
        // Cathaoirleach elsewhere.
        key: "governor",
        label: "Cathaoirleach",
        labelPlural: "Cathaoirligh",
        isExecutive: false,
        isSubNational: true,
        termYears: 5,
        actionBonus: 2,
        partyStrengthWeight: 1.0,
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
    partyCreationNPPs: { statesRequired: 2, lockHomeState: false, nppsPerState: 1 },
    demographicProfileId: "ie_archetypes",
    executiveTermLimit: {
      officeKey: "uachtaran",
      maxTermsPerCharacter: 2,
      blocksRunningMateSelection: false,
    },

    centralBank: {
      // Central Bank of Ireland (1943–). Pre-euro Ireland had its own CB with
      // the Irish pound on a hard sterling peg (1927–1979); it was never the ECB.
      // Eurozone display/adoption still uses gameState.eurozoneEnabled; IEP
      // shows as € when that flag is on. Live IEP↔EUR rate lock is a follow-up.
      name: "Central Bank of Ireland",
      abbreviation: "CBI",
      chairTitle: "Governor of the Central Bank of Ireland",
      defaultPrimeRate: 3.0,
      heroImage: "/api/images/hero/ecb",
    },

    exchangeName: "ISEQ",
    usdExchangeRate: 1.0,
    currencyCode: "IEP",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "minister_for_finance",

    status: "active",
    tagline:
      "Parliamentary republic on the Atlantic edge of Europe - coalition politics, PR-STV elections, and a rapidly modernising economy.",
    descriptor:
      "A parliamentary republic where the Taoiseach leads government through a Dáil majority, elected by proportional representation using the Single Transferable Vote across multi-seat constituencies.",
    heroImage: getCountryFlagUrl("IE"),
    entryPath: "/country/ie",
    overviewPath: "/country/ie",
    mapPath: "/country/ie/map",
    executivePath: "/country/ie/executive",
    executiveLabel: "Government Buildings",
    centralGovernmentLabel: "Exchequer Grants",
  },

  // Latent secession country (Sub-project 1). Authored fully but `coming-soon`
  // and absent from COUNTRY_ORDER, so invisible until the secession actuation
  // (SP2) writes its countryGameStates row. Sterlingized (shares UK's GBP rate).
  SCO: {
    id: "SCO",
    seedEconomicModel: { "1991": "financialized", "2019": "financialized" },
    name: "Scotland",
    flagEmoji: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
    code: "SCO",
    socialAxisBaseline: -2,

    regionLabel: "Region",
    regionLabelPlural: "Regions",

    executiveTitle: "First Minister",
    executiveRealmPhrase: "Scotland",
    governmentType: "parliamentaryRepublic",
    governmentTypeLabel: "Parliamentary Republic",
    coalitionThreshold: 65, // Holyrood majority (129 / 2 + 1)

    legislature: {
      name: "Scottish Parliament",
      path: "/country/sco/legislature",
      bicameral: false,
      // Unicameral — no upper chamber (upperChamber omitted; optional since SP1 Task 1).
      lowerChamber: {
        key: "holyrood",
        name: "Scottish Parliament",
        shortName: "Holyrood",
        seats: 129,
        description:
          "129 MSPs elected by the Additional Member System - 73 constituency seats plus 56 regional list seats.",
        elected: true,
      },
    },

    lowerElectionSystem: {
      termYears: 5,
      seatsContested: "all",
      singleMemberConstituencies: false,
      snapElectionsAllowed: true,
    },
    upperElectionSystem: undefined,

    // Sub-regional councils, one per macro-region; total = Scotland's 32 council
    // areas (see SCO_REGIONAL_COUNCIL_SEATS). Mirrors the UK regional model.
    subNationalChamber: {
      key: "regionalCouncil",
      name: "Regional Council",
      shortName: "Council",
      seats: 32,
      description: "Elected councillors representing Scotland's council areas.",
      regionalModel: true,
    },
    regionalBillAssentTitle: "Provost",

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
        partyStrengthWeight: 1.0,
      },
      {
        key: "holyrood",
        label: "Member of the Scottish Parliament",
        labelPlural: "Members of the Scottish Parliament",
        chamberKey: "holyrood",
        isExecutive: false,
        isSubNational: false,
        termYears: 5,
        actionBonus: 1,
        partyStrengthWeight: 0.85,
      },
      {
        // Sub-regional executive (one per macro-region) — recycles the shared
        // `governor` key so the 4-yr cycle, action bonus, and bill-assent flow
        // apply unchanged. "Provost" is the Scottish civic-head title.
        key: "governor",
        label: "Provost",
        labelPlural: "Provosts",
        isExecutive: false,
        isSubNational: true,
        termYears: 4,
        actionBonus: 2,
        partyStrengthWeight: 1.0,
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

    // Strings consumed only at activation (SP2): SNP moves wholesale; Scottish
    // Labour is the largest split successor. Demographic profile shares UK's
    // archetypes until SCO archetypes are authored.
    majorPartyIds: ["SNP", "LAB"],
    partyCreationNPPs: { statesRequired: 2, lockHomeState: false, nppsPerState: 1 },
    demographicProfileId: "uk_archetypes",

    centralBank: {
      name: "Bank of England",
      abbreviation: "BoE",
      chairTitle: "Governor of the Bank of England",
      defaultPrimeRate: 3.0,
      sharedBankId: "UK", // sterlingized - shares the UK's Bank of England (getBankId("UK")), no own doc
      heroImage: "/api/images/hero/bank-of-england",
    },

    exchangeName: "FTSE",
    usdExchangeRate: 1.0,
    currencyCode: "GBP",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "financeSecretary",

    status: "coming-soon",
    tagline:
      "An independent Scotland - single-chamber Holyrood, Additional Member System elections, and a sterling-zone economy.",
    descriptor:
      "A parliamentary republic where the First Minister leads government through a Holyrood majority, elected by the Additional Member System across Scotland's regions.",
    heroImage: getCountryFlagUrl("SCO"),
    entryPath: "/country/sco",
    overviewPath: "/country/sco",
    mapPath: "/country/sco/map",
    executivePath: "/country/sco/executive",
    executiveLabel: "Bute House",
    centralGovernmentLabel: "Scottish Block Grant",
  },

  // Latent secession country (Sub-project 1). See SCO above; sterlingized,
  // unicameral Senedd, coming-soon and absent from COUNTRY_ORDER until SP2.
  WAL: {
    id: "WAL",
    seedEconomicModel: { "1991": "financialized", "2019": "financialized" },
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
    coalitionThreshold: 31, // Senedd majority (60 / 2 + 1)

    legislature: {
      name: "Senedd Cymru",
      path: "/country/wal/legislature",
      bicameral: false,
      // Unicameral — no upper chamber (upperChamber omitted; optional since SP1 Task 1).
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
    upperElectionSystem: undefined,

    // Sub-regional councils, one per macro-region; total = Wales' 22 principal
    // areas (see WAL_REGIONAL_COUNCIL_SEATS). Mirrors the UK regional model.
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
        partyStrengthWeight: 1.0,
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
        // Sub-regional executive (one per macro-region) — recycles the shared
        // `governor` key. "Leader" is the Welsh principal-council head title.
        key: "governor",
        label: "Leader",
        labelPlural: "Leaders",
        isExecutive: false,
        isSubNational: true,
        termYears: 4,
        actionBonus: 2,
        partyStrengthWeight: 1.0,
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

    // Strings consumed only at activation (SP2): Plaid Cymru moves wholesale;
    // Welsh Labour is the largest split successor. Demographic profile shares UK's.
    majorPartyIds: ["PC", "LAB"],
    partyCreationNPPs: { statesRequired: 2, lockHomeState: false, nppsPerState: 1 },
    demographicProfileId: "uk_archetypes",

    centralBank: {
      name: "Bank of England",
      abbreviation: "BoE",
      chairTitle: "Governor of the Bank of England",
      defaultPrimeRate: 3.0,
      sharedBankId: "UK", // sterlingized - shares the UK's Bank of England (getBankId("UK")), no own doc
      heroImage: "/api/images/hero/bank-of-england",
    },

    exchangeName: "FTSE",
    usdExchangeRate: 1.0,
    currencyCode: "GBP",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "financeSecretary",

    status: "coming-soon",
    tagline:
      "An independent Wales - a single-chamber Senedd, Additional Member System elections, and a sterling-zone economy.",
    descriptor:
      "A parliamentary republic where the First Minister leads government through a Senedd majority, elected by the Additional Member System across Wales's regions.",
    heroImage: getCountryFlagUrl("WAL"),
    entryPath: "/country/wal",
    overviewPath: "/country/wal",
    mapPath: "/country/wal/map",
    executivePath: "/country/wal/executive",
    executiveLabel: "Welsh Government",
    centralGovernmentLabel: "Welsh Block Grant",
  },

  BR: {
    id: "BR",
    seedEconomicModel: { "1991": "agrarian", "2019": "resourceExtraction" },
    name: "Brazil",
    flagEmoji: "🇧🇷",
    code: "BR",
    socialAxisBaseline: 0,

    regionLabel: "State",
    regionLabelPlural: "States",

    executiveTitle: "President",
    executiveRealmPhrase: "Brazil",
    governmentType: "presidential",
    governmentTypeLabel: "Presidential Republic",
    coalitionThreshold: 257, // Chamber majority (513 seats / 2 + 1)

    legislature: {
      name: "National Congress",
      path: "/country/br/legislature",
      bicameral: true,
      upperChamber: {
        key: "senate",
        name: "Federal Senate",
        shortName: "Senate",
        seats: 81,
        description:
          "81 senators - three per state - serving eight-year staggered terms. Reviews legislation from the Chamber.",
        elected: true,
      },
      lowerChamber: {
        key: "chamber",
        name: "Chamber of Deputies",
        shortName: "Chamber",
        seats: 513,
        description:
          "513 deputies elected by open-list proportional representation from 27 multi-member constituencies. Four-year terms.",
        elected: true,
      },
    },

    lowerElectionSystem: {
      termYears: 4,
      seatsContested: "all",
      singleMemberConstituencies: false,
      snapElectionsAllowed: false,
    },
    upperElectionSystem: {
      termYears: 8,
      seatsContested: "partial",
      staggeredClasses: 2,
      singleMemberConstituencies: true,
      snapElectionsAllowed: false,
    },

    electionSystems: {
      lowerChamber: "pr_hareQuota", // TODO: declared D'Hondt; resolves as Largest Remainder
      upperChamber: "fptp",
      headOfState: "electoralCollege", // TODO: two-round direct in RL; EC is closest impl
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
        partyStrengthWeight: 1.0,
      },
      {
        key: "vicePresident",
        label: "Vice President",
        labelPlural: "Vice Presidents",
        isExecutive: true,
        isSubNational: false,
        termYears: 4,
        actionBonus: 2,
        partyStrengthWeight: 1.0,
      },
      {
        key: "senate",
        label: "Senator",
        labelPlural: "Senators",
        chamberKey: "senate",
        isExecutive: false,
        isSubNational: false,
        termYears: 8,
        actionBonus: 2,
        partyStrengthWeight: 0.8,
      },
      {
        key: "chamber",
        label: "Federal Deputy",
        labelPlural: "Federal Deputies",
        chamberKey: "chamber",
        isExecutive: false,
        isSubNational: false,
        termYears: 4,
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
        partyStrengthWeight: 1.0,
      },
      {
        key: "centralBankChair",
        label: "Governor of the BCB",
        labelPlural: "Governors of the BCB",
        isExecutive: false,
        isSubNational: false,
        termYears: 4,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],

    majorPartyIds: ["pt", "pl"],
    partyCreationNPPs: { statesRequired: 3, lockHomeState: true, nppsPerState: 2 },
    demographicProfileId: "br_archetypes",
    executiveTermLimit: {
      officeKey: "president",
      maxTermsPerCharacter: 2,
      blocksRunningMateSelection: true,
    },

    centralBank: {
      name: "Banco Central do Brasil",
      abbreviation: "BCB",
      chairTitle: "Governor of the BCB",
      defaultPrimeRate: 8.0,
      heroImage: "/api/images/hero/banco-central-do-brasil",
    },

    exchangeName: "B3",
    usdExchangeRate: 0.2, // 1 BRL ≈ USD 0.20
    currencyCode: "BRL",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "minister_of_finance",

    status: "coming-soon",
    tagline:
      "South America's largest democracy - a federal presidential republic with fragmented multi-party politics and a dynamic emerging-market economy.",
    descriptor:
      "A federal presidential republic where the directly elected President governs alongside a National Congress of 513 deputies and 81 senators across five macro-regions.",
    heroImage: getCountryFlagUrl("BR"),
    entryPath: "/country/br",
    overviewPath: "/country/br",
    mapPath: "/country/br/map",
    executivePath: "/country/br/executive",
    executiveLabel: "Palácio do Planalto",
    centralGovernmentLabel: "Federal Transfers",
  },

  CN: {
    id: "CN",
    // Sector-supported identities (State-Capitalist EMERGES via the ≥67% state-
    // ownership lever once the government actually nationalizes — sectors start
    // unowned). 1991: a developing, largely agrarian/reforming economy; 2019: the
    // world's manufacturing powerhouse.
    seedEconomicModel: { "1991": "agrarian", "2019": "industrialPowerhouse" },
    name: "China",
    flagEmoji: "🇨🇳",
    code: "CN",
    socialAxisBaseline: 3.5,

    regionLabel: "Province",
    regionLabelPlural: "Provinces",

    executiveTitle: "Premier",
    headOfStateTitle: "President",
    executiveRealmPhrase: "China",
    governmentType: "onePartyState",
    headOfStateSelection: "partyChairSync",
    governmentTypeLabel: "One Party State",
    discordWebhookNote: "PBoC rate decisions and chair changes.",
    coalitionThreshold: 1491, // NPC majority (2980 seats / 2 + 1)
    // CN is one-party by design: no-confidence votes are blocked at runtime by
    // onePartyConstraints.canTriggerNoConfidence(), so the generic VONC path
    // is skipped via this flag rather than fired and rejected.

    legislature: {
      name: "National People's Congress",
      path: "/country/cn/legislature",
      // CPPCC is advisory, not part of the player legislative loop.
      bicameral: false,
      upperChamber: {
        key: "cppcc",
        name: "CPPCC",
        shortName: "CPPCC",
        seats: 2169,
        description:
          "2,169 members of the Chinese People's Political Consultative Conference - an advisory body representing diverse social and economic constituencies.",
      },
      lowerChamber: {
        key: "npc",
        name: "National People's Congress",
        shortName: "NPC",
        seats: 2980,
        description:
          "2,980 delegates representing provinces, municipalities, autonomous regions, the armed forces, and special administrative regions. Five-year terms.",
      },
    },

    subNationalChamber: {
      key: "peoplesCongress",
      name: "People's Congress",
      shortName: "People's Congress",
      // Sum of per-province seat allocations seeded in
      // CN_PEOPLES_CONGRESS_2020. Mirrors real-world provincial
      // people's congress sizes scaled for game playability.
      seats: 4000,
      description:
        "Provincial People's Congresses - the elected legislatures of each macro-region, operating as the legislative arm of each Provincial People's Government. Members serve five-year terms.",
      regionalModel: true,
    },

    lowerElectionSystem: {
      termYears: 5,
      seatsContested: "all",
      singleMemberConstituencies: false,
      snapElectionsAllowed: false,
      // CN: up to 7 CCP candidates may advance from each region's primary
      // so the multi-seat PR general phase distributes seats across the
      // 7-NPP-per-region caucus instead of collapsing to a single
      // delegate per region. Applies to both NPC and Provincial
      // People's Congress primaries — same engine helper reads this
      // override regardless of chamber.
    },
    upperElectionSystem: undefined, // CPPCC members are selected/appointed
    electionSystems: {
      lowerChamber: "pr_hareQuota", // NPC Delegate
      subNationalChamber: "pr_hareQuota", // Provincial People's Congress
      headOfGovernment: "parliamentary", // Premier — party-confidence formation
      headOfState: "ceremonial", // President of the PRC = CCP chair (partyChairHeadOfState)
    },

    officeTypes: [
      {
        // Executive office for the CN parliamentary head of government.
        // Renamed from "president" → "premier" in 2026-05-22. The matching
        // migration (scripts/migrations/2026-05-22-cn-executive-key-rename.ts)
        // updates characters/npps/electedOfficials docs with the old key.
        // Must remain the FIRST executive entry so getExecutiveOfficeKey("CN")
        // continues to return "premier" (head of government) — the new
        // ceremonial "president" office below is keyed off CCP.chairId by
        // partyChairHeadOfState, not by election or appointment.
        key: "premier",
        label: "Premier",
        labelPlural: "Premiers",
        isExecutive: true,
        isSubNational: false,
        termYears: 5,
        actionBonus: 4,
        partyStrengthWeight: 1.0,
      },
      {
        // Ceremonial head of state. Auto-populated as whoever currently
        // holds the CCP chair (party.chairId on the ruling party) by
        // syncPartyChairHeadOfState in src/lib/turn/partyChairHeadOfState.ts. Not elected,
        // not appointed through the Premier flow. actionBonus and
        // partyStrengthWeight are intentionally 0 — the office carries no
        // mechanical weight beyond its ceremonial label.
        key: "president",
        label: "President",
        labelPlural: "Presidents",
        isExecutive: true,
        // Ceremonial President of the PRC — auto-populated as the sitting CCP
        // chair by partyChairHeadOfState. This is CN's head of state.
        isHeadOfState: true,
        isSubNational: false,
        actionBonus: 0,
        partyStrengthWeight: 0,
      },
      {
        key: "npcDelegate",
        label: "NPC Delegate",
        labelPlural: "NPC Delegates",
        chamberKey: "npc",
        isExecutive: false,
        isSubNational: false,
        termYears: 5,
        actionBonus: 1,
        partyStrengthWeight: 0.85,
      },
      {
        key: "peoplesCongress",
        label: "Provincial Delegate",
        labelPlural: "Provincial Delegates",
        chamberKey: "peoplesCongress",
        isExecutive: false,
        isSubNational: true,
        termYears: 5,
        actionBonus: 1,
        partyStrengthWeight: 0.75,
      },
      {
        key: "governor",
        label: "Governor",
        labelPlural: "Governors",
        isExecutive: false,
        isSubNational: true,
        termYears: 5,
        actionBonus: 2,
        partyStrengthWeight: 1.0,
      },
      {
        key: "centralBankChair",
        label: "Governor of the PBoC",
        labelPlural: "Governors of the PBoC",
        isExecutive: false,
        isSubNational: false,
        termYears: 5,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],

    majorPartyIds: ["ccp"],
    rulingPartyId: 1,
    priorityProfile: DEFAULT_CN_PRIORITY_PROFILE,
    popularMoodProfile: CN_POPULAR_MOOD_PROFILE,
    factionDefectionName: "Democratic Faction of the CCP",
    collapseTargetSystem: "parliamentaryRepublic",
    collapseTargetAllowlist: ["parliamentaryRepublic", "presidential"],
    legacyReservationDefault: 20,
    electionDelayDefault: 24,
    policyAxisEffects: DEFAULT_POLICY_AXIS_EFFECTS,
    onePartyRegionalBudget: {
      localTaxRetentionShare: 0.4,
      corporateProfitRatio: 0.06,
      centralTransferPerCapita: 35,
      defaultTaxRate: 25,
      primaryTaxLegislationKey: "cn_enterprise_income_tax",
      resourceTaxLegislationKey: "cn_provincial_resource_tax",
      resourceExtractionRatio: 0.03,
      businessTaxConsumptionRatio: 0.5,
      businessTaxRate: 24,
    },
    partyCreationNPPs: { statesRequired: 2, lockHomeState: false, nppsPerState: 1 },
    partyRoleLabels: {
      chair: "General Secretary",
      viceChair: "Deputy General Secretary",
      // treasurer intentionally left default ("National Treasurer") per design
      committee: "Secretariat",
    },
    demographicProfileId: "cn_archetypes",
    hasLeaderConfidenceModel: true,
    mapOverlay: "partyOrg",

    centralBank: {
      name: "People's Bank of China",
      abbreviation: "PBoC",
      chairTitle: "Governor of the PBoC",
      defaultPrimeRate: 4.0,
      heroImage: "/api/images/hero/peoples-bank-of-china",
    },

    exchangeName: "SSE",
    usdExchangeRate: 0.138, // 1 CNY ≈ USD 0.138
    currencyCode: "CNY",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "minister_of_finance",

    status: "active",
    tagline:
      "The world's second-largest economy - seven geographic regions, a National People's Congress, and a central bank steering rapid development.",
    descriptor:
      "A unitary state governed by the Chinese Communist Party, where the Premier leads the State Council through confidence of the 2,980-seat National People's Congress across seven geographic regions.",
    heroImage: getCountryFlagUrl("CN"),
    entryPath: "/country/cn",
    overviewPath: "/country/cn",
    mapPath: "/country/cn/map",
    executivePath: "/country/cn/executive",
    executiveLabel: "State Council",
    centralGovernmentLabel: "Central Government Transfers",
  },

  NG: {
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
    coalitionThreshold: 181, // House of Representatives majority (360 seats / 2 + 1)

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
        partyStrengthWeight: 1.0,
      },
      {
        key: "vicePresident",
        label: "Vice President",
        labelPlural: "Vice Presidents",
        isExecutive: true,
        isSubNational: false,
        termYears: 4,
        actionBonus: 2,
        partyStrengthWeight: 1.0,
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
        // Declared before `governor` so "first sub-national non-executive office"
        // lookups resolve to the legislature (State House of Assembly), not the
        // (also sub-national) governor. Election label surfaces via the NG entry
        // in COUNTRY_ELECTION_TYPE_LABELS ("State House of Assembly").
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
        partyStrengthWeight: 1.0,
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
    partyCreationNPPs: { statesRequired: 3, lockHomeState: true, nppsPerState: 2 },
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
      defaultPrimeRate: 12.0,
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
    heroImage: getCountryFlagUrl("NG"),
    entryPath: "/country/ng",
    overviewPath: "/country/ng",
    mapPath: "/country/ng/map",
    executivePath: "/country/ng/executive",
    executiveLabel: "Aso Rock",
    centralGovernmentLabel: "Federal Allocations",
  },

  // ── Eastern Bloc (1979 iteration) — NPP-run one-party states ────────────────
  // Template for the Warsaw-Pact / socialist roster. `status: "coming-soon"`
  // until its seed stack lands; enablement (NPP-only, econ-locked) is set per
  // preset via countryGameStates. governmentType "onePartyState" drives the
  // parliamentary-style code paths + one-party constraints.
  HU: {
    id: "HU",
    name: "Hungary",
    flagEmoji: "🇭🇺",
    code: "HU",
    socialAxisBaseline: 2.5,

    regionLabel: "Region",
    regionLabelPlural: "Regions",

    executiveTitle: "General Secretary",
    headOfStateTitle: "Chairman of the Presidential Council",
    executiveRealmPhrase: "Hungary",
    governmentType: "onePartyState",
    // Ruling communist party seeded first → sequentialId 1 (mirrors CN/RU).
    // Was omitted for the bloc stubs, leaving countryState.rulingPartyId null.
    rulingPartyId: 1,
    governmentTypeLabel: "One Party State",
    coalitionThreshold: 177, // National Assembly majority (352 / 2 + 1)

    legislature: {
      name: "National Assembly",
      path: "/country/hu/legislature",
      // Functionally unicameral: the Presidential Council is a collective head of
      // state / standing organ, modelled here as the (non-elected) upper chamber
      // the LegislatureConfig type requires.
      bicameral: false,
      upperChamber: {
        key: "presidentialCouncil",
        name: "Presidential Council",
        shortName: "Council",
        seats: 21,
        description:
          "The Elnöki Tanács - a 21-member collective head of state that exercised standing legislative authority between Assembly sessions; members chosen by the National Assembly.",
        elected: false,
      },
      lowerChamber: {
        key: "nationalAssembly",
        name: "National Assembly",
        shortName: "Assembly",
        seats: 352,
        description:
          "352 deputies of the Országgyűlés, elected to five-year terms in the Hungarian People's Republic - in practice a single-list body controlled by the ruling socialist workers' party.",
        elected: true,
      },
    },

    lowerElectionSystem: {
      termYears: 5,
      seatsContested: "all",
      singleMemberConstituencies: true,
      snapElectionsAllowed: false,
    },

    electionSystems: {
      lowerChamber: "fptp",
      headOfGovernment: "parliamentary",
      headOfState: "ceremonial",
    },
    headOfStateSelection: "partyChairSync",
    officeTypes: [
      {
        key: "generalSecretary",
        label: "General Secretary",
        labelPlural: "General Secretaries",
        isExecutive: true,
        isSubNational: false,
        termYears: 5,
        actionBonus: 4,
        partyStrengthWeight: 1.0,
      },
      {
        key: "chairmanOfPresidentialCouncil",
        label: "Chairman of the Presidential Council",
        labelPlural: "Chairmen of the Presidential Council",
        isExecutive: true,
        isHeadOfState: true,
        isSubNational: false,
        actionBonus: 0,
        partyStrengthWeight: 0,
      },
      {
        key: "assemblyDelegate",
        label: "Deputy",
        labelPlural: "Deputies",
        chamberKey: "nationalAssembly",
        isExecutive: false,
        isSubNational: false,
        termYears: 5,
        actionBonus: 1,
        partyStrengthWeight: 0.9,
      },
      {
        key: "centralBankChair",
        label: "Governor of the MNB",
        labelPlural: "Governors of the MNB",
        isExecutive: false,
        isSubNational: false,
        termYears: 6,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],

    majorPartyIds: ["mszmp"],
    partyCreationNPPs: { statesRequired: 1, lockHomeState: true, nppsPerState: 2 },
    demographicProfileId: "hu_archetypes",

    centralBank: {
      name: "Hungarian National Bank",
      abbreviation: "MNB",
      chairTitle: "Governor of the MNB",
      defaultPrimeRate: 5.0,
      heroImage: getCountryFlagUrl("HU"),
    },

    // Command economy: Orszagos Tervhivatal, the National Planning Office.
    exchangeName: "OT",
    exchangeKind: "stateRegister",
    usdExchangeRate: 0.031, // ~32 HUF/USD (1979)
    currencyCode: "HUF",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "minister_of_finance",

    disallowPrivateCorporationFounding: true, // command economy: no private corp founding (mirrors DD/RU)
    popularMoodProfile: CN_POPULAR_MOOD_PROFILE, // one-party legitimacy drift (mirrors DD/RU/CN)
    status: "coming-soon",
    tagline:
      "A one-party People's Republic in the Soviet bloc - \"goulash communism\" under a ruling socialist workers' party.",
    descriptor:
      "A one-party socialist state where the ruling party's General Secretary governs through a single-chamber National Assembly; the economy is centrally planned until reform.",
    heroImage: getCountryFlagUrl("HU"),
    entryPath: "/country/hu",
    overviewPath: "/country/hu",
    mapPath: "/country/hu/map",
    executivePath: "/country/hu/executive",
    executiveLabel: "Parliament",
    centralGovernmentLabel: "Central Plan",
  },

  // ── Poland (PZPR) ───────────────────────────────────────────────────────────
  PL: {
    id: "PL",
    name: "Poland",
    flagEmoji: "🇵🇱",
    code: "PL",
    socialAxisBaseline: 2.5,
    regionLabel: "Region",
    regionLabelPlural: "Regions",
    executiveTitle: "First Secretary",
    headOfStateTitle: "Chairman of the Council of State",
    executiveRealmPhrase: "Poland",
    governmentType: "onePartyState",
    rulingPartyId: 1, // ruling party seeded first → seq 1 (mirrors CN/RU)
    governmentTypeLabel: "One Party State",
    coalitionThreshold: 231, // Sejm majority (460 / 2 + 1)
    legislature: {
      name: "Sejm",
      path: "/country/pl/legislature",
      bicameral: false,
      upperChamber: {
        key: "councilOfState",
        name: "Council of State",
        shortName: "Council",
        seats: 17,
        description:
          "The Rada Państwa - a collective head of state exercising standing authority between Sejm sessions; chosen by the Sejm.",
        elected: false,
      },
      lowerChamber: {
        key: "sejm",
        name: "Sejm",
        shortName: "Sejm",
        seats: 460,
        description:
          "460 deputies of the Sejm, elected to four-year terms - a single-list body led by the ruling workers' party within the National Unity Front.",
        elected: true,
      },
    },
    lowerElectionSystem: {
      termYears: 4,
      seatsContested: "all",
      singleMemberConstituencies: true,
      snapElectionsAllowed: false,
    },
    electionSystems: {
      lowerChamber: "fptp",
      headOfGovernment: "parliamentary",
      headOfState: "ceremonial",
    },
    headOfStateSelection: "partyChairSync",
    officeTypes: [
      {
        key: "firstSecretary",
        label: "First Secretary",
        labelPlural: "First Secretaries",
        isExecutive: true,
        isSubNational: false,
        termYears: 5,
        actionBonus: 4,
        partyStrengthWeight: 1.0,
      },
      {
        key: "chairmanOfStateCouncil",
        label: "Chairman of the Council of State",
        labelPlural: "Chairmen of the Council of State",
        isExecutive: true,
        isHeadOfState: true,
        isSubNational: false,
        actionBonus: 0,
        partyStrengthWeight: 0,
      },
      {
        key: "sejmDeputy",
        label: "Deputy",
        labelPlural: "Deputies",
        chamberKey: "sejm",
        isExecutive: false,
        isSubNational: false,
        termYears: 4,
        actionBonus: 1,
        partyStrengthWeight: 0.9,
      },
      {
        key: "centralBankChair",
        label: "President of the NBP",
        labelPlural: "Presidents of the NBP",
        isExecutive: false,
        isSubNational: false,
        termYears: 6,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],
    majorPartyIds: ["pzpr"],
    partyCreationNPPs: { statesRequired: 1, lockHomeState: true, nppsPerState: 2 },
    demographicProfileId: "pl_archetypes",
    centralBank: {
      name: "National Bank of Poland",
      abbreviation: "NBP",
      chairTitle: "President of the NBP",
      defaultPrimeRate: 5.0,
      heroImage: getCountryFlagUrl("PL"),
    },
    // Command economy: Panstwowa Komisja Planowania Gospodarczego, the State
    // Commission for Economic Planning.
    exchangeName: "PKPG",
    exchangeKind: "stateRegister",
    usdExchangeRate: 0.04,
    currencyCode: "PLZ",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "minister_of_finance",
    disallowPrivateCorporationFounding: true, // command economy: no private corp founding (mirrors DD/RU)
    popularMoodProfile: CN_POPULAR_MOOD_PROFILE, // one-party legitimacy drift (mirrors DD/RU/CN)
    status: "coming-soon",
    tagline:
      "The largest Warsaw-Pact state - a one-party People's Republic on the cusp of the Solidarity era.",
    descriptor:
      "A one-party socialist state where the ruling workers' party's First Secretary governs through the Sejm; the economy is centrally planned until reform.",
    heroImage: getCountryFlagUrl("PL"),
    entryPath: "/country/pl",
    overviewPath: "/country/pl",
    mapPath: "/country/pl/map",
    executivePath: "/country/pl/executive",
    executiveLabel: "Council of Ministers",
    centralGovernmentLabel: "Central Plan",
  },

  // ── Romania (PCR) ───────────────────────────────────────────────────────────
  RO: {
    id: "RO",
    name: "Romania",
    flagEmoji: "🇷🇴",
    code: "RO",
    socialAxisBaseline: 3.0,
    regionLabel: "Region",
    regionLabelPlural: "Regions",
    executiveTitle: "General Secretary",
    headOfStateTitle: "President of the Republic",
    executiveRealmPhrase: "Romania",
    governmentType: "onePartyState",
    rulingPartyId: 1, // ruling party seeded first → seq 1 (mirrors CN/RU)
    governmentTypeLabel: "One Party State",
    coalitionThreshold: 186, // Grand National Assembly majority (369 / 2 + 1)
    legislature: {
      name: "Grand National Assembly",
      path: "/country/ro/legislature",
      bicameral: false,
      upperChamber: {
        key: "stateCouncil",
        name: "State Council",
        shortName: "Council",
        seats: 21,
        description:
          "A collective head of state exercising standing authority between Assembly sessions; chosen by the Grand National Assembly.",
        elected: false,
      },
      lowerChamber: {
        key: "grandNationalAssembly",
        name: "Grand National Assembly",
        shortName: "Assembly",
        seats: 369,
        description:
          "369 deputies of the Marea Adunare Națională, elected to five-year terms - a single-list body controlled by the ruling communist party.",
        elected: true,
      },
    },
    lowerElectionSystem: {
      termYears: 5,
      seatsContested: "all",
      singleMemberConstituencies: true,
      snapElectionsAllowed: false,
    },
    electionSystems: {
      lowerChamber: "fptp",
      headOfGovernment: "parliamentary",
      headOfState: "ceremonial",
    },
    headOfStateSelection: "partyChairSync",
    officeTypes: [
      {
        key: "generalSecretary",
        label: "General Secretary",
        labelPlural: "General Secretaries",
        isExecutive: true,
        isSubNational: false,
        termYears: 5,
        actionBonus: 4,
        partyStrengthWeight: 1.0,
      },
      {
        key: "presidentOfStateCouncil",
        label: "President of the State Council",
        labelPlural: "Presidents of the State Council",
        isExecutive: true,
        isHeadOfState: true,
        isSubNational: false,
        actionBonus: 0,
        partyStrengthWeight: 0,
      },
      {
        key: "assemblyDeputy",
        label: "Deputy",
        labelPlural: "Deputies",
        chamberKey: "grandNationalAssembly",
        isExecutive: false,
        isSubNational: false,
        termYears: 5,
        actionBonus: 1,
        partyStrengthWeight: 0.9,
      },
      {
        key: "centralBankChair",
        label: "Governor of the BNR",
        labelPlural: "Governors of the BNR",
        isExecutive: false,
        isSubNational: false,
        termYears: 6,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],
    majorPartyIds: ["pcr"],
    partyCreationNPPs: { statesRequired: 1, lockHomeState: true, nppsPerState: 2 },
    demographicProfileId: "ro_archetypes",
    centralBank: {
      name: "National Bank of Romania",
      abbreviation: "BNR",
      chairTitle: "Governor of the BNR",
      defaultPrimeRate: 5.0,
      heroImage: getCountryFlagUrl("RO"),
    },
    // Command economy: Comitetul de Stat al Planificarii, the State Planning
    // Committee.
    exchangeName: "CSP",
    exchangeKind: "stateRegister",
    usdExchangeRate: 0.22,
    currencyCode: "ROL",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "minister_of_finance",
    disallowPrivateCorporationFounding: true, // command economy: no private corp founding (mirrors DD/RU)
    popularMoodProfile: CN_POPULAR_MOOD_PROFILE, // one-party legitimacy drift (mirrors DD/RU/CN)
    status: "coming-soon",
    tagline:
      "A one-party People's Republic pursuing an idiosyncratic, increasingly autocratic national-communism.",
    descriptor:
      "A one-party socialist state where the ruling communist party's General Secretary governs through the Grand National Assembly; the economy is centrally planned until reform.",
    heroImage: getCountryFlagUrl("RO"),
    entryPath: "/country/ro",
    overviewPath: "/country/ro",
    mapPath: "/country/ro/map",
    executivePath: "/country/ro/executive",
    executiveLabel: "Assembly",
    centralGovernmentLabel: "Central Plan",
  },

  // ── Yugoslavia (SKJ) — non-aligned, battleground ────────────────────────────
  YU: {
    id: "YU",
    name: "Yugoslavia",
    flagEmoji: "🇾🇺",
    code: "YU",
    socialAxisBaseline: 2.0,
    regionLabel: "Republic",
    regionLabelPlural: "Republics",
    executiveTitle: "President",
    headOfStateTitle: "President of the Republic",
    executiveRealmPhrase: "Yugoslavia",
    governmentType: "onePartyState",
    rulingPartyId: 1, // ruling party seeded first → seq 1 (mirrors CN/RU)
    governmentTypeLabel: "One Party State",
    coalitionThreshold: 155, // Federal Assembly majority (308 / 2 + 1)
    legislature: {
      name: "Federal Assembly",
      path: "/country/yu/legislature",
      bicameral: false,
      upperChamber: {
        key: "presidency",
        name: "Presidency",
        shortName: "Presidency",
        seats: 9,
        description:
          "The collective State Presidency - a rotating federal head of state representing the republics and provinces.",
        elected: false,
      },
      lowerChamber: {
        key: "federalAssembly",
        name: "Federal Assembly",
        shortName: "Assembly",
        seats: 308,
        description:
          "308 delegates of the Skupština, drawn from the republics and provinces under the self-management system led by the League of Communists.",
        elected: true,
      },
    },
    lowerElectionSystem: {
      termYears: 4,
      seatsContested: "all",
      singleMemberConstituencies: true,
      snapElectionsAllowed: false,
    },
    electionSystems: {
      lowerChamber: "fptp",
      headOfGovernment: "parliamentary",
      headOfState: "ceremonial",
    },
    headOfStateSelection: "partyChairSync",
    officeTypes: [
      {
        key: "president",
        label: "President",
        labelPlural: "Presidents",
        isExecutive: true,
        isHeadOfState: true,
        isSubNational: false,
        termYears: 5,
        actionBonus: 4,
        partyStrengthWeight: 1.0,
      },
      {
        key: "assemblyDelegate",
        label: "Delegate",
        labelPlural: "Delegates",
        chamberKey: "federalAssembly",
        isExecutive: false,
        isSubNational: false,
        termYears: 4,
        actionBonus: 1,
        partyStrengthWeight: 0.9,
      },
      {
        key: "centralBankChair",
        label: "Governor of the NBY",
        labelPlural: "Governors of the NBY",
        isExecutive: false,
        isSubNational: false,
        termYears: 6,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],
    majorPartyIds: ["skj"],
    partyCreationNPPs: { statesRequired: 1, lockHomeState: true, nppsPerState: 2 },
    demographicProfileId: "yu_archetypes",
    centralBank: {
      name: "National Bank of Yugoslavia",
      abbreviation: "NBY",
      chairTitle: "Governor of the NBY",
      defaultPrimeRate: 8.0,
      heroImage: getCountryFlagUrl("YU"),
    },
    // Self-managed socialist economy: the Federal Planning Bureau (Savezni
    // zavod za planiranje) registers the socially-owned enterprises.
    exchangeName: "SZP",
    exchangeKind: "stateRegister",
    usdExchangeRate: 0.055,
    currencyCode: "YUD",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "minister_of_finance",
    disallowPrivateCorporationFounding: true, // command economy: no private corp founding (mirrors DD/RU)
    popularMoodProfile: CN_POPULAR_MOOD_PROFILE, // one-party legitimacy drift (mirrors DD/RU/CN)
    status: "coming-soon",
    tagline:
      "Non-aligned socialist federation of six republics - Titoist self-management, a Cold-War battleground.",
    descriptor:
      "A non-aligned one-party federation governed by a collective presidency and the League of Communists under worker self-management; a market-socialist economy distinct from the Soviet bloc.",
    heroImage: getCountryFlagUrl("YU"),
    entryPath: "/country/yu",
    overviewPath: "/country/yu",
    mapPath: "/country/yu/map",
    executivePath: "/country/yu/executive",
    executiveLabel: "Assembly",
    centralGovernmentLabel: "Federal Plan",
  },

  // ── Bulgaria (BKP) ──────────────────────────────────────────────────────────
  BG: {
    id: "BG",
    name: "Bulgaria",
    flagEmoji: "🇧🇬",
    code: "BG",
    socialAxisBaseline: 2.5,
    regionLabel: "Region",
    regionLabelPlural: "Regions",
    executiveTitle: "General Secretary",
    headOfStateTitle: "Chairman of the State Council",
    executiveRealmPhrase: "Bulgaria",
    governmentType: "onePartyState",
    rulingPartyId: 1, // ruling party seeded first → seq 1 (mirrors CN/RU)
    governmentTypeLabel: "One Party State",
    coalitionThreshold: 201, // National Assembly majority (400 / 2 + 1)
    legislature: {
      name: "National Assembly",
      path: "/country/bg/legislature",
      bicameral: false,
      upperChamber: {
        key: "stateCouncil",
        name: "State Council",
        shortName: "Council",
        seats: 21,
        description:
          "A collective head of state exercising standing authority between Assembly sessions.",
        elected: false,
      },
      lowerChamber: {
        key: "nationalAssembly",
        name: "National Assembly",
        shortName: "Assembly",
        seats: 400,
        description:
          "400 deputies of the Narodno Sabranie, elected to five-year terms - a single-list body controlled by the ruling communist party within the Fatherland Front.",
        elected: true,
      },
    },
    lowerElectionSystem: {
      termYears: 5,
      seatsContested: "all",
      singleMemberConstituencies: true,
      snapElectionsAllowed: false,
    },
    electionSystems: {
      lowerChamber: "fptp",
      headOfGovernment: "parliamentary",
      headOfState: "ceremonial",
    },
    headOfStateSelection: "partyChairSync",
    officeTypes: [
      {
        key: "generalSecretary",
        label: "General Secretary",
        labelPlural: "General Secretaries",
        isExecutive: true,
        isSubNational: false,
        termYears: 5,
        actionBonus: 4,
        partyStrengthWeight: 1.0,
      },
      {
        key: "chairmanOfStateCouncil",
        label: "Chairman of the State Council",
        labelPlural: "Chairmen of the State Council",
        isExecutive: true,
        isHeadOfState: true,
        isSubNational: false,
        actionBonus: 0,
        partyStrengthWeight: 0,
      },
      {
        key: "assemblyDeputy",
        label: "Deputy",
        labelPlural: "Deputies",
        chamberKey: "nationalAssembly",
        isExecutive: false,
        isSubNational: false,
        termYears: 5,
        actionBonus: 1,
        partyStrengthWeight: 0.9,
      },
      {
        key: "centralBankChair",
        label: "Governor of the BNB",
        labelPlural: "Governors of the BNB",
        isExecutive: false,
        isSubNational: false,
        termYears: 6,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],
    majorPartyIds: ["bkp"],
    partyCreationNPPs: { statesRequired: 1, lockHomeState: true, nppsPerState: 2 },
    demographicProfileId: "bg_archetypes",
    centralBank: {
      name: "Bulgarian National Bank",
      abbreviation: "BNB",
      chairTitle: "Governor of the BNB",
      defaultPrimeRate: 5.0,
      heroImage: getCountryFlagUrl("BG"),
    },
    // Command economy: the State Planning Committee (Darzhaven komitet za
    // planirane).
    exchangeName: "DKP",
    exchangeKind: "stateRegister",
    usdExchangeRate: 1.0,
    currencyCode: "BGL",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "minister_of_finance",
    disallowPrivateCorporationFounding: true, // command economy: no private corp founding (mirrors DD/RU)
    popularMoodProfile: CN_POPULAR_MOOD_PROFILE, // one-party legitimacy drift (mirrors DD/RU/CN)
    status: "coming-soon",
    tagline: "The Soviet bloc's most loyal member - a one-party People's Republic.",
    descriptor:
      "A one-party socialist state where the ruling communist party's General Secretary governs through the National Assembly; the economy is centrally planned until reform.",
    heroImage: getCountryFlagUrl("BG"),
    entryPath: "/country/bg",
    overviewPath: "/country/bg",
    mapPath: "/country/bg/map",
    executivePath: "/country/bg/executive",
    executiveLabel: "Assembly",
    centralGovernmentLabel: "Central Plan",
  },

  // ── Belarus (BSSR / CPSU) — Soviet ruble ────────────────────────────────────
  BLR: {
    id: "BLR",
    name: "Belarus",
    flagEmoji: "🇧🇾",
    code: "BLR",
    socialAxisBaseline: 2.5,
    regionLabel: "Region",
    regionLabelPlural: "Regions",
    executiveTitle: "First Secretary",
    headOfStateTitle: "Chairman of the Presidium",
    executiveRealmPhrase: "Belarus",
    governmentType: "onePartyState",
    rulingPartyId: 1, // ruling party seeded first → seq 1 (mirrors CN/RU)
    governmentTypeLabel: "One Party State",
    coalitionThreshold: 181, // Supreme Soviet majority (360 / 2 + 1)
    legislature: {
      name: "Supreme Soviet",
      path: "/country/blr/legislature",
      bicameral: false,
      upperChamber: {
        key: "presidium",
        name: "Presidium",
        shortName: "Presidium",
        seats: 21,
        description:
          "The Presidium of the Supreme Soviet - a standing organ acting between sessions.",
        elected: false,
      },
      lowerChamber: {
        key: "supremeSoviet",
        name: "Supreme Soviet",
        shortName: "Soviet",
        seats: 360,
        description:
          "Deputies of the Byelorussian SSR Supreme Soviet, elected to single-list terms under the Communist Party.",
        elected: true,
      },
    },
    lowerElectionSystem: {
      termYears: 5,
      seatsContested: "all",
      singleMemberConstituencies: true,
      snapElectionsAllowed: false,
    },
    electionSystems: {
      lowerChamber: "fptp",
      headOfGovernment: "parliamentary",
      headOfState: "ceremonial",
    },
    headOfStateSelection: "partyChairSync",
    officeTypes: [
      {
        key: "firstSecretary",
        label: "First Secretary",
        labelPlural: "First Secretaries",
        isExecutive: true,
        isSubNational: false,
        termYears: 5,
        actionBonus: 4,
        partyStrengthWeight: 1.0,
      },
      {
        key: "chairmanOfPresidium",
        label: "Chairman of the Presidium",
        labelPlural: "Chairmen of the Presidium",
        isExecutive: true,
        isHeadOfState: true,
        isSubNational: false,
        actionBonus: 0,
        partyStrengthWeight: 0,
      },
      {
        key: "sovietDeputy",
        label: "Deputy",
        labelPlural: "Deputies",
        chamberKey: "supremeSoviet",
        isExecutive: false,
        isSubNational: false,
        termYears: 5,
        actionBonus: 1,
        partyStrengthWeight: 0.9,
      },
      {
        key: "centralBankChair",
        label: "Gosbank Chair",
        labelPlural: "Gosbank Chairs",
        isExecutive: false,
        isSubNational: false,
        termYears: 6,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],
    majorPartyIds: ["cpb"],
    partyCreationNPPs: { statesRequired: 1, lockHomeState: true, nppsPerState: 2 },
    demographicProfileId: "by_archetypes",
    centralBank: {
      name: "State Bank (Gosbank)",
      abbreviation: "Gosbank",
      chairTitle: "Gosbank Chair",
      defaultPrimeRate: 3.0,
      heroImage: getCountryFlagUrl("BLR"),
    },
    // Command economy: the Byelorussian SSR's republic planning committee,
    // subordinate to all-union Gosplan.
    exchangeName: "GOSPLAN BSSR",
    exchangeKind: "stateRegister",
    usdExchangeRate: 1.35,
    currencyCode: "SUR",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "minister_of_finance",
    status: "coming-soon",
    tagline:
      "A constituent Soviet republic - one-party rule under the Communist Party, on the Soviet ruble.",
    descriptor:
      "A one-party Soviet republic governed by the Communist Party through its Supreme Soviet; a centrally-planned economy on the Soviet ruble.",
    heroImage: getCountryFlagUrl("BLR"),
    entryPath: "/country/blr",
    overviewPath: "/country/blr",
    mapPath: "/country/blr/map",
    executivePath: "/country/blr/executive",
    executiveLabel: "Soviet",
    centralGovernmentLabel: "Central Plan",
  },

  // ── Czechoslovakia (KSČ) ────────────────────────────────────────────────────
  CS: {
    id: "CS",
    name: "Czechoslovakia",
    flagEmoji: "🇨🇿",
    code: "CS",
    socialAxisBaseline: 2.5,
    regionLabel: "Region",
    regionLabelPlural: "Regions",
    executiveTitle: "General Secretary",
    headOfStateTitle: "President of the Republic",
    executiveRealmPhrase: "Czechoslovakia",
    governmentType: "onePartyState",
    rulingPartyId: 1, // ruling party seeded first → seq 1 (mirrors CN/RU)
    governmentTypeLabel: "One Party State",
    coalitionThreshold: 176, // Federal Assembly majority (350 / 2 + 1)
    legislature: {
      name: "Federal Assembly",
      path: "/country/cs/legislature",
      bicameral: false,
      upperChamber: {
        key: "chamberOfNations",
        name: "Chamber of Nations",
        shortName: "Nations",
        seats: 150,
        description:
          "The Chamber of Nations - the federal chamber representing the Czech and Slovak republics.",
        elected: true,
      },
      lowerChamber: {
        key: "chamberOfThePeople",
        name: "Chamber of the People",
        shortName: "People",
        seats: 200,
        description:
          "200 deputies of the Chamber of the People, elected to five-year terms - a single-list body controlled by the ruling communist party within the National Front.",
        elected: true,
      },
    },
    lowerElectionSystem: {
      termYears: 5,
      seatsContested: "all",
      singleMemberConstituencies: true,
      snapElectionsAllowed: false,
    },
    electionSystems: {
      lowerChamber: "fptp",
      headOfGovernment: "parliamentary",
      headOfState: "ceremonial",
    },
    headOfStateSelection: "partyChairSync",
    officeTypes: [
      {
        key: "generalSecretary",
        label: "General Secretary",
        labelPlural: "General Secretaries",
        isExecutive: true,
        isSubNational: false,
        termYears: 5,
        actionBonus: 4,
        partyStrengthWeight: 1.0,
      },
      {
        key: "president",
        label: "President",
        labelPlural: "Presidents",
        isExecutive: true,
        isHeadOfState: true,
        isSubNational: false,
        actionBonus: 0,
        partyStrengthWeight: 0,
      },
      {
        key: "assemblyDeputy",
        label: "Deputy",
        labelPlural: "Deputies",
        chamberKey: "chamberOfThePeople",
        isExecutive: false,
        isSubNational: false,
        termYears: 5,
        actionBonus: 1,
        partyStrengthWeight: 0.9,
      },
      {
        key: "centralBankChair",
        label: "Governor of the SBČS",
        labelPlural: "Governors of the SBČS",
        isExecutive: false,
        isSubNational: false,
        termYears: 6,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],
    majorPartyIds: ["ksc"],
    partyCreationNPPs: { statesRequired: 1, lockHomeState: true, nppsPerState: 2 },
    demographicProfileId: "cs_archetypes",
    centralBank: {
      name: "State Bank of Czechoslovakia",
      abbreviation: "SBČS",
      chairTitle: "Governor of the SBČS",
      defaultPrimeRate: 4.0,
      heroImage: getCountryFlagUrl("CS"),
    },
    // Command economy: Statni planovaci komise, the State Planning Commission.
    exchangeName: "SPK",
    exchangeKind: "stateRegister",
    usdExchangeRate: 0.13,
    currencyCode: "CSK",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "minister_of_finance",
    disallowPrivateCorporationFounding: true, // command economy: no private corp founding (mirrors DD/RU)
    popularMoodProfile: CN_POPULAR_MOOD_PROFILE, // one-party legitimacy drift (mirrors DD/RU/CN)
    status: "coming-soon",
    tagline:
      'An industrialized one-party federation a decade after the crushed Prague Spring - "normalization" Czechoslovakia.',
    descriptor:
      "A one-party socialist federation where the ruling communist party's General Secretary governs through the bicameral Federal Assembly; the economy is centrally planned until reform.",
    heroImage: getCountryFlagUrl("CS"),
    entryPath: "/country/cs",
    overviewPath: "/country/cs",
    mapPath: "/country/cs/map",
    executivePath: "/country/cs/executive",
    executiveLabel: "Assembly",
    centralGovernmentLabel: "Central Plan",
  },

  // ── Ukraine (Ukrainian SSR, KPU) — Soviet ruble ─────────────────────────────
  UKR: {
    id: "UKR",
    name: "Ukraine",
    flagEmoji: "🇺🇦",
    code: "UKR",
    socialAxisBaseline: 2.5,
    regionLabel: "Region",
    regionLabelPlural: "Regions",
    executiveTitle: "First Secretary",
    headOfStateTitle: "Chairman of the Presidium",
    executiveRealmPhrase: "Ukraine",
    governmentType: "onePartyState",
    rulingPartyId: 1, // ruling party seeded first → seq 1 (mirrors CN/RU)
    governmentTypeLabel: "One Party State",
    coalitionThreshold: 218, // Supreme Soviet majority (435 / 2 + 1)
    legislature: {
      name: "Supreme Soviet",
      path: "/country/ua/legislature",
      bicameral: false,
      upperChamber: {
        key: "presidium",
        name: "Presidium",
        shortName: "Presidium",
        seats: 21,
        description:
          "The Presidium of the Supreme Soviet - a standing organ acting between sessions.",
        elected: false,
      },
      lowerChamber: {
        key: "supremeSoviet",
        name: "Supreme Soviet",
        shortName: "Soviet",
        seats: 435,
        description:
          "Deputies of the Ukrainian SSR Supreme Soviet, elected to single-list terms under the Communist Party.",
        elected: true,
      },
    },
    lowerElectionSystem: {
      termYears: 5,
      seatsContested: "all",
      singleMemberConstituencies: true,
      snapElectionsAllowed: false,
    },
    electionSystems: {
      lowerChamber: "fptp",
      headOfGovernment: "parliamentary",
      headOfState: "ceremonial",
    },
    headOfStateSelection: "partyChairSync",
    officeTypes: [
      {
        key: "firstSecretary",
        label: "First Secretary",
        labelPlural: "First Secretaries",
        isExecutive: true,
        isSubNational: false,
        termYears: 5,
        actionBonus: 4,
        partyStrengthWeight: 1.0,
      },
      {
        key: "chairmanOfPresidium",
        label: "Chairman of the Presidium",
        labelPlural: "Chairmen of the Presidium",
        isExecutive: true,
        isHeadOfState: true,
        isSubNational: false,
        actionBonus: 0,
        partyStrengthWeight: 0,
      },
      {
        key: "sovietDeputy",
        label: "Deputy",
        labelPlural: "Deputies",
        chamberKey: "supremeSoviet",
        isExecutive: false,
        isSubNational: false,
        termYears: 5,
        actionBonus: 1,
        partyStrengthWeight: 0.9,
      },
      {
        key: "centralBankChair",
        label: "Gosbank Chair",
        labelPlural: "Gosbank Chairs",
        isExecutive: false,
        isSubNational: false,
        termYears: 6,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],
    majorPartyIds: ["kpu"],
    partyCreationNPPs: { statesRequired: 1, lockHomeState: true, nppsPerState: 2 },
    demographicProfileId: "ua_archetypes",
    centralBank: {
      name: "State Bank (Gosbank)",
      abbreviation: "Gosbank",
      chairTitle: "Gosbank Chair",
      defaultPrimeRate: 3.0,
      heroImage: getCountryFlagUrl("UKR"),
    },
    // Command economy: the Ukrainian SSR's republic planning committee,
    // subordinate to all-union Gosplan. Ukraine is the largest republic economy
    // after the RSFSR, so its plan carries real all-union weight.
    exchangeName: "GOSPLAN URSR",
    exchangeKind: "stateRegister",
    usdExchangeRate: 1.35,
    currencyCode: "SUR",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "minister_of_finance",
    status: "coming-soon",
    tagline:
      "The second republic of the Union - coal, steel and grain under the Communist Party of Ukraine.",
    descriptor:
      "A one-party Soviet republic governed by the Communist Party of Ukraine through its Supreme Soviet; the Union's second economy, built on Donbas coal, Dnieper metallurgy and the grain of the steppe.",
    heroImage: getCountryFlagUrl("UKR"),
    entryPath: "/country/ua",
    overviewPath: "/country/ua",
    mapPath: "/country/ua/map",
    executivePath: "/country/ua/executive",
    executiveLabel: "Soviet",
    centralGovernmentLabel: "Central Plan",
  },

  // ── Baltics (combined EE+LV+LT, CPSU) — Soviet ruble ────────────────────────
  BAL: {
    id: "BAL",
    name: "Baltic Republics",
    flagEmoji: "🏴",
    code: "BAL",
    socialAxisBaseline: 2.0,
    regionLabel: "Republic",
    regionLabelPlural: "Republics",
    executiveTitle: "First Secretary",
    headOfStateTitle: "Chairman of the Presidium",
    executiveRealmPhrase: "the Baltic Republics",
    governmentType: "onePartyState",
    governmentTypeLabel: "One Party State",
    coalitionThreshold: 151, // Supreme Soviet majority (300 / 2 + 1)
    legislature: {
      name: "Supreme Soviet",
      path: "/country/bal/legislature",
      bicameral: false,
      upperChamber: {
        key: "presidium",
        name: "Presidium",
        shortName: "Presidium",
        seats: 21,
        description:
          "The Presidium of the Supreme Soviet - a standing organ acting between sessions.",
        elected: false,
      },
      lowerChamber: {
        key: "supremeSoviet",
        name: "Supreme Soviet",
        shortName: "Soviet",
        seats: 300,
        description:
          "Combined deputies of the Estonian, Latvian and Lithuanian SSR Supreme Soviets, elected to single-list terms under the Communist Party.",
        elected: true,
      },
    },
    lowerElectionSystem: {
      termYears: 5,
      seatsContested: "all",
      singleMemberConstituencies: true,
      snapElectionsAllowed: false,
    },
    electionSystems: {
      lowerChamber: "fptp",
      headOfGovernment: "parliamentary",
      headOfState: "ceremonial",
    },
    headOfStateSelection: "partyChairSync",
    officeTypes: [
      {
        key: "firstSecretary",
        label: "First Secretary",
        labelPlural: "First Secretaries",
        isExecutive: true,
        isSubNational: false,
        termYears: 5,
        actionBonus: 4,
        partyStrengthWeight: 1.0,
      },
      {
        key: "chairmanOfPresidium",
        label: "Chairman of the Presidium",
        labelPlural: "Chairmen of the Presidium",
        isExecutive: true,
        isHeadOfState: true,
        isSubNational: false,
        actionBonus: 0,
        partyStrengthWeight: 0,
      },
      {
        key: "sovietDeputy",
        label: "Deputy",
        labelPlural: "Deputies",
        chamberKey: "supremeSoviet",
        isExecutive: false,
        isSubNational: false,
        termYears: 5,
        actionBonus: 1,
        partyStrengthWeight: 0.9,
      },
      {
        key: "centralBankChair",
        label: "Gosbank Chair",
        labelPlural: "Gosbank Chairs",
        isExecutive: false,
        isSubNational: false,
        termYears: 6,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],
    majorPartyIds: ["cpsu_baltic"],
    partyCreationNPPs: { statesRequired: 1, lockHomeState: true, nppsPerState: 2 },
    demographicProfileId: "bal_archetypes",
    centralBank: {
      name: "State Bank (Gosbank)",
      abbreviation: "Gosbank",
      chairTitle: "Gosbank Chair",
      defaultPrimeRate: 3.0,
      heroImage: getCountryFlagUrl("BAL"),
    },
    // Command economy: the Baltic SSRs' republic-level planning committees,
    // subordinate to all-union Gosplan.
    exchangeName: "GOSPLAN SSR",
    exchangeKind: "stateRegister",
    usdExchangeRate: 1.35,
    currencyCode: "SUR",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "minister_of_finance",
    status: "coming-soon",
    tagline:
      "Estonia, Latvia and Lithuania as constituent Soviet republics - one-party rule on the Soviet ruble.",
    descriptor:
      "The three Baltic Soviet republics, modelled as one playable unit governed by the Communist Party through their Supreme Soviets; a centrally-planned economy on the Soviet ruble.",
    heroImage: getCountryFlagUrl("BAL"),
    entryPath: "/country/bal",
    overviewPath: "/country/bal",
    mapPath: "/country/bal/map",
    executivePath: "/country/bal/executive",
    executiveLabel: "Soviet",
    centralGovernmentLabel: "Central Plan",
  },

  // ── Russia / USSR (RU) — ONE entity; displayed "Soviet Union" in 1979 and
  // "Russia" elsewhere (era name via ERA_COUNTRY_NAMES). Carries the USSR config
  // (one-party / Supreme Soviet / Gosbank / SUR / 17 macro-regions); modern
  // Russia's distinct politics (presidential / Federal Assembly / RUB) and an
  // era-aware flag are a deferred future build. Status stays coming-soon until the
  // seed stack lands; per-game countryGameStates enables it (the 1979 sandbox).
  // RU is already in FOREX_ACTIVE_COUNTRIES (currencies.ts) with SUR as its
  // forex-active currency; the remaining modern-Russia work is the RUB anchor.
  RU: {
    id: "RU",
    name: "Russia",
    flagEmoji: "🇸🇺",
    code: "RU",
    socialAxisBaseline: 3.5,

    regionLabel: "Republic",
    regionLabelPlural: "Republics",

    executiveTitle: "Premier",
    headOfStateTitle: "Chairman of the Presidium",
    executiveRealmPhrase: "the Soviet Union",
    governmentType: "onePartyState",
    // Unlike China, the USSR's constitutional model lets the ruling party move
    // no confidence in the Premier through the Supreme Soviet. The generic
    // one-party default is false, so this exception must be explicit or the
    // route rejects the action even though the legislature renders it.
    confidenceVoteMechanism: true,
    headOfStateSelection: "legislatureAppointment",
    governmentTypeLabel: "One Party State",
    coalitionThreshold: 376, // Soviet of the Union majority (750 / 2 + 1)

    legislature: {
      name: "Supreme Soviet",
      path: "/country/ru/legislature",
      // Soviet of Nationalities modelled as a co-equal, contested upper chamber
      // (bill-active bicameral, the JP/NG sense).
      bicameral: true,
      upperChamber: {
        key: "sovietOfNationalities",
        name: "Soviet of Nationalities",
        shortName: "Nationalities",
        // Contested chamber (D8) — without this the members API treats it as
        // an appointed upper chamber (UK Lords pattern) and returns empty.
        elected: true,
        // D11 republic-weighted total (RU_NATIONALITIES_SEATS sums to 515;
        // it was 640 until Ukraine, Byelorussia and the Baltics became their
        // own countries and took their 125 combined seats with them).
        seats: 515,
        description:
          "Deputies representing the union republics and autonomous republics of the Soviet Union - the nationalities chamber of the Supreme Soviet, seated by republic rather than by population.",
      },
      lowerChamber: {
        key: "sovietOfTheUnion",
        name: "Soviet of the Union",
        shortName: "Union",
        // The real chamber seated 750; 191 of those districts left with
        // Ukraine, Byelorussia and the Baltics. Must equal Σ houseDistricts in
        // ruRegions.ts (seatAllocation tests assert it).
        seats: 559,
        description:
          "559 deputies elected by population to the Supreme Soviet of the USSR; four-year terms, single-list elections under the Communist Party.",
      },
    },

    subNationalChamber: {
      key: "republicSupremeSoviet",
      name: "Republic Supreme Soviet",
      shortName: "Republic Soviet",
      seats: 5000,
      description:
        "The Supreme Soviets of the union republics and the regional Soviets of People's Deputies - the legislative arm of each republic government. Four-year terms.",
      regionalModel: true,
    },

    lowerElectionSystem: {
      termYears: 4,
      seatsContested: "all",
      singleMemberConstituencies: false,
      snapElectionsAllowed: false,
    },
    upperElectionSystem: {
      termYears: 4,
      seatsContested: "all",
      singleMemberConstituencies: false,
      snapElectionsAllowed: false,
    },

    electionSystems: {
      lowerChamber: "fptp",
      subNationalChamber: "fptp",
      headOfGovernment: "parliamentary",
      headOfState: "ceremonial",
    },
    officeTypes: [
      {
        key: "premier",
        label: "Premier",
        labelPlural: "Premiers",
        isExecutive: true,
        isSubNational: false,
        termYears: 4,
        actionBonus: 4,
        partyStrengthWeight: 1.0,
      },
      {
        key: "chairmanOfPresidium",
        label: "Chairman of the Presidium",
        labelPlural: "Chairmen of the Presidium",
        isExecutive: true,
        isHeadOfState: true,
        isSubNational: false,
        actionBonus: 0,
        partyStrengthWeight: 0,
      },
      {
        key: "supremeSovietDeputy",
        label: "Supreme Soviet Deputy",
        labelPlural: "Supreme Soviet Deputies",
        chamberKey: "sovietOfTheUnion",
        isExecutive: false,
        isSubNational: false,
        termYears: 4,
        actionBonus: 1,
        partyStrengthWeight: 0.85,
      },
      {
        key: "nationalitiesDeputy",
        label: "Nationalities Deputy",
        labelPlural: "Nationalities Deputies",
        chamberKey: "sovietOfNationalities",
        isExecutive: false,
        isSubNational: false,
        termYears: 4,
        actionBonus: 1,
        partyStrengthWeight: 0.85,
      },
      {
        key: "republicSupremeSoviet",
        label: "Republic Deputy",
        labelPlural: "Republic Deputies",
        chamberKey: "republicSupremeSoviet",
        isExecutive: false,
        isSubNational: true,
        termYears: 4,
        actionBonus: 1,
        partyStrengthWeight: 0.75,
      },
      {
        key: "governor",
        label: "Republic First Secretary",
        labelPlural: "Republic First Secretaries",
        isExecutive: false,
        isSubNational: true,
        termYears: 4,
        actionBonus: 2,
        partyStrengthWeight: 1.0,
      },
      {
        key: "centralBankChair",
        label: "Chairman of Gosbank",
        labelPlural: "Chairmen of Gosbank",
        isExecutive: false,
        isSubNational: false,
        termYears: 5,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],

    majorPartyIds: ["cpsu"],
    rulingPartyId: 1,
    priorityProfile: DEFAULT_CN_PRIORITY_PROFILE,
    popularMoodProfile: CN_POPULAR_MOOD_PROFILE,
    factionDefectionName: "Reformist Faction of the CPSU",
    collapseTargetSystem: "parliamentaryRepublic",
    collapseTargetAllowlist: ["parliamentaryRepublic", "presidential"],
    legacyReservationDefault: 20,
    electionDelayDefault: 24,
    policyAxisEffects: DEFAULT_POLICY_AXIS_EFFECTS,
    partyCreationNPPs: { statesRequired: 2, lockHomeState: false, nppsPerState: 1 },
    partyRoleLabels: {
      chair: "General Secretary",
      viceChair: "Second Secretary",
      committee: "Politburo",
    },
    demographicProfileId: "su_archetypes",
    hasLeaderConfidenceModel: true,
    mapOverlay: "partyOrg",

    centralBank: {
      name: "State Bank of the USSR",
      abbreviation: "Gosbank",
      chairTitle: "Chairman of Gosbank",
      defaultPrimeRate: 3.0,
      heroImage: getCountryFlagUrl("SU"),
    },

    // Command economy: no bourse. Gosplan, the State Planning Committee, is the
    // register Soviet state enterprises are recorded against.
    exchangeName: "GOSPLAN",
    exchangeKind: "stateRegister",
    usdExchangeRate: 1.35, // 1 ruble ≈ USD 1.35 (1979 official rate)
    currencyCode: "SUR",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "minister_of_finance",

    disallowPrivateCorporationFounding: true,

    status: "coming-soon",
    tagline:
      "The Cold-War superpower - a one-party socialist union of republics governed by the Communist Party from the Kremlin.",
    descriptor:
      "A one-party socialist federation where the Communist Party's General Secretary holds real power, the Premier leads the Council of Ministers, and the Supreme Soviet ratifies across fifteen union republics under a centrally-planned command economy.",
    heroImage: getCountryFlagUrl("SU"),
    entryPath: "/country/ru",
    overviewPath: "/country/ru",
    mapPath: "/country/ru/map",
    executivePath: "/country/ru/executive",
    executiveLabel: "Council of Ministers",
    centralGovernmentLabel: "Central Plan",
  },

  // ── France (Tier-2 Econ-enabled, NPP-run) — Fifth Republic default ─────────
  // Semi-presidential (1958–): a directly-elected President (the dominant
  // executive) plus a Prime Minister and a bicameral Parliament. This is the
  // era-neutral / 1979+ default. The 1953-default Fourth Republic overlay
  // (parliamentary republic, ceremonial President, Conseil de la République)
  // lives in {@link ERA_COUNTRY_CONFIG_OVERRIDES} and is applied via
  // {@link getCountryConfig}(id, preset). Status coming-soon until its seed
  // stack lands; economyPreview enablement set per preset via countryGameStates.
  FR: {
    id: "FR",
    name: "France",
    flagEmoji: "🇫🇷",
    code: "FR",
    socialAxisBaseline: 0,

    regionLabel: "Region",
    regionLabelPlural: "Regions",

    executiveTitle: "President",
    executiveRealmPhrase: "France",
    governmentType: "presidential",
    governmentTypeLabel: "Semi-Presidential Republic",
    coalitionThreshold: 246, // National Assembly majority (491 / 2 + 1)

    legislature: {
      name: "Parliament",
      path: "/country/fr/legislature",
      bicameral: true,
      upperChamber: {
        key: "senat",
        name: "Senate",
        shortName: "Sénat",
        seats: 305,
        description:
          "305 senators elected indirectly by an electoral college of local officials for nine-year terms.",
        elected: true,
      },
      lowerChamber: {
        key: "assembleeNationale",
        name: "National Assembly",
        shortName: "Assemblée",
        seats: 491,
        description:
          "491 deputies elected from single-member constituencies by two-round majority vote for five-year terms.",
        elected: true,
      },
    },

    lowerElectionSystem: {
      termYears: 5,
      seatsContested: "all",
      singleMemberConstituencies: true,
      snapElectionsAllowed: true,
    },
    upperElectionSystem: {
      termYears: 9,
      seatsContested: "all",
      singleMemberConstituencies: false,
      snapElectionsAllowed: false,
    },

    electionSystems: {
      lowerChamber: "pr_hareQuota", // TODO: declared two-round runoff
      upperChamber: "pr_hareQuota", // TODO: declared two-round runoff
      headOfState: "fptp", // TODO: two-round direct presidency (semi-presidential)
    },
    officeTypes: [
      {
        key: "president",
        label: "President",
        labelPlural: "Presidents",
        isExecutive: true,
        isHeadOfState: true,
        isSubNational: false,
        termYears: 7,
        actionBonus: 4,
        partyStrengthWeight: 1.0,
      },
      {
        key: "primeMinister",
        label: "Prime Minister",
        labelPlural: "Prime Ministers",
        isExecutive: true,
        isSubNational: false,
        termYears: 5,
        actionBonus: 3,
        partyStrengthWeight: 1.0,
      },
      {
        key: "deputy",
        label: "Deputy",
        labelPlural: "Deputies",
        chamberKey: "assembleeNationale",
        isExecutive: false,
        isSubNational: false,
        termYears: 5,
        actionBonus: 1,
        partyStrengthWeight: 0.9,
      },
      {
        key: "senator",
        label: "Senator",
        labelPlural: "Senators",
        chamberKey: "senat",
        isExecutive: false,
        isSubNational: false,
        termYears: 9,
        actionBonus: 1,
        partyStrengthWeight: 0.8,
      },
      {
        key: "centralBankChair",
        label: "Governor of the Banque de France",
        labelPlural: "Governors of the Banque de France",
        isExecutive: false,
        isSubNational: false,
        termYears: 6,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],

    majorPartyIds: ["fr_rpr", "fr_ps"],
    partyCreationNPPs: { statesRequired: 2, lockHomeState: false, nppsPerState: 1 },
    demographicProfileId: "fr_archetypes",

    centralBank: {
      name: "Banque de France",
      abbreviation: "BdF",
      chairTitle: "Governor of the Banque de France",
      defaultPrimeRate: 9.5, // late-1970s high rates
      heroImage: getCountryFlagUrl("FR"),
    },

    usdExchangeRate: 0.238, // ~4.2 FRF/USD (1979)
    currencyCode: "FRF",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "minister_of_finance",

    status: "coming-soon",
    tagline:
      "The Fifth Republic - a semi-presidential power where a directly-elected President governs with a Prime Minister and a bicameral Parliament.",
    descriptor:
      "A semi-presidential republic: a directly-elected President leads alongside a Prime Minister answerable to the 491-seat National Assembly, with an indirectly-elected Senate.",
    heroImage: getCountryFlagUrl("FR"),
    entryPath: "/country/fr",
    overviewPath: "/country/fr",
    mapPath: "/country/fr/map",
    executivePath: "/country/fr/executive",
    executiveLabel: "Élysée",
    centralGovernmentLabel: "State Budget",
  },

  // ── Italy (Tier-2 Econ-enabled, NPP-run) — First Republic, 1979 ─────────────
  // Parliamentary republic: a ceremonial President + a Prime Minister governing
  // through a powerful bicameral Parliament (the unstable DC-led coalition era,
  // PCI at its "historic compromise" peak). Status coming-soon until seeded.
  IT: {
    id: "IT",
    name: "Italy",
    flagEmoji: "🇮🇹",
    code: "IT",
    socialAxisBaseline: 1,

    regionLabel: "Region",
    regionLabelPlural: "Regions",

    executiveTitle: "Prime Minister",
    headOfStateTitle: "President",
    executiveRealmPhrase: "Italy",
    governmentType: "parliamentaryRepublic",
    governmentTypeLabel: "Parliamentary Republic",
    coalitionThreshold: 316, // Chamber of Deputies majority (630 / 2 + 1)

    legislature: {
      name: "Parliament",
      path: "/country/it/legislature",
      bicameral: true,
      upperChamber: {
        key: "senato",
        name: "Senate of the Republic",
        shortName: "Senato",
        seats: 315,
        description:
          "315 elected senators (plus a few senators-for-life), elected on a regional basis for five-year terms.",
        elected: true,
      },
      lowerChamber: {
        key: "cameraDeputati",
        name: "Chamber of Deputies",
        shortName: "Camera",
        seats: 630,
        description: "630 deputies elected by proportional representation for five-year terms.",
        elected: true,
      },
    },

    lowerElectionSystem: {
      termYears: 5,
      seatsContested: "all",
      singleMemberConstituencies: false,
      snapElectionsAllowed: true,
    },
    upperElectionSystem: {
      termYears: 5,
      seatsContested: "all",
      singleMemberConstituencies: false,
      snapElectionsAllowed: true,
    },

    electionSystems: {
      lowerChamber: "pr_hareQuota", // TODO: declared PR
      upperChamber: "pr_hareQuota", // TODO: declared PR
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
        termYears: 5,
        actionBonus: 4,
        partyStrengthWeight: 1.0,
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
        chamberKey: "cameraDeputati",
        isExecutive: false,
        isSubNational: false,
        termYears: 5,
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
        termYears: 5,
        actionBonus: 1,
        partyStrengthWeight: 0.8,
      },
      {
        key: "centralBankChair",
        label: "Governor of the Banca d'Italia",
        labelPlural: "Governors of the Banca d'Italia",
        isExecutive: false,
        isSubNational: false,
        termYears: 6,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],

    majorPartyIds: ["it_dc", "it_pci"],
    partyCreationNPPs: { statesRequired: 2, lockHomeState: false, nppsPerState: 1 },
    demographicProfileId: "it_archetypes",

    centralBank: {
      name: "Banca d'Italia",
      abbreviation: "BdI",
      chairTitle: "Governor of the Banca d'Italia",
      defaultPrimeRate: 12.0, // late-1970s Italian rates (high inflation)
      heroImage: getCountryFlagUrl("IT"),
    },

    usdExchangeRate: 0.0012, // ~830 ITL/USD (1979)
    currencyCode: "ITL",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "minister_of_finance",

    status: "coming-soon",
    tagline:
      "The First Republic - a ceremonial President and a fragile Prime Minister governing through a powerful bicameral Parliament, with Europe's largest Communist party in opposition.",
    descriptor:
      "A parliamentary republic where a Prime Minister governs at the confidence of a 630-seat Chamber and a 315-seat Senate, amid the unstable DC-led coalitions of the historic-compromise era.",
    heroImage: getCountryFlagUrl("IT"),
    entryPath: "/country/it",
    overviewPath: "/country/it",
    mapPath: "/country/it/map",
    executivePath: "/country/it/executive",
    executiveLabel: "Palazzo Chigi",
    centralGovernmentLabel: "State Budget",
  },

  // ── Spain (Tier-2 Econ-enabled, NPP-run) — the young democracy, 1979 ────────
  // Parliamentary monarchy under the 1978 Constitution: King Juan Carlos as head
  // of state, a Prime Minister governing through the Cortes Generales, and the
  // autonomous communities just forming. Status coming-soon until seeded.
  ES: {
    id: "ES",
    name: "Spain",
    flagEmoji: "🇪🇸",
    code: "ES",
    socialAxisBaseline: 1,

    regionLabel: "Autonomous Community",
    regionLabelPlural: "Autonomous Communities",

    executiveTitle: "Prime Minister",
    headOfStateTitle: "King",
    executiveRealmPhrase: "Spain",
    governmentType: "parliamentaryMonarchy",
    governmentTypeLabel: "Parliamentary Monarchy",
    coalitionThreshold: 176, // Congress majority (350 / 2 + 1)

    legislature: {
      name: "Cortes Generales",
      path: "/country/es/legislature",
      bicameral: true,
      upperChamber: {
        key: "senado",
        name: "Senate",
        shortName: "Senado",
        seats: 208,
        description:
          "208 senators elected on a provincial basis (plus regional appointees) for four-year terms.",
        elected: true,
      },
      lowerChamber: {
        key: "congresoDiputados",
        name: "Congress of Deputies",
        shortName: "Congreso",
        seats: 350,
        description:
          "350 deputies elected by proportional representation (D'Hondt) in provincial constituencies for four-year terms.",
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
      termYears: 4,
      seatsContested: "all",
      singleMemberConstituencies: false,
      snapElectionsAllowed: true,
    },

    electionSystems: {
      lowerChamber: "pr_hareQuota", // TODO: declared D'Hondt PR
      upperChamber: "pr_hareQuota", // TODO: declared PR
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
        partyStrengthWeight: 1.0,
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
        key: "deputy",
        label: "Deputy",
        labelPlural: "Deputies",
        chamberKey: "congresoDiputados",
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
        chamberKey: "senado",
        isExecutive: false,
        isSubNational: false,
        termYears: 4,
        actionBonus: 1,
        partyStrengthWeight: 0.8,
      },
      {
        key: "centralBankChair",
        label: "Governor of the Banco de España",
        labelPlural: "Governors of the Banco de España",
        isExecutive: false,
        isSubNational: false,
        termYears: 6,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],

    majorPartyIds: ["es_ucd", "es_psoe"],
    partyCreationNPPs: { statesRequired: 2, lockHomeState: false, nppsPerState: 1 },
    demographicProfileId: "es_archetypes",

    centralBank: {
      name: "Banco de España",
      abbreviation: "BdE",
      chairTitle: "Governor of the Banco de España",
      defaultPrimeRate: 14.0, // late-1970s Spanish rates (transition inflation)
      heroImage: getCountryFlagUrl("ES"),
    },

    usdExchangeRate: 0.0149, // ~67 ESP/USD (1979)
    currencyCode: "ESP",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "minister_of_finance",

    status: "coming-soon",
    tagline:
      "The young democracy - a restored monarchy, a fragile centrist government, and a country building its autonomous communities barely four years after Franco.",
    descriptor:
      "A parliamentary monarchy under the 1978 Constitution: a Prime Minister governs at the confidence of a 350-seat Congress and a 208-seat Senate, as Spain devolves power to its new autonomous communities.",
    heroImage: getCountryFlagUrl("ES"),
    entryPath: "/country/es",
    overviewPath: "/country/es",
    mapPath: "/country/es/map",
    executivePath: "/country/es/executive",
    executiveLabel: "Moncloa",
    centralGovernmentLabel: "State Budget",
  },

  // ── Sweden (Tier-2 Econ-enabled, NPP-run) — the Swedish model, 1979 ─────────
  // Constitutional monarchy with a unicameral Riksdag (349 seats since the 1970
  // reform). In 1979 a non-socialist coalition governs with the Social Democrats
  // the largest party in opposition. Status coming-soon until seeded.
  SE: {
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
    coalitionThreshold: 175, // Riksdag majority (349 / 2 + 1)

    legislature: {
      name: "Riksdag",
      path: "/country/se/legislature",
      bicameral: false, // unicameral since the 1970 reform
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
      termYears: 3, // three-year terms until 1994
      seatsContested: "all",
      singleMemberConstituencies: false,
      snapElectionsAllowed: false,
    },
    upperElectionSystem: undefined,

    electionSystems: {
      lowerChamber: "pr_hareQuota", // TODO: declared PR
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
        partyStrengthWeight: 1.0,
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
    partyCreationNPPs: { statesRequired: 2, lockHomeState: false, nppsPerState: 1 },
    demographicProfileId: "se_archetypes",

    centralBank: {
      name: "Sveriges Riksbank",
      abbreviation: "Riksbank",
      chairTitle: "Governor of the Riksbank",
      defaultPrimeRate: 9.0, // late-1970s Swedish rates
      heroImage: getCountryFlagUrl("SE"),
    },

    usdExchangeRate: 0.233, // ~4.3 SEK/USD (1979)
    currencyCode: "SEK",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "minister_of_finance",

    status: "coming-soon",
    tagline:
      "The Swedish model - a generous welfare state and powerful unions, where a non-socialist coalition now governs with the long-dominant Social Democrats in opposition.",
    descriptor:
      "A constitutional monarchy with a unicameral 349-seat Riksdag elected by proportional representation, home to the world's most developed social-democratic welfare state.",
    heroImage: getCountryFlagUrl("SE"),
    entryPath: "/country/se",
    overviewPath: "/country/se",
    mapPath: "/country/se/map",
    executivePath: "/country/se/executive",
    executiveLabel: "Rosenbad",
    centralGovernmentLabel: "State Budget",
  },

  // ── Turkey (Tier-2 Econ-enabled, NPP-run) — fragile pre-coup republic, 1979 ─
  // Parliamentary republic: a ceremonial President + a Prime Minister governing
  // through a bicameral parliament, amid the unstable AP/CHP coalitions and street
  // violence of the late 1970s (a year before the September 1980 coup). Status
  // coming-soon until seeded.
  //
  // Era note: the 1961-constitution Senato below is correct for 1979-default.
  // 1953-default overrides to a unicameral TBMM via {@link ERA_COUNTRY_CONFIG_OVERRIDES}
  // (no Senate existed until after the 1960 coup).
  TR: {
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
    coalitionThreshold: 226, // Grand National Assembly majority (450 / 2 + 1)

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
      lowerChamber: "pr_hareQuota", // TODO: declared D'Hondt PR
      upperChamber: "pr_hareQuota", // TODO: declared PR
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
        partyStrengthWeight: 1.0,
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
    partyCreationNPPs: { statesRequired: 2, lockHomeState: false, nppsPerState: 1 },
    demographicProfileId: "tr_archetypes",

    centralBank: {
      name: "Central Bank of the Republic of Turkey",
      abbreviation: "TCMB",
      chairTitle: "Governor of the Central Bank of Turkey",
      defaultPrimeRate: 20.0, // late-1970s Turkish crisis inflation
      heroImage: getCountryFlagUrl("TR"),
    },

    usdExchangeRate: 0.029, // ~35 TRL/USD (1979)
    currencyCode: "TRL",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "minister_of_finance",

    status: "coming-soon",
    tagline:
      "A republic on the brink - fragile coalitions, economic crisis and political violence in the year before the 1980 coup, balanced between secular Kemalism and rising religious and nationalist movements.",
    descriptor:
      "A parliamentary republic where a Prime Minister governs at the confidence of a 450-seat National Assembly and a 184-seat Senate, amid the unstable AP/CHP coalitions of the late 1970s.",
    heroImage: getCountryFlagUrl("TR"),
    entryPath: "/country/tr",
    overviewPath: "/country/tr",
    mapPath: "/country/tr/map",
    executivePath: "/country/tr/executive",
    executiveLabel: "Çankaya",
    centralGovernmentLabel: "State Budget",
  },

  // ── Greece (econ-tier democracy; Third Hellenic Republic) — 1979 base ──────
  GR: {
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
    coalitionThreshold: 151, // Vouli majority (300 / 2 + 1)

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
      lowerChamber: "pr_hareQuota", // TODO: declared reinforced PR
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
        partyStrengthWeight: 1.0,
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
    partyCreationNPPs: { statesRequired: 2, lockHomeState: false, nppsPerState: 1 },
    demographicProfileId: "gr_archetypes",

    centralBank: {
      name: "Bank of Greece",
      abbreviation: "BoG",
      chairTitle: "Governor of the Bank of Greece",
      defaultPrimeRate: 16.5, // late-1970s drachma inflation regime
      heroImage: getCountryFlagUrl("GR"),
    },

    usdExchangeRate: 0.027, // ~37 GRD/USD (1979)
    currencyCode: "GRD",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "minister_of_finance",

    status: "coming-soon",
    tagline:
      "A restored democracy finding its feet — Karamanlis's republic between NATO, an EEC accession course, and PASOK's rising challenge, with the junta years still a fresh memory.",
    descriptor:
      "A parliamentary republic where a Prime Minister governs at the confidence of the unicameral 300-seat Vouli, elected by reinforced proportional representation.",
    heroImage: getCountryFlagUrl("GR"),
    entryPath: "/country/gr",
    overviewPath: "/country/gr",
    mapPath: "/country/gr/map",
    executivePath: "/country/gr/executive",
    executiveLabel: "Maximos Mansion",
    centralGovernmentLabel: "State Budget",
  },

  // ── Austria (econ-tier democracy; Second Republic) — 1979 base ─────────────
  AT: {
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
    coalitionThreshold: 92, // Nationalrat majority (183 / 2 + 1)

    legislature: {
      name: "Nationalrat",
      path: "/country/at/legislature",
      // Bundesrat is delegated by the Landtage, not part of the player
      // legislative loop — same treatment as the DE Bundesrat.
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
        partyStrengthWeight: 1.0,
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
    partyCreationNPPs: { statesRequired: 2, lockHomeState: false, nppsPerState: 1 },
    demographicProfileId: "at_archetypes",

    centralBank: {
      name: "Oesterreichische Nationalbank",
      abbreviation: "OeNB",
      chairTitle: "Governor of the Oesterreichische Nationalbank",
      defaultPrimeRate: 5.5, // hard-schilling DM shadow
      heroImage: getCountryFlagUrl("AT"),
    },

    usdExchangeRate: 0.075, // ~13.4 ATS/USD (1979)
    currencyCode: "ATS",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "minister_of_finance",

    status: "coming-soon",
    tagline:
      "Kreisky's neutral social democracy at its zenith — an absolute SPÖ majority, Austro-Keynesian full employment, the hard schilling, and active bridge-building between the blocs from a permanently neutral Vienna.",
    descriptor:
      "A parliamentary republic where a Chancellor governs at the confidence of the unicameral 183-seat Nationalrat; constitutionally neutral since 1955 and outside both alliances.",
    heroImage: getCountryFlagUrl("AT"),
    entryPath: "/country/at",
    overviewPath: "/country/at",
    mapPath: "/country/at/map",
    executivePath: "/country/at/executive",
    executiveLabel: "Ballhausplatz",
    centralGovernmentLabel: "Federal Budget",
  },

  FI: {
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
    coalitionThreshold: 101, // Eduskunta majority (200 / 2 + 1)

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
        partyStrengthWeight: 1.0,
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
    partyCreationNPPs: { statesRequired: 2, lockHomeState: false, nppsPerState: 1 },
    demographicProfileId: "fi_archetypes",

    centralBank: {
      name: "Bank of Finland",
      abbreviation: "BoF",
      chairTitle: "Governor of the Bank of Finland",
      defaultPrimeRate: 8.5, // Bank of Finland base rate, devaluation-cycle economy
      heroImage: getCountryFlagUrl("FI"),
    },

    usdExchangeRate: 0.256, // ~3.9 FIM/USD (1979)
    currencyCode: "FIM",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "minister_of_finance",

    status: "coming-soon",
    tagline:
      "Kekkonen's balancing act — a neutral Nordic democracy trading both ways across the Iron Curtain, multiparty coalitions under a dominant president, and the forest economy that pays for the welfare state.",
    descriptor:
      "A parliamentary republic where a Prime Minister governs at the confidence of the unicameral 200-seat Eduskunta, under a strong presidency that steers foreign policy between East and West.",
    heroImage: getCountryFlagUrl("FI"),
    entryPath: "/country/fi",
    overviewPath: "/country/fi",
    mapPath: "/country/fi/map",
    executivePath: "/country/fi/executive",
    executiveLabel: "Government Palace",
    centralGovernmentLabel: "State Budget",
  },

  // ── East Germany / GDR (NPP-run one-party state; two-state Germany) — 1979 ──
  // SED-led socialist republic with the National Front bloc parties and a planned
  // economy. Player-enabled only via the economy if it decommunises;
  // collapseTargetSystem routes a collapse toward reunification/democracy. Status
  // coming-soon until seeded.
  DD: {
    id: "DD",
    name: "East Germany",
    // Unicode has no GDR flag. 🇩🇪 is West Germany's, and using it made the GDR
    // render as "DE" wherever an unassigned regional-indicator pair falls back
    // to its letters. 🇩🇩 is unassigned too, so it renders as "DD" — the
    // country's own code, the same way the USSR relies on 🇸🇺 above.
    flagEmoji: "🇩🇩",
    code: "DD",
    socialAxisBaseline: 2,

    regionLabel: "Region",
    regionLabelPlural: "Regions",

    executiveTitle: "General Secretary",
    headOfStateTitle: "Chairman of the Council of State",
    executiveRealmPhrase: "the German Democratic Republic",
    governmentType: "onePartyState",
    rulingPartyId: 1, // ruling party seeded first → seq 1 (mirrors CN/RU)
    governmentTypeLabel: "One Party State",
    coalitionThreshold: 251, // Volkskammer majority (500 / 2 + 1)

    legislature: {
      name: "Volkskammer",
      path: "/country/dd/legislature",
      bicameral: false,
      upperChamber: {
        key: "staatsrat",
        name: "Council of State",
        shortName: "Staatsrat",
        seats: 25,
        description:
          "The Staatsrat - a collective head of state exercising standing authority between Volkskammer sessions.",
        elected: false,
      },
      lowerChamber: {
        key: "volkskammer",
        name: "People's Chamber",
        shortName: "Volkskammer",
        seats: 500,
        description:
          "500 deputies of the Volkskammer elected on the single National Front list, led by the ruling SED.",
        elected: true,
      },
    },

    // Land assemblies — the legislative arm each Land First Secretary needs to
    // queue/pass state bills through (mirrors RU republicSupremeSoviet / CN
    // peoplesCongress). Key is `landAssembly` (not DE's `landtag`) so DE's
    // Sainte-Laguë Landtag resolver never claims DD races. Seat totals come
    // from each region's `stateSenateSeats` (sum = 80 across the six Länder).
    subNationalChamber: {
      key: "landAssembly",
      name: "Landtag",
      shortName: "Landtag",
      seats: 80,
      description:
        "The Landtage of the GDR's eastern Länder — the legislative arm of each Land government under the SED First Secretary. Four-year terms on the Volkskammer cycle.",
      regionalModel: true,
    },

    lowerElectionSystem: {
      termYears: 5,
      seatsContested: "all",
      singleMemberConstituencies: true,
      snapElectionsAllowed: false,
    },

    electionSystems: {
      lowerChamber: "fptp",
      // One-party National Front list per Land — same shape as RU republic soviets.
      subNationalChamber: "pr_hareQuota",
      subNationalExecutive: "fptp",
      headOfGovernment: "parliamentary",
      headOfState: "ceremonial",
    },
    headOfStateSelection: "partyChairSync",
    officeTypes: [
      {
        key: "generalSecretary",
        label: "General Secretary",
        labelPlural: "General Secretaries",
        isExecutive: true,
        isSubNational: false,
        termYears: 5,
        actionBonus: 4,
        partyStrengthWeight: 1.0,
      },
      {
        key: "chairmanOfStateCouncil",
        label: "Chairman of the Council of State",
        labelPlural: "Chairmen of the Council of State",
        isExecutive: true,
        isHeadOfState: true,
        isSubNational: false,
        actionBonus: 0,
        partyStrengthWeight: 0,
      },
      {
        key: "volkskammerDeputy",
        label: "Deputy",
        labelPlural: "Deputies",
        chamberKey: "volkskammer",
        isExecutive: false,
        isSubNational: false,
        termYears: 5,
        actionBonus: 1,
        partyStrengthWeight: 0.9,
      },
      {
        key: "landAssembly",
        label: "Landtag Deputy",
        labelPlural: "Landtag Deputies",
        chamberKey: "landAssembly",
        isExecutive: false,
        isSubNational: true,
        termYears: 4,
        actionBonus: 1,
        partyStrengthWeight: 0.75,
      },
      {
        key: "governor",
        label: "Land First Secretary",
        labelPlural: "Land First Secretaries",
        isExecutive: false,
        isSubNational: true,
        termYears: 4,
        actionBonus: 2,
        partyStrengthWeight: 1.0,
      },
      {
        key: "centralBankChair",
        label: "President of the Staatsbank",
        labelPlural: "Presidents of the Staatsbank",
        isExecutive: false,
        isSubNational: false,
        termYears: 6,
        actionBonus: 3,
        partyStrengthWeight: 0,
      },
    ],

    majorPartyIds: ["sed"],
    partyCreationNPPs: { statesRequired: 1, lockHomeState: true, nppsPerState: 2 },
    partyRoleLabels: {
      chair: "General Secretary",
      viceChair: "Second Secretary",
      committee: "Politburo",
    },
    demographicProfileId: "dd_archetypes",
    // One-party regime stack, at RU/CN parity. Without these the DDR seeds as a
    // one-party state whose leader faces no internal-confidence pressure: the
    // drift kernel needs `priorityProfile`, Stage 3 needs `factionDefectionName`,
    // and both the nationalization consequence branches and the executive hub's
    // confidence panel gate on `hasLeaderConfidenceModel`.
    hasLeaderConfidenceModel: true,
    priorityProfile: DEFAULT_CN_PRIORITY_PROFILE,
    policyAxisEffects: DEFAULT_POLICY_AXIS_EFFECTS,
    factionDefectionName: "Reform Wing of the SED",
    legacyReservationDefault: 20,
    electionDelayDefault: 24,
    mapOverlay: "partyOrg",
    // `collapseTargetAllowlist` is deliberately unset: the convention path falls
    // back to [collapseTargetSystem], and the DDR's only collapse target is the
    // parliamentary republic (reunification), not RU's wider presidential option.

    centralBank: {
      name: "Staatsbank der DDR",
      abbreviation: "SBD",
      chairTitle: "President of the Staatsbank",
      defaultPrimeRate: 5.0,
      heroImage: getCountryFlagUrl("DD"),
    },

    // Command economy: no bourse. The VVB (Vereinigung Volkseigener Betriebe)
    // grouped the people's-owned enterprises, so it stands in as the register
    // that DDR state enterprises are listed against.
    exchangeName: "VVB",
    exchangeKind: "stateRegister",
    usdExchangeRate: 0.45, // official Mark der DDR rate (administered)
    currencyCode: "DDM",
    fiscalYearStartTurnInYear: 40,
    financeMinisterCabinetId: "minister_of_finance",
    collapseTargetSystem: "parliamentaryRepublic", // reunification / democratisation path

    disallowPrivateCorporationFounding: true, // command economy: no private corp founding (mirrors USSR)
    popularMoodProfile: CN_POPULAR_MOOD_PROFILE, // one-party legitimacy drift (mirrors USSR/China)

    /**
     * DD funds its Länder the way the German model does — a share of the
     * national income tax and VAT collected in-territory, the per-Land trade
     * tax, and this equalization pool on top — NOT by the one-party central
     * transfer CN uses.
     *
     * That is a structural constraint, not a preference. The one-party model's
     * only regional revenue term is
     * `localTaxRetentionShare x corporateProfitRatio x regionGdp x <primary tax
     * rate>`, and DD's primary tax is `dd.tax.domesticCorporateTax`, authored at
     * 0% because DD collects enterprise surplus through `otherRevenue` and the
     * product levy instead. Zero times anything funds nothing: DD's Länder carry
     * ~1390/capita of enacted programmes, so all eleven western Länder would
     * have sat ~10x over budget permanently and the austerity path would have
     * stripped a policy tier from each of them every single turn (#1323).
     *
     * 100/capita matches both the pool already sitting in the live data
     * (DDM 8.0B across 81M people) and DE's own 1953-era override, so unfreezing
     * the Länder does not silently re-scale the transfer at the same time.
     */
    federalEqualizationGrantPerCapita: 100,

    status: "coming-soon",
    tagline:
      "The other Germany - a hard-line SED state and Warsaw-Pact linchpin, its planned economy and Wall holding back the pull of the West.",
    descriptor:
      "A one-party socialist republic where the SED General Secretary governs through the National Front and the Volkskammer; the economy is centrally planned until reform or reunification.",
    heroImage: getCountryFlagUrl("DD"),
    entryPath: "/country/dd",
    overviewPath: "/country/dd",
    mapPath: "/country/dd/map",
    executivePath: "/country/dd/executive",
    executiveLabel: "Council of Ministers",
    centralGovernmentLabel: "Central Plan",
  },
};

/** Ordered list of countries for the world map (active first, then beta, then coming-soon). */
/**
 * The canonical registered-country list — every country that "exists" for players,
 * the base set the access layer (`getEnabledCountryIds`, `getAllCountryAccess`,
 * `getEconomyVisibleCountryIds`) filters from. Iterate THIS, not
 * `Object.keys(COUNTRY_CONFIGS)`, at any site that drives pickers, seeding, turn
 * processing, or data APIs — so latent secession countries (SCO/WAL), which are in
 * `COUNTRY_CONFIGS` for type safety but absent here, stay invisible and stateless
 * until the secession actuation (SP2) registers them.
 *
 * The 1979 Cold-War countries (HU/PL/RO/YU/BG/BLR/CS/BAL/SU/FR/IT/ES/SE/TR/DD) ARE
 * registered (real configs + seed data, gated per-preset by countryGameStates),
 * so they belong here — unlike the latent SCO/WAL.
 */
export const COUNTRY_ORDER: CountryId[] = [
  "US",
  "UK",
  "JP",
  "DE",
  "IE",
  "BR",
  "CN",
  "NG",
  "HU",
  "PL",
  "RO",
  "YU",
  "BG",
  "CS",
  "RU",
  "FR",
  "IT",
  "ES",
  "SE",
  "TR",
  "GR",
  "AT",
  "FI",
  "DD",
];

/**
 * Presidential countries that run their own bespoke presidential-election engine
 * (national popular vote + spread + run-off) rather than the US electoral-college
 * engine. Once such a country is active, its President is ELECTED, so the
 * NPP-autonomy appointment fallback (`appointNppPresident`) must skip it.
 * While still `coming-soon` the appointment fallback still supplies a governing
 * brain (the election cycle is gated off until activation).
 */
export const COUNTRIES_WITH_BESPOKE_PRESIDENTIAL_ELECTIONS = new Set<CountryId>(["NG"]);

/**
 * Countries whose President is chosen by a LIVE election cycle rather than by
 * appointment. Superset of the bespoke set above: the US president is elected
 * through the electoral-college engine — `ensurePerpetualElections` anchors the
 * national president race to the preset's `president` cycle year (see
 * `CANONICAL_REAL_ELECTION_YEARS_BY_PRESET`) and writes `countryId: "US"`.
 *
 * The NPP-autonomy appointment fallback (`appointNppPresident`) must skip these
 * countries once active: a presidential vacancy there belongs to the election
 * engine, not to a party-blind favorability appointment. This matches prod,
 * where the US executive is only ever seated by `seatPresidentialExecutive`
 * (election resolution) — the appointment fallback never runs for the US on
 * prod because the v1 autonomy gate is false in player-enabled countries.
 */
export const COUNTRIES_WITH_PRESIDENTIAL_ELECTION_CYCLES = new Set<CountryId>([
  "US",
  ...COUNTRIES_WITH_BESPOKE_PRESIDENTIAL_ELECTIONS,
]);

/**
 * Countries that hold all national + regional offices in ONE concurrent general
 * election on a single multi-year cycle (vs the US staggered calendar). Their
 * president/house/senate/governor races all anchor to `ngGeneral` (see
 * `canonicalTurnsForCycle`), matching Nigeria's real concurrent 4-year cycle.
 */
export const COUNTRIES_WITH_CONCURRENT_GENERAL_ELECTIONS = new Set<CountryId>(["NG"]);

/**
 * Every configured CountryId, including latent secession countries (SCO/WAL).
 * This is the VALIDATION universe — request schemas accept any structurally-valid
 * country id; whether a country is registered/playable is decided at runtime by the
 * access layer (`getEnabledCountryIds`) + `getRegisteredCountryIds`, NOT by the Zod
 * enum (which is built once at module load and cannot be runtime-aware).
 */
export const ALL_COUNTRY_IDS: readonly CountryId[] = Object.keys(COUNTRY_CONFIGS) as CountryId[];

/**
 * Tuple for Zod `z.enum()` validation — the full id universe (see ALL_COUNTRY_IDS).
 * Iteration / display / gating use `getRegisteredCountryIds` + the access layer, not this.
 */
export const ZOD_COUNTRY_ENUM = ALL_COUNTRY_IDS as unknown as [
  CountryId,
  CountryId,
  ...CountryId[],
];

/**
 * The two originally shipped countries — used for admin tools that are not yet generalized
 * (dual seed scope, sovereign debt issuer, some legacy cabinet flows). Prefer these constants
 * over string literals `"US"` / `"UK"` in application code.
 */
/** Narrow literal pair — `CountryConfig.id` is typed as `CountryId`, so we name the subset explicitly. */
export type UsUkCountryId = Extract<CountryId, "US" | "UK">;

export const US_UK_COUNTRY_IDS: readonly UsUkCountryId[] = ["US", "UK"];

/** Countries participating in the Eurozone currency union.
 *  All members must enact an EuroAdoptionProvision bill for
 *  gameState.eurozoneEnabled to flip true. UK is excluded — it never
 *  historically adopted EUR. */
export const EU_EUROZONE_MEMBERS: CountryId[] = ["DE", "IE"];

/** Default `countryId` when legacy documents omit it (historically US-only Congress). */
export const DEFAULT_LEGACY_COUNTRY_ID = COUNTRY_CONFIGS.US.id;

/**
 * Countries whose region `_id`s are country-prefixed (`HU_BUD`, `FR_IDF`, …).
 *
 * Region ids live in ONE global namespace — `states._id` is the primary key of
 * a shared collection, and stateMetrics/stateBaselines/macroMetrics/seat
 * records key by the same scalar — so the 1979-era countries encode the
 * composite {country, region} identity into the id itself (ISO-3166-2 style:
 * "US-AL", "HU-BU"). The legacy countries (US/UK/DE/JP/…) predate the
 * collision problem and keep bare codes ("AL", "SCO", "BW").
 *
 * Player-facing URLs hide the prefix (`/country/hu/region/BUD`):
 * {@link compactRegionCode} strips it when building links and
 * {@link canonicalRegionId} restores it when resolving route params. Both are
 * no-ops for legacy countries and for already-canonical input, so full-id URLs
 * keep working.
 */
const PREFIXED_REGION_ID_COUNTRIES: ReadonlySet<CountryId> = new Set<CountryId>([
  "FR",
  "IT",
  "ES",
  "SE",
  "TR",
  "GR",
  "AT",
  "FI",
  "HU",
  "PL",
  "RO",
  "YU",
  "BG",
  "CS",
  "BLR",
  "UKR",
  "BAL",
]);

/** The short, player-facing form of a region id ("HU_BUD" → "BUD"). */
export function compactRegionCode(countryId: CountryId | string, regionId: string): string {
  const prefix = `${countryId}_`;
  return PREFIXED_REGION_ID_COUNTRIES.has(countryId as CountryId) && regionId.startsWith(prefix)
    ? regionId.slice(prefix.length)
    : regionId;
}

/** The canonical stored region id for a URL param ("BUD" → "HU_BUD"). */
export function canonicalRegionId(countryId: CountryId | string, regionParam: string): string {
  const prefix = `${countryId}_`;
  return PREFIXED_REGION_ID_COUNTRIES.has(countryId as CountryId) && !regionParam.startsWith(prefix)
    ? `${prefix}${regionParam}`
    : regionParam;
}

/**
 * Institutional fields that may diverge by historical era for the same
 * CountryId (e.g. France's Fourth → Fifth Republic, Turkey's unicameral
 * 1953 TBMM). Applied as a shallow merge over {@link COUNTRY_CONFIGS} by
 * {@link getCountryConfig} when a preset is supplied. Nested objects
 * (`legislature`, `officeTypes`, …) are replaced wholesale when present —
 * do not partial-patch nested trees here. Same shape as seedDE/seedIE
 * `eraOverride` objects.
 */
export type EraCountryConfigOverride = Partial<
  Pick<
    CountryConfig,
    | "executiveTitle"
    | "headOfStateTitle"
    | "governmentType"
    | "governmentTypeLabel"
    | "coalitionThreshold"
    | "legislature"
    | "lowerElectionSystem"
    | "upperElectionSystem"
    | "electionSystems"
    | "officeTypes"
    | "tagline"
    | "descriptor"
    | "executiveLabel"
    | "regionLabel"
    | "regionLabelPlural"
    | "rulingPartyId"
    | "majorPartyIds"
    | "usdExchangeRate"
    | "onePartyRegionalBudget"
    | "federalEqualizationGrantPerCapita"
  >
>;

/**
 * Per-era institutional overlays. Mirrors {@link ERA_COUNTRY_NAMES}: the base
 * entry in {@link COUNTRY_CONFIGS} stays the era-neutral / later-era default;
 * presets that need a different government model merge an override at read time.
 *
 * TR 1953: 1950s Turkey had a unicameral Grand National Assembly (TBMM). The
 * Cumhuriyet Senatosu was created by the 1961 constitution (post-1960 coup) and
 * belongs only to 1979-default. Seat count 487 = 1950 general election TBMM size
 * (YSK / Nohlen, Grotz & Hartmann, Elections in Asia Vol. I); matches
 * `trRegions1953` houseDistricts sum. (1954 election expanded to 541.)
 *
 * FR 1953: Fourth Republic (1946–1958). Ceremonial President elected by
 * Parliament; real executive is the Président du Conseil (President of the
 * Council) answerable to the Assemblée Nationale. Closest in-tree pattern is
 * Italy's parliamentaryRepublic (ceremonial president + PM first in officeTypes).
 * Chamber keys stay `assembleeNationale` / `senat` so election types and office
 * mappings remain stable; only display names and seat counts change.
 *
 * ES 1953: Franco's one-party dictatorship. Closest in-tree pattern is DD —
 * a single executive who is also head of state (no separate ceremonial HoS
 * office / partyChairSync; Franco personally held both Jefe del Estado and
 * head of government until 1973). Legislature is the unicameral Cortes
 * Españolas (1942 Ley de Cortes) — corporatist / appointed "organic democracy"
 * (syndicates, municipalities, families, direct appointment), modelled with
 * `elected: false` like HU/PL appointed upper councils. Chamber key stays
 * `congresoDiputados` so the null-gated `esCongreso` cycle mapping remains
 * stable. Seat count 350 matches `esRegions1953` houseDistricts sum.
 * `rulingPartyId: 1` = FET (sole 1953 party, seeded first → seq 1).
 *
 * SE 1953: Bicameral Riksdag (Första + Andra kammaren) until the 1970 reform.
 * Modelled on the IE Seanad / UK Lords pattern: upper chamber is real for seat
 * counts and revise/delay flavour, but `bicameral: false` so it is NOT part of
 * the player bill loop (no perpetual First Chamber elections). Seat counts
 * match `seRegions1953` (Andra 230 via houseDistricts; Första 150 via
 * stateSenateSeats — not the base config's 151, which is abolished-era metadata).
 * Chamber key `riksdag` stays stable for the election engine.
 *
 * 1953 `usdExchangeRate` (refs the 1953 economy calibration): this field is the
 * ₳ value of ONE unit of the country's stored seed currency — it is what
 * normalizes `state.gdp` and the national budget seed into the shared ₳ anchor,
 * and the ₳ anchor tracks the US dollar of the era. The base entries in
 * {@link COUNTRY_CONFIGS} are modern (US/UK/DE/IE pinned at 1.0, JP 0.00943, …)
 * or, for the Cold-War-only roster, 1979 rates — both wrong for a 1953 world,
 * where every rate must be the reciprocal of `INITIAL_RATES_1953`
 * (constants/currencies.ts), the same table `seedExchangeRates` writes into the
 * `exchangeRates` collection. Left unfixed, the seeder and the forex collection
 * disagreed by up to 83x (FR) and the 1953 world's ₳ GDP ranking was fiction:
 * France read as a $3.9T economy and the USSR $1.9T against a $387B United
 * States, while Turkey read $0.7B and the UK $14.4B.
 *
 * IT/JP/CN/NG deliberately stay at 1.0: their 1953 regional GDP is authored in
 * **USD millions** (refs #3498 — see the header of each `*Regions1953.ts`), so
 * they are already ₳-denominated and a rate of 1.0 IS their era-correct
 * normalization. Do not "fix" them to 1/INITIAL_RATES_1953 — that would read
 * Italy as a $27M economy.
 *
 * HU/PL/RO/YU/BG/CS now have authored 1953 rates too (refs #3778 §1). They stay
 * OUT of `FOREX_ACTIVE_COUNTRIES` — `seedExchangeRates` still writes no
 * `exchangeRates` row for them and they remain budget-only, non-convertible
 * economies. Only the config-side GDP→₳ normalization is authored, sourced from
 * `INITIAL_RATES_1953` like every entry above; the per-country reasoning (which
 * official parity each rate departs from, and why) lives on those constants.
 * Before this, the base config's 1979 rates read Bulgaria as a $40B economy —
 * larger than West Germany.
 *
 * Seat-count-only overlays (UK/IT/DE/JP/IE/BR/CN/NG/RU): modern base
 * `lowerChamber.seats` disagreed with historically authored `*Regions1953`
 * houseDistricts sums — the 1953 sim audit reported party seats vs totalSeats
 * mismatches (UK 806≠650, IT 945≠630). Align config to the era seed totals
 * (same pattern as TR/ES/SE above). FR already had a 627-seat era overlay;
 * its region HD were scaled to match.
 */
export const ERA_COUNTRY_CONFIG_OVERRIDES: Record<
  string,
  Partial<Record<CountryId, EraCountryConfigOverride>>
> = {
  "1953-default": {
    TR: {
      // 2.8 TRL/USD, 1953 par (INITIAL_RATES_1953.TR).
      usdExchangeRate: 1 / 2.8,
      // Menderes DP governing since 1950; CHP in opposition. AP (Justice Party)
      // was only founded in 1961 after the coup dissolved DP.
      majorPartyIds: ["tr_dp", "tr_chp"],
      // 487 / 2 + 1 — 1950 TBMM majority
      coalitionThreshold: 244,
      legislature: {
        name: "Grand National Assembly",
        path: "/country/tr/legislature",
        bicameral: false,
        // Unicameral TBMM — no Senato until the 1961 constitution.
        lowerChamber: {
          key: "milletMeclisi",
          name: "Grand National Assembly",
          shortName: "Meclis",
          seats: 487,
          description:
            "487 deputies of the unicameral Türkiye Büyük Millet Meclisi (1950 election size; Senate created only by the 1961 constitution).",
          elected: true,
        },
      },
      upperElectionSystem: undefined,
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
          partyStrengthWeight: 1.0,
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
      tagline:
        "Menderes's Democrat Party republic — a unicameral Grand National Assembly, NATO membership since 1952, and deepening secular–conservative rivalry.",
      descriptor:
        "A parliamentary republic where a Prime Minister governs at the confidence of a unicameral 487-seat Grand National Assembly (TBMM); no Senate existed until the 1961 constitution.",
    },
    GR: {
      // 30 GRD/USD, post-April-1953 Markezinis devaluation (INITIAL_RATES_1953.GR).
      usdExchangeRate: 1 / 30,
      // Kingdom of Greece — Papagos's Greek Rally governing after the November
      // 1952 landslide (247/300); Paul I on the throne; civil-war-era KKE
      // banned, the left runs as EDA.
      headOfStateTitle: "King",
      governmentType: "parliamentaryMonarchy",
      governmentTypeLabel: "Parliamentary Monarchy",
      majorPartyIds: ["gr_es", "gr_epek"],
      officeTypes: [
        {
          key: "primeMinister",
          label: "Prime Minister",
          labelPlural: "Prime Ministers",
          isExecutive: true,
          isSubNational: false,
          termYears: 4,
          actionBonus: 4,
          partyStrengthWeight: 1.0,
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
      tagline:
        "The post-civil-war kingdom — Papagos's Greek Rally, American aid, NATO membership since 1952, and a banned communist left regrouping as EDA.",
      descriptor:
        "A parliamentary monarchy where a Prime Minister governs at the confidence of the unicameral 300-seat Vouli under King Paul I; the majoritarian electoral law magnifies pluralities into landslides.",
    },
    AT: {
      // 26 ATS/USD, 1953 Bretton Woods parity (INITIAL_RATES_1953.AT).
      usdExchangeRate: 1 / 26,
      // Four-power occupied Austria — the ÖVP–SPÖ grand coalition (Raab
      // Chancellor from April 1953) governs a 165-seat Nationalrat while
      // Soviet, American, British and French zones await the State Treaty.
      // COLONIES/OCCUPATION-SYSTEM note: the occupation itself is not
      // modelled — Austria plays as a sovereign parliamentary republic.
      coalitionThreshold: 83, // 165 / 2 + 1
      legislature: {
        name: "Nationalrat",
        path: "/country/at/legislature",
        bicameral: false,
        lowerChamber: {
          key: "nationalrat",
          name: "Nationalrat",
          shortName: "Nationalrat",
          seats: 165,
          description:
            "165 deputies of the Nationalrat (the pre-1971 chamber size), elected by proportional representation under the ÖVP–SPÖ grand coalition.",
          elected: true,
        },
      },
      tagline:
        "An occupied republic between the blocs — the ÖVP–SPÖ grand coalition rebuilds under four-power occupation, bargaining toward the State Treaty and permanent neutrality.",
      descriptor:
        "A parliamentary republic where a Chancellor governs at the confidence of the unicameral 165-seat Nationalrat, while Allied occupation zones still divide the country.",
    },
    FI: {
      // 230 FIM/USD, 1953 OLD markka par (INITIAL_RATES_1953.FI).
      usdExchangeRate: 1 / 230,
      // Postwar Finland — war reparations to the USSR just delivered in full
      // (1952), Karelian evacuees resettled, the Agrarian League's Kekkonen
      // heading fractious center coalitions under President Paasikivi's
      // eastern-policy line; the ceded-Karelia border is the live wound.
      majorPartyIds: ["fi_ml", "fi_sdp"],
      tagline:
        "The republic that paid its way out — reparations to Moscow delivered, Karelian evacuees resettled, and the Paasikivi line holding a precarious neutrality while agrarian-social democratic coalitions rebuild.",
      descriptor:
        "A parliamentary republic where a Prime Minister governs at the confidence of the unicameral 200-seat Eduskunta, under a presidency that owns the delicate relationship with the Soviet Union.",
    },
    FR: {
      // 350 FRF/USD, post-devaluation old francs (INITIAL_RATES_1953.FR).
      usdExchangeRate: 1 / 350,
      executiveTitle: "President of the Council",
      headOfStateTitle: "President",
      governmentType: "parliamentaryRepublic",
      governmentTypeLabel: "Parliamentary Republic",
      // June 1951 election: 627 Assemblée seats → majority 314
      coalitionThreshold: 314,
      legislature: {
        name: "Parliament",
        path: "/country/fr/legislature",
        bicameral: true,
        upperChamber: {
          key: "senat",
          name: "Council of the Republic",
          shortName: "Conseil",
          seats: 320,
          description:
            "320 councillors of the Conseil de la République, elected indirectly by local authorities for six-year terms. A weaker revising chamber under the Fourth Republic.",
          elected: true,
        },
        lowerChamber: {
          key: "assembleeNationale",
          name: "National Assembly",
          shortName: "Assemblée",
          seats: 627,
          description:
            "627 deputies elected in the June 1951 election by proportional representation. The chamber that made and unmade Fourth Republic cabinets.",
          elected: true,
        },
      },
      lowerElectionSystem: {
        termYears: 5,
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
      // President of the Council MUST stay first so getExecutiveOfficeKey("FR",
      // "1953-default") resolves to the real executive (Italy/IE pattern).
      officeTypes: [
        {
          key: "primeMinister",
          label: "President of the Council",
          labelPlural: "Presidents of the Council",
          isExecutive: true,
          isSubNational: false,
          termYears: 5,
          actionBonus: 4,
          partyStrengthWeight: 1.0,
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
          chamberKey: "assembleeNationale",
          isExecutive: false,
          isSubNational: false,
          termYears: 5,
          actionBonus: 1,
          partyStrengthWeight: 0.9,
        },
        {
          key: "senator",
          label: "Councillor of the Republic",
          labelPlural: "Councillors of the Republic",
          chamberKey: "senat",
          isExecutive: false,
          isSubNational: false,
          termYears: 6,
          actionBonus: 1,
          partyStrengthWeight: 0.8,
        },
        {
          key: "centralBankChair",
          label: "Governor of the Banque de France",
          labelPlural: "Governors of the Banque de France",
          isExecutive: false,
          isSubNational: false,
          termYears: 6,
          actionBonus: 3,
          partyStrengthWeight: 0,
        },
      ],
      tagline:
        "The Fourth Republic - a ceremonial President and a fragile President of the Council governing through an unstable Assemblée Nationale.",
      descriptor:
        "A parliamentary republic: a President elected by Parliament shares the stage with a President of the Council answerable to the 627-seat National Assembly, with an indirectly-elected Council of the Republic.",
      executiveLabel: "Matignon",
    },
    ES: {
      // 39.6 ESP/USD, official 1953 peseta rate (INITIAL_RATES_1953.ES).
      usdExchangeRate: 1 / 39.6,
      // Franco personally held both head-of-state and head-of-government roles
      // in 1953 (Jefe del Estado / Caudillo). DD pattern: one executive office
      // marked isHeadOfState — no separate ceremonial HoS sync.
      executiveTitle: "Caudillo",
      headOfStateTitle: "Jefe del Estado",
      governmentType: "onePartyState",
      governmentTypeLabel: "One Party State",
      regionLabel: "Province",
      regionLabelPlural: "Provinces",
      // FET is the sole 1953 party (validForPresets: ["1953-default"]) and is
      // seeded first → sequentialId 1. Mirrors CN/RU/DD rulingPartyId seeding.
      rulingPartyId: 1,
      majorPartyIds: ["es_fet"],
      // 350 / 2 + 1 — matches esRegions1953 houseDistricts sum (procuradores)
      coalitionThreshold: 176,
      legislature: {
        name: "Cortes Españolas",
        path: "/country/es/legislature",
        // Unicameral corporatist Cortes (Ley de Cortes 1942). No Senado until
        // the 1978 Constitution's Cortes Generales.
        bicameral: false,
        lowerChamber: {
          // Key kept stable so the null-gated esCongreso cycle mapping and
          // office/election-type lookups still resolve (FR/TR pattern).
          key: "congresoDiputados",
          name: "Cortes Españolas",
          shortName: "Cortes",
          seats: 350,
          description:
            "350 procuradores of the Cortes Españolas — a corporatist chamber seated by 'organic democracy' (syndicates, municipalities, families, and direct Franco appointment), not by competitive election.",
          // Appointed / corporatist — same elected:false pattern as HU/PL/DD
          // standing councils. Competitive elections stay era-gated OFF via
          // the null esCongreso cycle anchor.
          elected: false,
        },
      },
      lowerElectionSystem: {
        termYears: 4,
        seatsContested: "all",
        singleMemberConstituencies: false,
        snapElectionsAllowed: false,
      },
      upperElectionSystem: undefined,
      electionSystems: {
        lowerChamber: "pr_hareQuota",
        headOfGovernment: "parliamentary",
        headOfState: "ceremonial",
      },
      officeTypes: [
        {
          // Single office: Franco is both Caudillo (executive) and Jefe del
          // Estado (head of state). Must stay first so getExecutiveOfficeKey
          // resolves here (DD General Secretary pattern).
          key: "caudillo",
          label: "Caudillo",
          labelPlural: "Caudillos",
          isExecutive: true,
          isHeadOfState: true,
          isSubNational: false,
          termYears: 0, // life tenure under the Fundamental Laws
          actionBonus: 4,
          partyStrengthWeight: 1.0,
        },
        {
          key: "procurador",
          label: "Procurador",
          labelPlural: "Procuradores",
          chamberKey: "congresoDiputados",
          isExecutive: false,
          isSubNational: false,
          termYears: 4,
          actionBonus: 1,
          partyStrengthWeight: 0.9,
        },
        {
          key: "centralBankChair",
          label: "Governor of the Banco de España",
          labelPlural: "Governors of the Banco de España",
          isExecutive: false,
          isSubNational: false,
          termYears: 6,
          actionBonus: 3,
          partyStrengthWeight: 0,
        },
      ],
      tagline:
        "Franco's Spain - a one-party dictatorship under the Caudillo, with FET as the sole Movimiento party and a corporatist Cortes Españolas.",
      descriptor:
        "A one-party state where Franco governs as both Jefe del Estado and Caudillo through FET y de las JONS; the 350-seat Cortes Españolas is a corporatist appointed chamber, and Spain is organised into provinces rather than autonomous communities.",
      executiveLabel: "El Pardo",
    },
    SE: {
      // 5.17 SEK/USD, Bretton Woods par (INITIAL_RATES_1953.SE).
      usdExchangeRate: 1 / 5.17,
      // Erlander SAP governing; Högerpartiet (not yet Moderaterna — renamed 1969)
      // as the main conservative opposition. Centerpartiet rename was 1957.
      majorPartyIds: ["se_sap", "se_h"],
      // 230 / 2 + 1 — Second Chamber (Andra kammaren) majority; matches seRegions1953.
      coalitionThreshold: 116,
      legislature: {
        name: "Riksdag",
        path: "/country/se/legislature",
        // IE/UK pattern: upper chamber exists for seats + revise/delay flavour,
        // but is not part of the player legislative loop (see countries.ts
        // `bicameral` doc). True bill-active bicameral would require perpetual
        // First Chamber elections that no country simulates for this shape.
        bicameral: false,
        upperChamber: {
          key: "forstaKammaren",
          name: "First Chamber",
          shortName: "Första kammaren",
          // 150 = Σ seRegions1953.stateSenateSeats (not base config's 151).
          seats: 150,
          description:
            "150 members indirectly elected by county and city councils on staggered eight-year terms. May revise or delay legislation, but the Second Chamber ultimately prevails. Not player-managed.",
        },
        lowerChamber: {
          // Key stays `riksdag` so beta-parliament elections / method maps keep working.
          key: "riksdag",
          name: "Second Chamber",
          shortName: "Andra kammaren",
          // 230 = Σ seRegions1953.houseDistricts (1952 election size).
          seats: 230,
          description:
            "230 members elected by proportional representation — the directly elected, confidence-giving chamber of the bicameral Riksdag.",
          elected: true,
        },
      },
      lowerElectionSystem: {
        termYears: 4, // Second Chamber four-year terms in the bicameral era
        seatsContested: "all",
        singleMemberConstituencies: false,
        snapElectionsAllowed: false,
      },
      // Indirectly elected via councils — no player-managed upper elections (IE Seanad).
      upperElectionSystem: undefined,
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
          partyStrengthWeight: 1.0,
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
          label: "Member of the Second Chamber",
          labelPlural: "Members of the Second Chamber",
          chamberKey: "riksdag",
          isExecutive: false,
          isSubNational: false,
          termYears: 4,
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
      tagline:
        "Erlander's Social Democratic Sweden — a bicameral Riksdag, Cold War neutrality, and the expanding welfare state.",
      descriptor:
        "A constitutional monarchy with a bicameral Riksdag: a 230-seat directly elected Second Chamber and a 150-seat First Chamber indirectly elected by local councils.",
    },
    // Rákosi's MDP (1948–1956); MSZMP only founded after the 1956 revolution.
    HU: {
      // 20 HUF/USD (INITIAL_RATES_1953.HU) — between the 11.74 official parity
      // and the 30 Ft devisa rate; huRegions1953 gdp is in forint millions.
      usdExchangeRate: 1 / 20,
      majorPartyIds: ["mdp"],
    },
    // Gheorghiu-Dej's PMR (1948–1965); "PCR" name restored only in 1965.
    RO: {
      // 13.5 ROL/USD (INITIAL_RATES_1953.RO) — the 1.50 lei/rouble official
      // cross carried through RU's 9 SUR/USD basis; roRegions1953 gdp is in lei.
      usdExchangeRate: 1 / 13.5,
      majorPartyIds: ["pmr"],
    },
    PL: {
      // 24 PLZ/USD (INITIAL_RATES_1953.PL) — the non-commercial/tourist rate,
      // not the 4 zł official parity; plRegions1953 gdp is in złoty millions.
      usdExchangeRate: 1 / 24,
    },
    CS: {
      // 27 CSK/USD (INITIAL_RATES_1953.CS) — the June-1953 reform's 7.20 base
      // times the 3.75 non-socialist coefficient; csRegions1953 gdp is in koruna.
      usdExchangeRate: 1 / 27,
    },
    BG: {
      // 15.3 BGL/USD (INITIAL_RATES_1953.BG) — the 1.70 leva/rouble official
      // cross carried through RU's 9 SUR/USD basis; bgRegions1953 gdp is in leva.
      // The base config's 1.0 (lev treated as dollar-par) read Bulgaria as a $40B
      // economy — larger than West Germany.
      usdExchangeRate: 1 / 15.3,
    },
    YU: {
      // 16.667 YUD/USD (INITIAL_RATES_1953.YU) — the 300 din/USD official rate
      // divided by the 18x magnitude gap between yuRegions1953 (real dinars) and
      // the ₮100B national budget seed that reconcileStateGdp normalizes to.
      usdExchangeRate: 1 / 16.667,
    },
    DD: {
      // 4.2 DDM/USD — Mark der DDR at administered 1:1 with the West DEM
      // (INITIAL_RATES_1953.DD); ddRegions1953 gdp is in Mark der DDR millions.
      usdExchangeRate: 1 / 4.2,
    },
    BLR: {
      // Byelorussian SSR — a Soviet union republic, not a satellite state:
      // blrRegions1953 gdp is authored in SOVIET RUBLE millions
      // (COUNTRY_CURRENCY_MAP.BLR = SUR), so it takes RU's 9 SUR/USD basis
      // (INITIAL_RATES_1953.RU). Without it the base config's 1.35 read the
      // BSSR as a $189B economy — half the size of the 1953 United States.
      usdExchangeRate: 1 / 9,
    },
    BAL: {
      // Baltic SSRs — same Soviet-ruble basis as BLR/RU (balRegions1953 gdp is
      // "millions of Soviet rubles"; COUNTRY_CURRENCY_MAP.BAL = SUR).
      usdExchangeRate: 1 / 9,
    },
    // ── Seat-count alignments to *Regions1953 houseDistricts ───────────────
    UK: {
      // 0.357 GBP/USD — Bretton Woods par $2.80/£ (INITIAL_RATES_1953.UK).
      usdExchangeRate: 1 / 0.357,
      // 625 / 2 + 1 — Commons size in force 1950–1955 (ukRegions1953).
      coalitionThreshold: 313,
      legislature: {
        name: "Parliament",
        path: "/country/uk/legislature",
        bicameral: false,
        upperChamber: {
          key: "lords",
          name: "House of Lords",
          shortName: "Lords",
          seats: 784,
          description: "Appointed and hereditary peers. Revises and scrutinises legislation.",
        },
        lowerChamber: {
          key: "commons",
          name: "House of Commons",
          shortName: "Commons",
          seats: 625,
          description:
            "625 elected MPs from single-member constituencies (1950–1955 redistribution). The primary legislative chamber.",
        },
      },
    },
    IT: {
      // USD-anchored GDP/income seed (refs #3498) — match US/DE convention.
      usdExchangeRate: 1.0,
      // 590 / 2 + 1 — Camera size 1948–1963 (itRegions1953); modern base is 630.
      coalitionThreshold: 296,
      legislature: {
        name: "Parliament",
        path: "/country/it/legislature",
        bicameral: true,
        upperChamber: {
          key: "senato",
          name: "Senate of the Republic",
          shortName: "Senato",
          // Matches Σ itRegions1953.stateSenateSeats (not the modern 315).
          seats: 280,
          description:
            "280 elected senators on a regional basis for five-year terms (1953 First Republic apportionment).",
          elected: true,
        },
        lowerChamber: {
          key: "cameraDeputati",
          name: "Chamber of Deputies",
          shortName: "Camera",
          seats: 590,
          description:
            "590 deputies elected by proportional representation (Camera size in force 1948–1963).",
          elected: true,
        },
      },
    },
    DE: {
      // 4.2 DEM/USD, post-reform fixed rate (INITIAL_RATES_1953.DE).
      usdExchangeRate: 1 / 4.2,
      // 487 / 2 + 1 — 2nd Bundestag 1953 (deRegions1953; excl. Saarland voting seats).
      coalitionThreshold: 244,
      // 1953-scaled federal-equalization pool (fiscal-scale audit, 2026-07-28).
      // The base COUNTRY_CONFIGS.DE entry's `federalEqualizationGrantPerCapita:
      // 500` is a modern-EUR-denominated figure (≈500 / DEFAULT_GDP_PER_CAPITA
      // 45,000 ≈ 1.1% of GDP per capita — a plausible modern Länderfinanzausgleich
      // share) applied flat regardless of era. Against 1953 DE's DEM-denominated
      // ~2,760/capita GDP seed (138B / 50M), 500 EUR/capita is ~18% of GDP per
      // capita — the equalization pool alone (once the region-count mismatch
      // below is also fixed) ballooned to ~12.6% of national GDP, the single
      // largest line in DE's spending and the main driver of its +13.1%-of-GDP
      // day-26 surplus.
      //
      // Rather than invent a new figure, this override matches the pool this
      // config's OWN authored `NATIONAL_BUDGET_SEED_CONFIGS_1953.DE.
      // baselineStateGrants` ($5B ≈ 3.6% of GDP, "transfers to Länder") already
      // intended for this line — same reasoning as CN's `centralTransferPerCapita`
      // override above. $5B / 50,000,000 population = 100 EUR/capita.
      federalEqualizationGrantPerCapita: 100,
      legislature: {
        name: "Bundestag",
        path: "/country/de/legislature",
        bicameral: true,
        upperChamber: {
          key: "bundesrat",
          name: "Bundesrat",
          shortName: "Bundesrat",
          seats: 69,
          description:
            "Members representing the West German Länder (appointed by state governments).",
        },
        lowerChamber: {
          key: "bundestag",
          name: "Bundestag",
          shortName: "Bundestag",
          seats: 487,
          description:
            "487 members of the 2nd Bundestag (1953) elected via mixed-member proportional representation.",
        },
      },
    },
    JP: {
      // USD-anchored GDP/income seed (refs #3498) — match US/DE convention.
      usdExchangeRate: 1.0,
      // Pre-LDP Japan: Yoshida's Liberal Party (RYO) governing; JSP main opposition.
      // LDP formed Nov 1955; CDP is a 2017 creation.
      majorPartyIds: ["ryo", "jsp"],
      // 466 / 2 + 1 — 1953 Shūgiin (jpRegions1953); modern base is 465.
      coalitionThreshold: 234,
      legislature: {
        name: "Kokkai",
        path: "/country/jp/legislature",
        bicameral: true,
        upperChamber: {
          key: "sangiin",
          name: "Sangiin",
          shortName: "Sangiin",
          seats: 248,
          description:
            "248 councillors elected on staggered 6-year terms. Half are contested every 3 years. Cannot be dissolved.",
          elected: true,
        },
        lowerChamber: {
          key: "shugiin",
          name: "Shūgiin",
          shortName: "Shūgiin",
          seats: 466,
          description:
            "466 members elected in the April 1953 general election from regional constituencies.",
        },
      },
    },
    IE: {
      // 0.357 IEP/USD — hard 1:1 sterling link at Bretton Woods par
      // (INITIAL_RATES_1953.IE, itself pinned to INITIAL_RATES_1953.UK).
      usdExchangeRate: 1 / 0.357,
      // 147 / 2 + 1 — Dáil under the 1948 redistribution (ieRegions1953).
      coalitionThreshold: 74,
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
          seats: 147,
          description:
            "147 TDs elected by PR-STV across multi-seat constituencies (1948 redistribution).",
          elected: true,
        },
      },
    },
    BR: {
      // 18.8 cruzeiro/USD, 1953 average (INITIAL_RATES_1953.BR).
      usdExchangeRate: 1 / 18.8,
      // 304 / 2 + 1 — 1950 Chamber of Deputies (brRegions1953).
      coalitionThreshold: 153,
      legislature: {
        name: "National Congress",
        path: "/country/br/legislature",
        bicameral: true,
        upperChamber: {
          key: "senate",
          name: "Federal Senate",
          shortName: "Senate",
          seats: 81,
          description:
            "81 senators - three per state - serving eight-year staggered terms. Reviews legislation from the Chamber.",
          elected: true,
        },
        lowerChamber: {
          key: "chamber",
          name: "Chamber of Deputies",
          shortName: "Chamber",
          seats: 304,
          description:
            "304 deputies of the 1950 legislature elected by open-list proportional representation.",
          elected: true,
        },
      },
    },
    CN: {
      // USD-anchored GDP/income seed (refs #3498) — match US/DE convention.
      usdExchangeRate: 1.0,
      // 1226 / 2 + 1 — First NPC 1954 (cnRegions1953).
      coalitionThreshold: 614,
      // 1953-scaled central-transfer pool (fiscal-scale audit, 2026-07-28). The
      // base COUNTRY_CONFIGS.CN entry's `centralTransferPerCapita: 35` is a
      // CNY-denominated figure calibrated against the CNY-denominated 1991/
      // modern CN budget seeds (COST_SCALE_ANCHORS.CN gdpLow ≈ 2.18T CNY /
      // popLow 1.158B ⇒ ≈1,881 CNY/capita at the 1991 anchor) — the *fiscal
      // transfer* analogue of the same "1991-vs-modern absolute cost" anchor
      // every other CN per-capita program is scaled against via
      // getGdpIndexedCostScale (src/lib/budget/costs.ts). But
      // `calculateCNRegionalBudget` (src/lib/turn/cnRegionalBudget.ts) never
      // routes centralTransferPerCapita through that scale — it is a flat
      // per-head constant applied straight to nationalPopulation regardless of
      // era. Against 1953 CN's USD-anchored $33.3B-GDP / 588M-population seed,
      // 35 × 588,000,000 = $20.58B — 62% of GDP in "central transfer grants"
      // alone, blowing a 14.5%-of-GDP day-1 deficit out to 64% of GDP by turn
      // 26 and pushing debt principal past its own ceiling (issue: fiscal-scale
      // audit, 2026-07-28).
      //
      // Rather than invent a new figure, this override matches the pool this
      // config's OWN authored `NATIONAL_BUDGET_SEED_CONFIGS_1953.CN.
      // baselineStateGrants` ($1.63B ≈ 4.9% of GDP) already intended for CN's
      // 1953 state-grants line (that baseline is itself orphaned by the
      // policy-derived spending path in budgets.ts and never reaches the
      // runtime budget — see deriveSpending's `hasPolicySpending` branch).
      // $1.63B / 588,000,000 ≈ $2.77/person. A modest, mostly-residual
      // regional-transfer pool is also the historically correct shape for
      // First-Five-Year-Plan China: under the 1950s "统收统支" (unified
      // revenue collection / unified expenditure) fiscal system, the centre
      // retained the overwhelming share of state revenue for planned
      // industrial investment, and provincial governments operated on thin,
      // centrally-approved allocations rather than large block grants (see
      // Naughton, "The Chinese Economy," on 1950s fiscal centralization).
      onePartyRegionalBudget: {
        localTaxRetentionShare: 0.4,
        corporateProfitRatio: 0.06,
        centralTransferPerCapita: 2.77,
        defaultTaxRate: 25,
        primaryTaxLegislationKey: "cn_enterprise_income_tax",
        resourceTaxLegislationKey: "cn_provincial_resource_tax",
        resourceExtractionRatio: 0.03,
        businessTaxConsumptionRatio: 0.5,
        businessTaxRate: 24,
      },
      legislature: {
        name: "National People's Congress",
        path: "/country/cn/legislature",
        bicameral: false,
        upperChamber: {
          key: "cppcc",
          name: "CPPCC",
          shortName: "CPPCC",
          seats: 2169,
          description:
            "Members of the Chinese People's Political Consultative Conference - an advisory body representing diverse social and economic constituencies.",
        },
        lowerChamber: {
          key: "npc",
          name: "National People's Congress",
          shortName: "NPC",
          seats: 1226,
          description: "1,226 deputies of the First National People's Congress (1954 convocation).",
        },
      },
    },
    NG: {
      // USD-anchored GDP/income seed (refs #3498) — match US/DE convention.
      usdExchangeRate: 1.0,
      // 136 / 2 + 1 — Federal House under the Lyttelton Constitution 1954 (ngRegions1953).
      coalitionThreshold: 69,
      legislature: {
        name: "National Assembly",
        path: "/country/ng/legislature",
        bicameral: true,
        upperChamber: {
          key: "senate",
          name: "Senate",
          shortName: "Senate",
          seats: 109,
          description: "Senators elected from constituencies across the Nigerian federation.",
          elected: true,
        },
        lowerChamber: {
          key: "house",
          name: "House of Representatives",
          shortName: "House",
          seats: 136,
          description:
            "136 representatives of the Federal House under the Lyttelton Constitution (1954).",
          elected: true,
        },
      },
    },
    RU: {
      // 9 SUR/USD — the Western GNP-estimate basis the ₽1.4T budget seed and
      // ruRegions1953 are calibrated against (INITIAL_RATES_1953.RU).
      usdExchangeRate: 1 / 9,
      // 708 / 2 + 1 — Soviet of the Union 1954 convocation (ruRegions1953).
      coalitionThreshold: 355,
      legislature: {
        name: "Supreme Soviet",
        path: "/country/ru/legislature",
        bicameral: true,
        upperChamber: {
          key: "sovietOfNationalities",
          name: "Soviet of Nationalities",
          shortName: "Nationalities",
          elected: true,
          seats: 515,
          description:
            "Deputies representing the union republics and autonomous republics of the Soviet Union.",
        },
        lowerChamber: {
          key: "sovietOfTheUnion",
          name: "Soviet of the Union",
          shortName: "Union",
          // 526 of the 1954 convocation's 708; the balance went with Ukraine,
          // Byelorussia and the Baltics. Must equal Σ houseDistricts in
          // ruRegions1953.ts.
          seats: 526,
          description:
            "526 deputies of the Soviet of the Union (RU's share of the 1954 convocation), elected by population.",
        },
      },
    },
  },
};

export function getCountryConfig(id: CountryId, preset?: string): CountryConfig {
  const base = COUNTRY_CONFIGS[id];
  const override = preset ? ERA_COUNTRY_CONFIG_OVERRIDES[preset]?.[id] : undefined;
  if (!override) return base;
  return { ...base, ...override };
}

/**
 * Per-era country display-name overrides. A country's `name` in COUNTRY_CONFIGS is
 * the era-neutral default; some countries are known by a different name in a given
 * preset's year (e.g. the FRG is "West Germany" while the GDR exists in 1979).
 * Use {@link getCountryDisplayName} at display sites that know the active preset.
 */
export const ERA_COUNTRY_NAMES: Record<string, Partial<Record<CountryId, string>>> = {
  "1953-default": {
    DE: "West Germany",
    RU: "Soviet Union",
  },
  "1979-default": {
    DE: "West Germany",
    RU: "Soviet Union",
  },
};

/** Country name for display, honoring per-era overrides when a preset is known. */
export function getCountryDisplayName(id: CountryId, preset?: string): string {
  const override = preset ? ERA_COUNTRY_NAMES[preset]?.[id] : undefined;
  // Callers (ShortageHeatMap, commodity scope) sometimes pass an empty or
  // stale id via `as CountryId`. Indexing COUNTRY_CONFIGS blindly threw
  // "Cannot read properties of undefined (reading 'name')" and crashed the
  // commodities tab (ticket #1115; same class as #1101).
  const config = Object.hasOwn(COUNTRY_CONFIGS, id) ? COUNTRY_CONFIGS[id] : undefined;
  return override ?? config?.name ?? id;
}

/**
 * Returns the top-level executive office key for a country
 * (e.g. "primeMinister" for UK/JP, "chancellor" for DE, "president" for US).
 * Throws if the country has no configured executive office type.
 * Pass `preset` when the country's office ordering may be era-dependent
 * (France 1953: President of the Council before ceremonial President).
 */
export function getExecutiveOfficeKey(countryId: CountryId, preset?: string): string {
  const config = getCountryConfig(countryId, preset);
  const executive = config.officeTypes.find((o) => o.isExecutive && !o.isSubNational);
  if (!executive) throw new Error(`No executive office type found for ${countryId}`);
  return executive.key;
}

const COUNTRY_NAME_TO_ID: Record<string, CountryId> = Object.fromEntries(
  COUNTRY_ORDER.map((id) => [COUNTRY_CONFIGS[id].name, id])
);

/**
 * Reverse lookup: full country name ("United Kingdom") → ISO `CountryId` ("UK").
 * Returns null when the name doesn't match a configured country, so callers can
 * decide whether to fall back (e.g. pass the name through to a flag API that
 * understands ISO codes and will 404 gracefully).
 */
export function getCountryIdByName(name: string): CountryId | null {
  return COUNTRY_NAME_TO_ID[name] ?? null;
}

/**
 * Number of candidates that advance from a party primary to the general
 * election, keyed by {@link CountryConfig.governmentType}. This mapping is the
 * single source of truth — countries no longer carry a per-config
 * `primaryWinners` field — so when a country's government type changes at
 * runtime, the primary cap follows automatically.
 *
 * - `presidential` → 1: one nominee per party (US-style single-winner race).
 * - `parliamentaryMonarchy` / `parliamentaryRepublic` → 3: top-3 advance
 *   (UK, JP, DE, IE) so the general phase has genuine intra-party
 *   competition for multi-seat allocations.
 * - `onePartyState` → 7: lets up to 7 same-party candidates advance so the
 *   general's PR allocation distributes seats across the dominant party's
 *   caucus instead of collapsing every regional seat onto one nominee.
 */
export const PRIMARY_WINNERS_BY_GOVERNMENT_TYPE: Record<CountryConfig["governmentType"], number> = {
  presidential: 1,
  parliamentaryMonarchy: 3,
  parliamentaryRepublic: 3,
  onePartyState: 7,
};

/**
 * Resolve the primary-winner cap from a government type directly. Prefer this
 * when you already have a {@link CountryConfig.governmentType} value in hand.
 */
export function getPrimaryWinnersForGovernmentType(
  governmentType: CountryConfig["governmentType"]
): number {
  return PRIMARY_WINNERS_BY_GOVERNMENT_TYPE[governmentType];
}

/**
 * Resolve the primary-winner cap for a country by reading its current
 * {@link CountryConfig.governmentType}. Use this from election engines /
 * routes that have a `countryId` but not the full config. Returns 1 if the
 * country is unknown.
 */
export function getPrimaryWinnersForCountry(countryId: CountryId): number {
  const config = COUNTRY_CONFIGS[countryId];
  if (!config) return 1;
  return getPrimaryWinnersForGovernmentType(config.governmentType);
}

/**
 * Election types that elect a single office-holder via a directly-contested
 * ballot, so exactly one candidate per party may advance from the primary —
 * no matter the country's government type. These are the executive offices:
 * - `president` — national head of state (US/NG; 1 already under presidential
 *   govType, guarded here so parliamentary/one-party presidencies match).
 * - `governor` — the direct-elected regional executive across every country
 *   that has one (US/JP/CN state governors, UK First Ministers & Mayor of
 *   London, IE Cathaoirleach/Lord Mayors, SCO/WAL leaders — all typed
 *   `"governor"`).
 * - `uachtaran` — Ireland's directly-elected presidency.
 * - `ministerPresident` — a German Land's Minister-President (single-seat,
 *   `totalSeats: 1`, spawned with a primary window that mirrors its Landtag).
 *
 * The {@link PRIMARY_WINNERS_BY_GOVERNMENT_TYPE} table models *legislative*
 * multi-seat allocation (parliamentary → 3, onePartyState → 7). Applying that
 * cap to a single-seat executive race would let several same-party candidates
 * advance and split the office's single general-election vote — which is the
 * bug this set guards against. Multi-seat legislative types (`house`, `commons`,
 * `sangiin`, `bundestag`, `landtag`, `npcDelegate`, `dail`, `seanad`, …) are
 * deliberately absent so they keep the government-type cap. `senate` is
 * likewise excluded: single-seat in the US (already 1 via presidential
 * govType) but a multi-seat proportional chamber elsewhere (e.g. JP Sangiin).
 * `primeMinister` is confidence-based (no candidate primary), so it never
 * reaches this cap and is not listed.
 */
export const SINGLE_WINNER_EXECUTIVE_ELECTION_TYPES: ReadonlySet<string> = new Set([
  "president",
  "governor",
  "uachtaran",
  "ministerPresident",
]);

/**
 * Resolve the primary-winner cap for a specific (country, electionType).
 *
 * One election-type exception overrides the government-type default:
 * single-winner executive offices ({@link SINGLE_WINNER_EXECUTIVE_ELECTION_TYPES})
 * always advance exactly one candidate per party — a governor/president race
 * fills one seat, so parliamentary/one-party multi-advance would split its vote.
 *
 * Otherwise it equals {@link getPrimaryWinnersForCountry}.
 *
 * US House used to advance three per party under the districted-redistricting
 * system so the resolver could split a state's delegation by primary share.
 * That was reverted: a party's own filler NPP survived the primary alongside
 * the player who beat it and then took a proportional slice of the delegation,
 * which is not how a primary is meant to work. US House is back to one nominee
 * per party, like every other US race.
 */
export function getPrimaryWinnersForElection(countryId: CountryId, electionType: string): number {
  if (SINGLE_WINNER_EXECUTIVE_ELECTION_TYPES.has(electionType)) {
    return 1;
  }
  return getPrimaryWinnersForCountry(countryId);
}

/**
 * Per-regime vote-weight multipliers for one-party-state legislative
 * general elections. Multiplies the per-candidate weight in
 * `voteDistribution.ts`. `ruling = 3.0` and `approved = 0.375` together
 * produce ~80% ruling seat share with CN's typical primary output (7
 * ruling vs ~14 approved candidates). `independent` is treated the same
 * as `banned` — only recognised ruling/approved parties may field
 * legislative candidates in a one-party state.
 *
 * See `docs/plans/archive/2026-05/2026-05-27-ops-general-elections-design.md`
 * for the math and rationale.
 */
export const DEFAULT_OPS_VOTE_MULTIPLIERS = {
  ruling: 3.0,
  approved: 0.375,
  independent: 0.0,
  banned: 0.0,
} as const;

export interface OpsVoteMultipliers {
  ruling: number;
  approved: number;
  independent: number;
  banned: number;
}

/**
 * How the executive is chosen after an election, keyed by
 * {@link CountryConfig.governmentType}.
 *
 * - `presidential` → `"direct_election"`: voters choose the executive directly.
 * - `parliamentaryMonarchy` / `parliamentaryRepublic` / `onePartyState` →
 *   `"confidence_of_legislature"`: the executive emerges from a legislative
 *   majority (or, in CN's case, from internal party confidence).
 *
 * Derived from `governmentType` so a future runtime regime change carries
 * executive-formation semantics along with it — no per-country override
 * needed.
 */
export const EXECUTIVE_FORMATION_BY_GOVERNMENT_TYPE: Record<
  CountryConfig["governmentType"],
  "direct_election" | "confidence_of_legislature"
> = {
  presidential: "direct_election",
  parliamentaryMonarchy: "confidence_of_legislature",
  parliamentaryRepublic: "confidence_of_legislature",
  onePartyState: "confidence_of_legislature",
};

export type ExecutiveFormation =
  (typeof EXECUTIVE_FORMATION_BY_GOVERNMENT_TYPE)[CountryConfig["governmentType"]];

/**
 * Resolve the executive-formation mode from a government type directly.
 * Prefer this when you already have a {@link CountryConfig.governmentType} value.
 */
export function getExecutiveFormationForGovernmentType(
  governmentType: CountryConfig["governmentType"]
): ExecutiveFormation {
  return EXECUTIVE_FORMATION_BY_GOVERNMENT_TYPE[governmentType];
}

/**
 * Resolve the executive-formation mode for a country by reading its current
 * {@link CountryConfig.governmentType}. Falls back to `"direct_election"` when
 * the country is unknown.
 */
export function getExecutiveFormationForCountry(countryId: CountryId): ExecutiveFormation {
  const config = COUNTRY_CONFIGS[countryId];
  if (!config) return "direct_election";
  return getExecutiveFormationForGovernmentType(config.governmentType);
}

/**
 * True when the country's executive is directly elected by voters (presidential
 * systems). Convenience inverse of {@link isParliamentarySystem} for code that
 * specifically cares about election mechanics rather than regime type.
 */
export function isDirectElection(
  config: Pick<CountryConfig, "governmentType"> | null | undefined
): boolean {
  return config?.governmentType === "presidential";
}

/**
 * Pure-field variant of {@link isPresidentialCountry} / {@link isDirectElection}
 * for callers that have pre-resolved `governmentType` from the runtime
 * `countryState` collection (Phase 1b migration target).
 */
export function isPresidentialGovernmentType(
  governmentType: GovernmentType | null | undefined
): boolean {
  return governmentType === "presidential";
}

/**
 * Whether the executive can make acting (unconfirmed) cabinet appointments,
 * keyed by {@link CountryConfig.governmentType}.
 *
 * - `presidential` → `true`: legislatures confirm cabinet picks, so the
 *   executive needs an acting-appointment escape hatch for vacancies. Each
 *   acting appointment carries a national-approval penalty.
 * - `parliamentaryMonarchy` / `parliamentaryRepublic` / `onePartyState` →
 *   `false`: cabinet posts are filled directly by the PM/Premier from
 *   legislators of the governing party, so there's no confirmation gap to
 *   bridge with an acting appointment.
 */
export const SUPPORTS_ACTING_APPOINTMENTS_BY_GOVERNMENT_TYPE: Record<
  CountryConfig["governmentType"],
  boolean
> = {
  presidential: true,
  parliamentaryMonarchy: false,
  parliamentaryRepublic: false,
  onePartyState: false,
};

/**
 * True when the country's executive can make acting (unconfirmed) cabinet
 * appointments. Derived from {@link CountryConfig.governmentType} so a
 * future regime change carries acting-appointment semantics with it.
 */
export function supportsActingAppointments(
  config: Pick<CountryConfig, "governmentType"> | null | undefined
): boolean {
  if (!config) return false;
  return SUPPORTS_ACTING_APPOINTMENTS_BY_GOVERNMENT_TYPE[config.governmentType];
}

/**
 * Pure-field variant of {@link supportsActingAppointments} for callers that
 * have pre-resolved `governmentType` from the runtime `countryState`
 * collection (Phase 1b migration target).
 */
export function supportsActingAppointmentsForGovernmentType(
  governmentType: GovernmentType | null | undefined
): boolean {
  if (!governmentType) return false;
  return SUPPORTS_ACTING_APPOINTMENTS_BY_GOVERNMENT_TYPE[governmentType];
}

/**
 * How country-level approval is derived each turn, keyed by
 * {@link CountryConfig.governmentType}.
 *
 * - `presidential` → `"president_favorability"`: approval tracks the
 *   directly-elected President character's favorability.
 * - `parliamentaryMonarchy` / `parliamentaryRepublic` / `onePartyState` →
 *   `"pm_favorability"`: approval tracks the head-of-government character
 *   (PM / Chancellor / Taoiseach / Premier).
 */
export const APPROVAL_SOURCE_BY_GOVERNMENT_TYPE: Record<
  CountryConfig["governmentType"],
  "president_favorability" | "pm_favorability"
> = {
  presidential: "president_favorability",
  parliamentaryMonarchy: "pm_favorability",
  parliamentaryRepublic: "pm_favorability",
  onePartyState: "pm_favorability",
};

export type ApprovalSource =
  (typeof APPROVAL_SOURCE_BY_GOVERNMENT_TYPE)[CountryConfig["governmentType"]];

/**
 * Resolve the approval-derivation source from a government type directly.
 */
export function getApprovalSourceForGovernmentType(
  governmentType: CountryConfig["governmentType"]
): ApprovalSource {
  return APPROVAL_SOURCE_BY_GOVERNMENT_TYPE[governmentType];
}

/**
 * Resolve the approval-derivation source for a country by reading its current
 * {@link CountryConfig.governmentType}. Falls back to `"president_favorability"`
 * when the country is unknown.
 */
export function getApprovalSourceForCountry(countryId: CountryId): ApprovalSource {
  const config = COUNTRY_CONFIGS[countryId];
  if (!config) return "president_favorability";
  return getApprovalSourceForGovernmentType(config.governmentType);
}

/**
 * Default for {@link CountryConfig.confidenceVoteMechanism} when a country
 * does not explicitly set the field, keyed by
 * {@link CountryConfig.governmentType}.
 *
 * - `parliamentaryMonarchy` / `parliamentaryRepublic` → `true`: government
 *   sits on legislative confidence and can fall to a VONC.
 * - `presidential` → `false`: the executive has a fixed term; impeachment
 *   is a separate mechanism handled outside the VONC flow.
 * - `onePartyState` → `false`: one-party systems block VONCs at runtime
 *   (e.g. CN's `onePartyConstraints.canTriggerNoConfidence()`) so the
 *   generic VONC path stays skipped rather than fired-and-rejected.
 */
export const CONFIDENCE_VOTE_MECHANISM_DEFAULTS_BY_GOVERNMENT_TYPE: Record<
  CountryConfig["governmentType"],
  boolean
> = {
  presidential: false,
  parliamentaryMonarchy: true,
  parliamentaryRepublic: true,
  onePartyState: false,
};

/**
 * True when the country has an active no-confidence mechanism. Returns the
 * country's explicit override if set, otherwise the governmentType-derived
 * default. Use this in preference to reading `config.confidenceVoteMechanism`
 * directly so a country that hasn't bothered to set the field still gets
 * the right answer for its regime.
 */
export function hasConfidenceVoteMechanism(
  config: Pick<CountryConfig, "governmentType" | "confidenceVoteMechanism"> | null | undefined
): boolean {
  if (!config) return false;
  if (typeof config.confidenceVoteMechanism === "boolean") {
    return config.confidenceVoteMechanism;
  }
  return CONFIDENCE_VOTE_MECHANISM_DEFAULTS_BY_GOVERNMENT_TYPE[config.governmentType];
}

/**
 * Pure-field variant of {@link hasConfidenceVoteMechanism} for callers that
 * have pre-resolved `governmentType` from the runtime `countryState`
 * collection (Phase 1b migration target). The `override` parameter takes
 * the country's explicit `confidenceVoteMechanism` setting from
 * COUNTRY_CONFIGS (immutable seed data), with `undefined` deferring to the
 * governmentType-derived default.
 */
export function hasConfidenceVoteMechanismForGovernmentType(
  governmentType: GovernmentType | null | undefined,
  override: boolean | undefined
): boolean {
  if (!governmentType) return false;
  if (typeof override === "boolean") return override;
  return CONFIDENCE_VOTE_MECHANISM_DEFAULTS_BY_GOVERNMENT_TYPE[governmentType];
}

/**
 * Default for {@link CountryConfig.snapElectionsAllowed} when a country does
 * not explicitly set the field, keyed by {@link CountryConfig.governmentType}.
 *
 * - `parliamentaryMonarchy` / `parliamentaryRepublic` → `true`: the governing
 *   party can call an early dissolution.
 * - `presidential` → `false`: fixed terms; no mid-term dissolution.
 * - `onePartyState` → `false`: dominant party doesn't need a strategic snap.
 */
export const SNAP_ELECTIONS_ALLOWED_DEFAULTS_BY_GOVERNMENT_TYPE: Record<
  CountryConfig["governmentType"],
  boolean
> = {
  presidential: false,
  parliamentaryMonarchy: true,
  parliamentaryRepublic: true,
  onePartyState: false,
};

/**
 * True when the country can call snap elections mid-term. Returns the
 * country's explicit override if set, otherwise the governmentType-derived
 * default. Mirrors {@link hasConfidenceVoteMechanism}: parliamentary regimes
 * default to allowing snaps; presidential and one-party states do not.
 */
export function supportsSnapElections(
  config: Pick<CountryConfig, "governmentType" | "snapElectionsAllowed"> | null | undefined
): boolean {
  if (!config) return false;
  if (typeof config.snapElectionsAllowed === "boolean") {
    return config.snapElectionsAllowed;
  }
  return SNAP_ELECTIONS_ALLOWED_DEFAULTS_BY_GOVERNMENT_TYPE[config.governmentType];
}

/**
 * Pure-field variant of {@link supportsSnapElections} for callers that
 * have pre-resolved `governmentType` from the runtime `countryState`
 * collection (Phase 1b migration target).
 */
export function supportsSnapElectionsForGovernmentType(
  governmentType: GovernmentType | null | undefined,
  override: boolean | undefined
): boolean {
  if (!governmentType) return false;
  if (typeof override === "boolean") return override;
  return SNAP_ELECTIONS_ALLOWED_DEFAULTS_BY_GOVERNMENT_TYPE[governmentType];
}

/**
 * Chamber keys whose seated members are eligible for direct cabinet
 * appointment, resolved against the country's governmentType and legislature.
 *
 * - Returns the country's explicit `cabinetEligibleChamberKeys` override if
 *   set (e.g. JP includes both `["shugiin", "sangiin"]`).
 * - Returns `[]` for presidential countries — cabinet appointments don't
 *   draw from a chamber in those systems.
 * - Otherwise returns `[lowerChamber.key]` (parliamentary monarchies,
 *   parliamentary republics, and one-party states pull cabinet ministers
 *   from the lower chamber by default).
 *
 * The presence/absence of a cabinet-chamber concept follows
 * {@link CountryConfig.governmentType} so a future regime change carries
 * cabinet-eligibility semantics with it; the specific chamber-key value
 * tracks the country's actual lower-chamber config.
 */
export function getCabinetEligibleChamberKeys(
  config:
    | Pick<CountryConfig, "governmentType" | "cabinetEligibleChamberKeys" | "legislature">
    | null
    | undefined
): string[] {
  if (!config) return [];
  if (config.cabinetEligibleChamberKeys) return config.cabinetEligibleChamberKeys;
  if (!isParliamentarySystem(config)) return [];
  return [config.legislature.lowerChamber.key];
}

/**
 * Default for {@link CountryConfig.hasImperialRole} when a country does not
 * explicitly set the field, keyed by {@link CountryConfig.governmentType}.
 *
 * - `parliamentaryMonarchy` → `true`: constitutional monarchies always have a
 *   ceremonial monarch / emperor (UK, JP).
 * - All other types → `false`: presidential / one-party / parliamentary
 *   republic systems may or may not have a ceremonial head of state, so the
 *   default is conservative. Countries with a ceremonial figurehead override
 *   explicitly (e.g. DE for Bundespräsident).
 */
export const HAS_IMPERIAL_ROLE_DEFAULTS_BY_GOVERNMENT_TYPE: Record<
  CountryConfig["governmentType"],
  boolean
> = {
  presidential: false,
  parliamentaryMonarchy: true,
  parliamentaryRepublic: false,
  onePartyState: false,
};

/**
 * True when the country has a ceremonial imperial head of state (monarch,
 * emperor, or non-executive president). Returns the country's explicit
 * override if set, otherwise the governmentType-derived default. Renamed
 * from the field name to avoid shadowing `config.hasImperialRole`.
 */
export function isImperialCountry(
  config: Pick<CountryConfig, "governmentType" | "hasImperialRole"> | null | undefined
): boolean {
  if (!config) return false;
  if (typeof config.hasImperialRole === "boolean") {
    return config.hasImperialRole;
  }
  return HAS_IMPERIAL_ROLE_DEFAULTS_BY_GOVERNMENT_TYPE[config.governmentType];
}

/**
 * Pure-field variant of {@link isImperialCountry} for callers that have
 * pre-resolved `governmentType` from the runtime `countryState`
 * collection (Phase 1b migration target).
 */
export function isImperialForGovernmentType(
  governmentType: GovernmentType | null | undefined,
  override: boolean | undefined
): boolean {
  if (!governmentType) return false;
  if (typeof override === "boolean") return override;
  return HAS_IMPERIAL_ROLE_DEFAULTS_BY_GOVERNMENT_TYPE[governmentType];
}

/**
 * Default for {@link CountryConfig.headOfStateTitle} when a country does not
 * explicitly set the field, keyed by {@link CountryConfig.governmentType}.
 *
 * - `parliamentaryMonarchy` → `"Monarch"`: generic constitutional-monarch
 *   term. Countries with culturally-specific titles override (JP uses
 *   `"Emperor"`).
 * - All other types → `"President"`: presidential systems (where head of
 *   state = executive), parliamentary republics (ceremonial president), and
 *   one-party states (ceremonial president) all use "President".
 */
export const HEAD_OF_STATE_TITLE_DEFAULTS_BY_GOVERNMENT_TYPE: Record<
  CountryConfig["governmentType"],
  string
> = {
  presidential: "President",
  parliamentaryMonarchy: "Monarch",
  parliamentaryRepublic: "President",
  onePartyState: "President",
};

/**
 * Resolve the head-of-state title for a country. Returns the explicit
 * override if set, otherwise the governmentType-derived default.
 */
export function getHeadOfStateTitle(
  config: Pick<CountryConfig, "governmentType" | "headOfStateTitle"> | null | undefined
): string {
  if (!config) return "President";
  if (config.headOfStateTitle) return config.headOfStateTitle;
  return HEAD_OF_STATE_TITLE_DEFAULTS_BY_GOVERNMENT_TYPE[config.governmentType];
}

/**
 * Office-type key of a country's ceremonial head of state (the office marked
 * `isHeadOfState`), or null when none exists. Used to resolve the office-based
 * head of state for non-monarchy systems (CN President of the PRC, IE Uachtarán).
 * Monarchies (parliamentaryMonarchy) render via the imperial-character system
 * and return null here.
 */
export function getHeadOfStateOfficeType(
  config: Pick<CountryConfig, "officeTypes"> | null | undefined
): string | null {
  return config?.officeTypes.find((o) => o.isHeadOfState)?.key ?? null;
}

/**
 * Pure-field variant of {@link getHeadOfStateTitle} for callers that have
 * pre-resolved `governmentType` from the runtime `countryState`
 * collection (Phase 1b migration target).
 */
export function getHeadOfStateTitleForGovernmentType(
  governmentType: GovernmentType | null | undefined,
  override: string | undefined
): string {
  if (!governmentType) return "President";
  if (override) return override;
  return HEAD_OF_STATE_TITLE_DEFAULTS_BY_GOVERNMENT_TYPE[governmentType];
}

/**
 * Returns the office type configuration for a given key within a country.
 * Used by the engine and action systems to look up partyStrengthWeight and actionBonus.
 * Pass `preset` when office metadata may be era-dependent (France 1953 overlay).
 */
export function getOfficeTypeConfig(
  countryId: CountryId,
  officeKey: string,
  preset?: string
): OfficeTypeConfig | undefined {
  return getCountryConfig(countryId, preset).officeTypes.find((o) => o.key === officeKey);
}

/** Maps country to the office key used for regional executive assent on state bills. */
const REGIONAL_BILL_ASSENT_OFFICE_KEY: Partial<Record<CountryId, string>> = {
  US: "governor",
  UK: "governor",
  JP: "governor",
  IE: "governor",
  DE: "ministerPresident",
  // One-party regional executives — Republic / Land First Secretaries. Without
  // these entries the region pages fell back to the generic "Governor" label.
  RU: "governor",
  DD: "governor",
};

/**
 * State-aware regional-executive label. Overrides the country-level title
 * for regions whose executive has a distinct title (UK LON → "Mayor of
 * London"); falls back to {@link getRegionalBillAssentTitle} otherwise.
 *
 * Mirrors the per-state branching in `getRegionalExecutive` so bill-flow
 * UI (sponsor notifications, office page titles, bill-detail headers)
 * renders the right executive name for each region.
 */
export function getRegionalBillAssentTitleForState(
  countryId: CountryId,
  stateId: string | undefined | null
): string {
  if (countryId === "UK" && stateId && stateId.toUpperCase() === "LON") {
    return "Mayor of London";
  }
  if (countryId === "IE" && stateId) {
    const upper = stateId.toUpperCase();
    if (upper === "DUB") return "Lord Mayor of Dublin";
    if (upper === "COR") return "Lord Mayor of Cork";
    if (upper === "LIM") return "Mayor of Limerick";
    if (upper === "GAL") return "Mayor of Galway";
    // Other IE regions fall through to default "Cathaoirleach" via
    // regionalBillAssentTitle on the country config.
  }
  return getRegionalBillAssentTitle(countryId);
}

/**
 * Short label for the regional chief executive who signs or vetoes sub-national bills
 * (filters, timeline, status badges). Uses {@link CountryConfig.regionalBillAssentTitle} when set.
 *
 * For per-region UI surfaces, prefer {@link getRegionalBillAssentTitleForState} so
 * regions with distinct executive titles (e.g. UK LON's Mayor of London)
 * render the right label.
 */
export function getRegionalBillAssentTitle(countryId: CountryId): string {
  const cfg = COUNTRY_CONFIGS[countryId];
  if (cfg.regionalBillAssentTitle) return cfg.regionalBillAssentTitle;
  const key = REGIONAL_BILL_ASSENT_OFFICE_KEY[countryId];
  if (key) {
    const office = getOfficeTypeConfig(countryId, key);
    if (office) return office.label;
  }
  return "Governor";
}

/**
 * Returns the `officeType` key used on `electedOfficials` for the country's
 * regional chief executive — "governor" for US / UK / JP, "ministerPresident"
 * for DE. UK and JP recycle the "governor" key for their devolved executives
 * (UK: First Ministers + Mayor of London; JP: regional governors), since the
 * mechanical shape — single-seat, direct election, 4-year cycle — is identical.
 * Display labels diverge per-country (and per-state for UK) and are resolved
 * by `getRegionalExecutive` in `src/lib/states/regionalExecutive.ts`.
 */
export function getRegionalExecutiveOfficeKey(countryId: CountryId): string {
  return REGIONAL_BILL_ASSENT_OFFICE_KEY[countryId] ?? "governor";
}

/**
 * Returns the set of major party IDs for FPTP spoiler modelling.
 * For the UK, the set is region-dependent (SNP/Labour in Scotland, etc.).
 * The `parentRegionId` corresponds to UK_NATIONS (ENG, SCO, WAL, NIR).
 */
export function getMajorPartiesForRegion(
  countryId: CountryId,
  parentRegionId?: string
): Set<string> {
  if (countryId === "UK") {
    // UK party IDs in the DB use the "uk_" prefix (uk_labour, uk_conservative, etc.)
    if (parentRegionId === "SCO") return new Set(["uk_snp", "uk_labour"]);
    if (parentRegionId === "WAL") return new Set(["uk_labour", "uk_conservative"]);
    if (parentRegionId === "NIR") return new Set(["uk_dup", "uk_sf"]);
    // England and national fallback
    return new Set(["uk_labour", "uk_conservative"]);
  }
  if (countryId === "JP") {
    // Nippon Ishin dominates Kansai as the main opposition
    if (parentRegionId === "KNS") return new Set(["ishin", "ldp"]);
    return new Set(COUNTRY_CONFIGS[countryId].majorPartyIds);
  }
  if (countryId === "US") {
    // Legacy tests/fixtures use slug IDs, while production US candidates store
    // PoliticalParty.sequentialId strings. Treat both encodings as major-party
    // IDs so FPTP spoiler modelling works in live sequential-ID elections.
    return new Set([...COUNTRY_CONFIGS.US.majorPartyIds, "1", "2"]);
  }
  // All other countries: use their configured majorPartyIds
  return new Set(COUNTRY_CONFIGS[countryId].majorPartyIds);
}

/**
 * Returns the party-strength weight for a given office type within a country.
 * Replaces the hardcoded PARTY_STRENGTH_BY_OFFICE constant in electionEngine.ts.
 * Falls back to 0.9 if the office type is not found.
 */
export function getPartyStrengthWeight(countryId: CountryId, officeKey: string): number {
  return getOfficeTypeConfig(countryId, officeKey)?.partyStrengthWeight ?? 0.9;
}

/**
 * Returns the office-type key for the sub-national legislature (e.g. "stateSenate" for US,
 * "regionalCouncil" for UK/JP). Uses the explicit `subNationalChamber` config when
 * available; otherwise falls back to "stateSenate".
 *
 * Why: the naïve `officeTypes.find(o => o.isSubNational && !o.isExecutive)` picks up
 * sub-national *executive* roles (governor, premier) first because `isExecutive` only
 * tracks national-level executives.
 */
export function getSubNationalLegislatureKey(countryId: CountryId): string {
  const config = getCountryConfig(countryId);
  if (config.subNationalChamber) return config.subNationalChamber.key;
  return "stateSenate";
}

/** Behavioral shape of a region-appointable seat in the admin seat appointer. */
export type RegionSeatKind =
  | "executive" // single-seat regional chief executive (governor / minister-president)
  | "classedUpper" // US-style per-region senate elected in rotating classes
  | "upperChamber" // multi-seat contested upper chamber (RU Soviet of Nationalities)
  | "lowerChamber" // region-elected federal lower house (House / NPC Delegate / Shūgiin / …)
  | "subNationalChamber"; // sub-national legislature (State Senate / People's Congress / Landtag / …)

/**
 * One region-appointable seat group for a country, derived entirely from config.
 * The admin seat appointer (panel + vacant-seats GET + assign-seat POST) renders
 * and validates against this — there are no hardcoded US offices.
 */
export interface RegionAppointableSeatSpec {
  /** `electedOfficials.officeType` + `Character/NPP.currentOffice.type`. */
  officeType: string;
  /** Singular display label, e.g. "Governor", "NPC Delegate", "Senator". */
  label: string;
  /** Panel heading, e.g. "Governor", "Senate", "House", "People's Congress". */
  groupLabel: string;
  kind: RegionSeatKind;
  /** lower/sub-national chambers hold many seats (seatsToAssign); executive/senate are single. */
  multiSeat: boolean;
  /** Which `State` field holds the seat total for a multi-seat group (null otherwise). */
  totalField: "houseDistricts" | "stateSenateSeats" | null;
  /**
   * Per-region seat totals for groups whose apportionment lives in a config
   * map rather than a `State` field (RU Soviet of Nationalities — the D11
   * republic-weighted map). Checked before `totalField` by the admin
   * vacant-seats / assign-seat routes.
   */
  totalsByRegion?: Record<string, number>;
}

/**
 * The ordered set of seats an admin can appoint within a region for a country:
 * regional executive → (US-style classed senate) → region-elected federal lower
 * chamber → sub-national legislature. Drives the generic region seat appointer so
 * every country shows its own offices (CN: governor / NPC Delegate / Provincial
 * Delegate) instead of hardcoded US Senate / House / State Senate.
 */
export function getRegionAppointableSeats(countryId: CountryId): RegionAppointableSeatSpec[] {
  const config = getCountryConfig(countryId);
  const specs: RegionAppointableSeatSpec[] = [];

  // 1. Regional chief executive (governor / minister-president). Always present.
  const execKey = getRegionalExecutiveOfficeKey(countryId);
  const execLabel = getOfficeTypeConfig(countryId, execKey)?.label ?? "Governor";
  specs.push({
    officeType: execKey,
    label: execLabel,
    groupLabel: execLabel,
    kind: "executive",
    multiSeat: false,
    totalField: null,
  });

  // 2. US-style per-region classed senate (only when explicitly flagged on the
  //    upper chamber). Classes themselves come from SENATE_CLASSES at runtime.
  const upper = config.legislature.upperChamber;
  if (upper && upper.elected && upper.regionElectedClasses) {
    const upperOffice = config.officeTypes.find(
      (o) => o.chamberKey === upper.key && !o.isExecutive && !o.isSubNational
    );
    if (upperOffice) {
      specs.push({
        officeType: upperOffice.key,
        label: upperOffice.label,
        groupLabel: upper.shortName,
        kind: "classedUpper",
        multiSeat: false,
        totalField: null,
      });
    }
  }

  // 2b. Multi-seat contested upper chamber (RU Soviet of Nationalities):
  //     elected per region but not class-rotated. Apportionment lives in a
  //     config map (D11), not a `State` field, so the spec carries the totals.
  if (upper && upper.elected && !upper.regionElectedClasses) {
    const upperOffice = config.officeTypes.find(
      (o) => o.chamberKey === upper.key && !o.isExecutive && !o.isSubNational
    );
    const totalsByRegion = countryId === "RU" ? RU_NATIONALITIES_SEATS : undefined;
    if (upperOffice && totalsByRegion) {
      specs.push({
        officeType: upperOffice.key,
        label: upperOffice.label,
        groupLabel: upper.shortName,
        kind: "upperChamber",
        multiSeat: true,
        totalField: null,
        totalsByRegion,
      });
    }
  }

  // 3. Region-elected federal lower chamber (House / NPC Delegate / Shūgiin / Bundestag / Dáil / Commons).
  const lowerKey = config.legislature.lowerChamber.key;
  const lowerOffice = config.officeTypes.find(
    (o) => o.chamberKey === lowerKey && !o.isExecutive && !o.isSubNational
  );
  if (lowerOffice) {
    specs.push({
      officeType: lowerOffice.key,
      label: lowerOffice.label,
      groupLabel: config.legislature.lowerChamber.shortName,
      kind: "lowerChamber",
      multiSeat: true,
      totalField: "houseDistricts",
    });
  }

  // 4. Sub-national legislature (State Senate / People's Congress / Landtag / Regional Council).
  const subKey = getSubNationalLegislatureKey(countryId);
  const subOffice = getOfficeTypeConfig(countryId, subKey);
  if (subOffice) {
    specs.push({
      officeType: subKey,
      label: subOffice.label,
      groupLabel: config.subNationalChamber?.shortName ?? subOffice.labelPlural,
      kind: "subNationalChamber",
      multiSeat: true,
      totalField: "stateSenateSeats",
    });
  }

  return specs;
}

/**
 * Election-type keys a Governor's-Office can endorse from within their state:
 * the sub-national legislature plus any elected federal chambers (House/Senate
 * for US, Commons for UK, Bundestag for DE, Shugiin/Sangiin for JP). Appointed
 * chambers (UK Lords, DE Bundesrat) are excluded because they have no
 * elections to endorse in. Also includes the legacy "stateHouse" key for
 * older fixtures.
 *
 * Used to filter `elections.find({ state: regionId, electionType: { $in } })`
 * so a governor sees races in their state at every electable level.
 */
export function getEndorseableElectionTypes(countryId: CountryId): string[] {
  const config = getCountryConfig(countryId);
  const subNational = getSubNationalLegislatureKey(countryId);
  const federalLower = config.legislature?.lowerChamber?.key;
  const upperChamber = config.legislature?.upperChamber;
  const federalUpper = upperChamber && upperChamber.elected === true ? upperChamber.key : undefined;
  // Directly-elected national executive (US President). Excluded for
  // parliamentary systems where the PM emerges from legislative confidence
  // rather than a direct election.
  const presidential = isDirectElection(config) ? ["president"] : [];
  // Returned in display priority order: executive → upper chamber → lower
  // chamber → sub-national legislature. Callers can sort races against this
  // array's index for consistent UI ordering.
  return [
    ...presidential,
    ...(federalUpper ? [federalUpper] : []),
    ...(federalLower ? [federalLower] : []),
    subNational,
    "stateSenate",
    "stateHouse",
  ];
}

/**
 * Election-type keys a sitting head-of-government (President / PM /
 * Chancellor) can endorse, in display priority order: upper chamber → lower
 * chamber → regional executive (Governor / Minister-President) → sub-
 * national legislature. The leader's own seat (President / PM) is excluded
 * — no self-endorsement of the national executive race.
 */
export function getExecutiveEndorseableElectionTypes(countryId: CountryId): string[] {
  const config = getCountryConfig(countryId);
  const subNational = getSubNationalLegislatureKey(countryId);
  const federalLower = config.legislature?.lowerChamber?.key;
  const upperChamber = config.legislature?.upperChamber;
  const federalUpper = upperChamber && upperChamber.elected === true ? upperChamber.key : undefined;
  const regionalExecutive = getRegionalExecutiveOfficeKey(countryId);
  return [
    ...(federalUpper ? [federalUpper] : []),
    ...(federalLower ? [federalLower] : []),
    regionalExecutive,
    subNational,
    "stateSenate",
    "stateHouse",
  ];
}

/**
 * Returns the locale code for user-facing text rendered for the given country.
 * UK → en-GB; everything else defaults to en-US.
 */
export function getCountryLocale(countryId: CountryId): "en-US" | "en-GB" {
  return countryId === "UK" ? "en-GB" : "en-US";
}

/**
 * True when the country runs on the parliamentary code path — executive
 * emerges from legislative confidence rather than a direct election.
 *
 * Covers `"parliamentaryMonarchy"`, `"parliamentaryRepublic"`, and
 * `"onePartyState"`. One-party states use the parliamentary mechanics for
 * now (PM appointment, regional budgets, legislation freeze, etc.) and will
 * diverge in a future one-party subsystem.
 *
 * Use this in preference to comparing against a single enum literal so
 * future enum additions keep the same shared-behaviour surface area.
 */
export function isParliamentarySystem(
  config: Pick<CountryConfig, "governmentType"> | null | undefined
): boolean {
  return isParliamentarySystemForGovernmentType(config?.governmentType);
}

/**
 * Pure-field variant of {@link isParliamentarySystem} for callers that
 * have pre-resolved `governmentType` from the runtime `countryState`
 * collection (Phase 1b migration target).
 */
export function isParliamentarySystemForGovernmentType(
  governmentType: GovernmentType | null | undefined
): boolean {
  return (
    governmentType === "parliamentaryMonarchy" ||
    governmentType === "parliamentaryRepublic" ||
    governmentType === "onePartyState"
  );
}

const REGIONAL_ADDRESS_NAME: Partial<Record<CountryId, string>> = {
  DE: "Government Statement",
};

/**
 * User-facing name of the regional "State of the State" analogue.
 * Defaults to "State of the State" when no country-specific override exists.
 */
export function getRegionalAddressName(countryId: CountryId): string {
  return REGIONAL_ADDRESS_NAME[countryId] ?? "State of the State";
}

const NATIONAL_ADDRESS_NAME: Partial<Record<CountryId, string>> = {
  US: "State of the Union",
  UK: "Address to the Nation",
  DE: "Government Declaration",
  JP: "Policy Speech",
  IE: "Address to the Oireachtas",
};

/**
 * User-facing name of the national-level address (head of government's
 * equivalent to the governor's State of the State). Defaults to "Address
 * to the Nation" when no country-specific override exists.
 */
export function getNationalAddressName(countryId: CountryId): string {
  return NATIONAL_ADDRESS_NAME[countryId] ?? "Address to the Nation";
}

/**
 * User-facing name for the head-of-government order at the national scope.
 * Presidential systems use "Executive Order"; parliamentary systems use
 * "Order in Council" (the historical British constitutional term, applied
 * across all parliamentary countries in the sim for consistency).
 */
export function getExecutiveOrderName(countryId: CountryId): string {
  const config = COUNTRY_CONFIGS[countryId];
  return getExecutiveOrderNameForGovernmentType(config?.governmentType);
}

/**
 * Pure-field variant of {@link getExecutiveOrderName} for callers that have
 * pre-resolved `governmentType` from the runtime `countryState` collection
 * (Phase 1b migration target).
 */
export function getExecutiveOrderNameForGovernmentType(
  governmentType: GovernmentType | null | undefined
): string {
  return governmentType === "presidential" ? "Executive Order" : "Order in Council";
}

/**
 * Plural form for headers ("Executive Orders" vs "Orders in Council") — the
 * naive `+ "s"` would produce "Order in Councils" which is grammatically wrong.
 */
export function getExecutiveOrderNamePlural(countryId: CountryId): string {
  const config = COUNTRY_CONFIGS[countryId];
  return getExecutiveOrderNamePluralForGovernmentType(config?.governmentType);
}

/**
 * Pure-field variant of {@link getExecutiveOrderNamePlural}.
 */
export function getExecutiveOrderNamePluralForGovernmentType(
  governmentType: GovernmentType | null | undefined
): string {
  return governmentType === "presidential" ? "Executive Orders" : "Orders in Council";
}
