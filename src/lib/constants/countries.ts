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

import type { CorporationType } from "./corporations";
import type { CurrencyCode } from "./currencies";
import { RU_NATIONALITIES_SEATS } from "./ruSeats";

import type { EraSeedModels } from "./economicModels";
import { JP_IDENTITY } from "@/lib/countries/jp/identity";
import { JP_ERAS } from "@/lib/countries/jp/eras";
import { AT_ERAS } from "@/lib/countries/at/eras";
import { BAL_ERAS } from "@/lib/countries/bal/eras";
import { BG_ERAS } from "@/lib/countries/bg/eras";
import { BLR_ERAS } from "@/lib/countries/blr/eras";
import { BR_ERAS } from "@/lib/countries/br/eras";
import { CN_ERAS } from "@/lib/countries/cn/eras";
import { CS_ERAS } from "@/lib/countries/cs/eras";
import { DD_ERAS } from "@/lib/countries/dd/eras";
import { DE_ERAS } from "@/lib/countries/de/eras";
import { ES_ERAS } from "@/lib/countries/es/eras";
import { FI_ERAS } from "@/lib/countries/fi/eras";
import { FR_ERAS } from "@/lib/countries/fr/eras";
import { GR_ERAS } from "@/lib/countries/gr/eras";
import { HU_ERAS } from "@/lib/countries/hu/eras";
import { IE_ERAS } from "@/lib/countries/ie/eras";
import { IT_ERAS } from "@/lib/countries/it/eras";
import { NG_ERAS } from "@/lib/countries/ng/eras";
import { PL_ERAS } from "@/lib/countries/pl/eras";
import { RO_ERAS } from "@/lib/countries/ro/eras";
import { RU_ERAS } from "@/lib/countries/ru/eras";
import { SE_ERAS } from "@/lib/countries/se/eras";
import { TR_ERAS } from "@/lib/countries/tr/eras";
import { UK_ERAS } from "@/lib/countries/uk/eras";
import { US_ERAS } from "@/lib/countries/us/eras";
import { YU_ERAS } from "@/lib/countries/yu/eras";
import {
  JP_CONFIG,
  JP_REGIONAL_BILL_ASSENT_OFFICE_KEY,
} from "@/lib/countries/jp/institutionsFacts";
import {
  US_CONFIG,
  US_REGIONAL_BILL_ASSENT_OFFICE_KEY,
} from "@/lib/countries/us/institutionsFacts";
import {
  UK_CONFIG,
  UK_REGIONAL_BILL_ASSENT_OFFICE_KEY,
} from "@/lib/countries/uk/institutionsFacts";
import { US_IDENTITY } from "@/lib/countries/us/identity";
import { UK_IDENTITY } from "@/lib/countries/uk/identity";
import {
  DE_CONFIG,
  DE_REGIONAL_BILL_ASSENT_OFFICE_KEY,
} from "@/lib/countries/de/institutionsFacts";
import { DE_IDENTITY } from "@/lib/countries/de/identity";
import { CN_CONFIG } from "@/lib/countries/cn/institutionsFacts";
import {
  IE_CONFIG,
  IE_REGIONAL_BILL_ASSENT_OFFICE_KEY,
} from "@/lib/countries/ie/institutionsFacts";
import { IE_IDENTITY } from "@/lib/countries/ie/identity";
import {
  RU_CONFIG,
  RU_REGIONAL_BILL_ASSENT_OFFICE_KEY,
} from "@/lib/countries/ru/institutionsFacts";
import {
  DD_CONFIG,
  DD_REGIONAL_BILL_ASSENT_OFFICE_KEY,
} from "@/lib/countries/dd/institutionsFacts";
import { NG_CONFIG } from "@/lib/countries/ng/institutionsFacts";
import { BR_CONFIG } from "@/lib/countries/br/institutionsFacts";
import { FR_CONFIG } from "@/lib/countries/fr/institutionsFacts";
import { IT_CONFIG } from "@/lib/countries/it/institutionsFacts";
import { ES_CONFIG } from "@/lib/countries/es/institutionsFacts";
import { SE_CONFIG } from "@/lib/countries/se/institutionsFacts";
import { TR_CONFIG } from "@/lib/countries/tr/institutionsFacts";
import { GR_CONFIG } from "@/lib/countries/gr/institutionsFacts";
import { AT_CONFIG } from "@/lib/countries/at/institutionsFacts";
import { FI_CONFIG } from "@/lib/countries/fi/institutionsFacts";
import { PL_CONFIG } from "@/lib/countries/pl/institutionsFacts";
import { HU_CONFIG } from "@/lib/countries/hu/institutionsFacts";
import { RO_CONFIG } from "@/lib/countries/ro/institutionsFacts";
import { YU_CONFIG } from "@/lib/countries/yu/institutionsFacts";
import { BG_CONFIG } from "@/lib/countries/bg/institutionsFacts";
import { CS_CONFIG } from "@/lib/countries/cs/institutionsFacts";
import { SCO_CONFIG } from "@/lib/countries/sco/institutionsFacts";
import { WAL_CONFIG } from "@/lib/countries/wal/institutionsFacts";
import { BLR_CONFIG } from "@/lib/countries/blr/institutionsFacts";
import { UKR_CONFIG } from "@/lib/countries/ukr/institutionsFacts";
import { BAL_CONFIG } from "@/lib/countries/bal/institutionsFacts";

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
}

export const COUNTRY_CONFIGS: Record<CountryId, CountryConfig> = {
  US: US_CONFIG,

  UK: UK_CONFIG,
  DE: DE_CONFIG,
  JP: JP_CONFIG,

  IE: IE_CONFIG,

  // Latent secession country (Sub-project 1). Authored fully but `coming-soon`
  // and absent from COUNTRY_ORDER, so invisible until the secession actuation
  // (SP2) writes its countryGameStates row. Sterlingized (shares UK's GBP rate).
  SCO: SCO_CONFIG,

  // Latent secession country (Sub-project 1). See SCO above; sterlingized,
  // unicameral Senedd, coming-soon and absent from COUNTRY_ORDER until SP2.
  WAL: WAL_CONFIG,

  BR: BR_CONFIG,

  CN: CN_CONFIG,

  NG: NG_CONFIG,

  // ── Eastern Bloc (1979 iteration) — NPP-run one-party states ────────────────
  // Template for the Warsaw-Pact / socialist roster. `status: "coming-soon"`
  // until its seed stack lands; enablement (NPP-only, econ-locked) is set per
  // preset via countryGameStates. governmentType "onePartyState" drives the
  // parliamentary-style code paths + one-party constraints.
  HU: HU_CONFIG,

  // ── Poland (PZPR) ───────────────────────────────────────────────────────────
  PL: PL_CONFIG,

  // ── Romania (PCR) ───────────────────────────────────────────────────────────
  RO: RO_CONFIG,

  // ── Yugoslavia (SKJ) — non-aligned, battleground ────────────────────────────
  YU: YU_CONFIG,

  // ── Bulgaria (BKP) ──────────────────────────────────────────────────────────
  BG: BG_CONFIG,

  // ── Belarus (BSSR / CPSU) — Soviet ruble ────────────────────────────────────
  BLR: BLR_CONFIG,

  // ── Czechoslovakia (KSČ) ────────────────────────────────────────────────────
  CS: CS_CONFIG,

  // ── Ukraine (Ukrainian SSR, KPU) — Soviet ruble ─────────────────────────────
  UKR: UKR_CONFIG,

  // ── Baltics (combined EE+LV+LT, CPSU) — Soviet ruble ────────────────────────
  BAL: BAL_CONFIG,

  // ── Russia / USSR (RU) — ONE entity; displayed "Soviet Union" in 1979 and
  // "Russia" elsewhere (era name via ERA_COUNTRY_NAMES). Carries the USSR config
  // (one-party / Supreme Soviet / Gosbank / SUR / 17 macro-regions); modern
  // Russia's distinct politics (presidential / Federal Assembly / RUB) and an
  // era-aware flag are a deferred future build. Status stays coming-soon until the
  // seed stack lands; per-game countryGameStates enables it (the 1979 sandbox).
  // RU is already in FOREX_ACTIVE_COUNTRIES (currencies.ts) with SUR as its
  // forex-active currency; the remaining modern-Russia work is the RUB anchor.
  RU: RU_CONFIG,

  // ── France (Tier-2 Econ-enabled, NPP-run) — Fifth Republic default ─────────
  // Semi-presidential (1958–): a directly-elected President (the dominant
  // executive) plus a Prime Minister and a bicameral Parliament. This is the
  // era-neutral / 1979+ default. The 1953-default Fourth Republic overlay
  // (parliamentary republic, ceremonial President, Conseil de la République)
  // lives in {@link ERA_COUNTRY_CONFIG_OVERRIDES} and is applied via
  // {@link getCountryConfig}(id, preset). Status coming-soon until its seed
  // stack lands; economyPreview enablement set per preset via countryGameStates.
  FR: FR_CONFIG,

  // ── Italy (Tier-2 Econ-enabled, NPP-run) — First Republic, 1979 ─────────────
  // Parliamentary republic: a ceremonial President + a Prime Minister governing
  // through a powerful bicameral Parliament (the unstable DC-led coalition era,
  // PCI at its "historic compromise" peak). Status coming-soon until seeded.
  IT: IT_CONFIG,

  // ── Spain (Tier-2 Econ-enabled, NPP-run) — the young democracy, 1979 ────────
  // Parliamentary monarchy under the 1978 Constitution: King Juan Carlos as head
  // of state, a Prime Minister governing through the Cortes Generales, and the
  // autonomous communities just forming. Status coming-soon until seeded.
  ES: ES_CONFIG,

  // ── Sweden (Tier-2 Econ-enabled, NPP-run) — the Swedish model, 1979 ─────────
  // Constitutional monarchy with a unicameral Riksdag (349 seats since the 1970
  // reform). In 1979 a non-socialist coalition governs with the Social Democrats
  // the largest party in opposition. Status coming-soon until seeded.
  SE: SE_CONFIG,

  // ── Turkey (Tier-2 Econ-enabled, NPP-run) — fragile pre-coup republic, 1979 ─
  // Parliamentary republic: a ceremonial President + a Prime Minister governing
  // through a bicameral parliament, amid the unstable AP/CHP coalitions and street
  // violence of the late 1970s (a year before the September 1980 coup). Status
  // coming-soon until seeded.
  //
  // Era note: the 1961-constitution Senato below is correct for 1979-default.
  // 1953-default overrides to a unicameral TBMM via {@link ERA_COUNTRY_CONFIG_OVERRIDES}
  // (no Senate existed until after the 1960 coup).
  TR: TR_CONFIG,

  // ── Greece (econ-tier democracy; Third Hellenic Republic) — 1979 base ──────
  GR: GR_CONFIG,

  // ── Austria (econ-tier democracy; Second Republic) — 1979 base ─────────────
  AT: AT_CONFIG,

  FI: FI_CONFIG,

  // ── East Germany / GDR (NPP-run one-party state; two-state Germany) — 1979 ──
  // SED-led socialist republic with the National Front bloc parties and a planned
  // economy. Player-enabled only via the economy if it decommunises;
  // collapseTargetSystem routes a collapse toward reunification/democracy. Status
  // coming-soon until seeded.
  DD: DD_CONFIG,
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
    | "headOfStateSelection"
    | "majorPartyIds"
    | "usdExchangeRate"
    | "centralGovernmentLabel"
    | "exchangeName"
    | "exchangeKind"
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
  // First non-1953 era to use this table. The lookup was always generic; nothing
  // had exercised it.
  //
  // ⚠️ THIS TABLE IS THE WIRING, NOT THE DATA. A country's era file can define
  // `config` and have it silently ignored, because only the entries listed here
  // are ever consulted. DE/IE/CN each carried a `1991-default` config that
  // reached nothing until they were added below — the folder looked right and
  // the value never applied. Adding an era override means editing BOTH places.
  // 2027 eurozone: FR/IT/ES/GR/AT/FI seed budgets in EUR (see
  // convertEuroMemberBudgetsFor2027), so their GDP→₳ normalization must be the
  // euro-anchored value, not the base legacy-currency rate. Each era file shows
  // the derivation (base × R_legacy/R_EUR from the seeder's rate table). DE is
  // already EUR and IE converts at 1.0, so neither needs an entry.
  "2027-default": {
    FR: FR_ERAS["2027-default"]?.config,
    IT: IT_ERAS["2027-default"]?.config,
    ES: ES_ERAS["2027-default"]?.config,
    GR: GR_ERAS["2027-default"]?.config,
    AT: AT_ERAS["2027-default"]?.config,
    FI: FI_ERAS["2027-default"]?.config,
    HU: HU_ERAS["2027-default"]?.config,
    RO: RO_ERAS["2027-default"]?.config,
    PL: PL_ERAS["2027-default"]?.config,
  },
  "1991-default": {
    UK: UK_ERAS["1991-default"]?.config,
    JP: JP_ERAS["1991-default"]?.config,
    // GDP→anchor normalization (see each era file's header): their regional GDP
    // is authored in local currency, so the anchor is the reciprocal of
    // `INITIAL_RATES_1991`. RU and NG are deliberately absent — see
    // `gdpAnchorRate1991.test.ts`.
    DE: DE_ERAS["1991-default"]?.config,
    IE: IE_ERAS["1991-default"]?.config,
    CN: CN_ERAS["1991-default"]?.config,
    PL: PL_ERAS["1991-default"]?.config,
  },
  "1953-default": {
    US: US_ERAS["1953-default"]?.config,
    TR: TR_ERAS["1953-default"]?.config,
    GR: GR_ERAS["1953-default"]?.config,
    AT: AT_ERAS["1953-default"]?.config,
    FI: FI_ERAS["1953-default"]?.config,
    FR: FR_ERAS["1953-default"]?.config,
    ES: ES_ERAS["1953-default"]?.config,
    SE: SE_ERAS["1953-default"]?.config,
    // Rákosi's MDP (1948–1956); MSZMP only founded after the 1956 revolution.
    HU: HU_ERAS["1953-default"]?.config,
    // Gheorghiu-Dej's PMR (1948–1965); "PCR" name restored only in 1965.
    RO: RO_ERAS["1953-default"]?.config,
    PL: PL_ERAS["1953-default"]?.config,
    CS: CS_ERAS["1953-default"]?.config,
    BG: BG_ERAS["1953-default"]?.config,
    YU: YU_ERAS["1953-default"]?.config,
    DD: DD_ERAS["1953-default"]?.config,
    BLR: BLR_ERAS["1953-default"]?.config,
    BAL: BAL_ERAS["1953-default"]?.config,
    // ── Seat-count alignments to *Regions1953 houseDistricts ───────────────
    UK: UK_ERAS["1953-default"]?.config,
    IT: IT_ERAS["1953-default"]?.config,
    DE: DE_ERAS["1953-default"]?.config,
    JP: JP_ERAS["1953-default"]?.config,
    IE: IE_ERAS["1953-default"]?.config,
    BR: BR_ERAS["1953-default"]?.config,
    CN: CN_ERAS["1953-default"]?.config,
    NG: NG_ERAS["1953-default"]?.config,
    RU: RU_ERAS["1953-default"]?.config,
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
export const REGIONAL_BILL_ASSENT_OFFICE_KEY: Partial<Record<CountryId, string>> = {
  US: US_REGIONAL_BILL_ASSENT_OFFICE_KEY,
  UK: UK_REGIONAL_BILL_ASSENT_OFFICE_KEY,
  JP: JP_REGIONAL_BILL_ASSENT_OFFICE_KEY,
  IE: IE_REGIONAL_BILL_ASSENT_OFFICE_KEY,
  DE: DE_REGIONAL_BILL_ASSENT_OFFICE_KEY,
  // One-party regional executives — Republic / Land First Secretaries. Without
  // these entries the region pages fell back to the generic "Governor" label.
  RU: RU_REGIONAL_BILL_ASSENT_OFFICE_KEY,
  DD: DD_REGIONAL_BILL_ASSENT_OFFICE_KEY,
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
  // Live candidates store `party` as the party's sequentialId string, and the
  // enrichment pass adds `partyAbbr`. The sets below therefore carry BOTH the
  // seed slug (fixtures, seeders) and the abbreviation (live races); match
  // through `partitionMajorParties`, which also falls back to the two largest
  // parties in the race when neither encoding matches (#811).
  if (countryId === "UK") {
    if (parentRegionId === "SCO") return new Set(["uk_snp", "uk_labour", "SNP", "LAB"]);
    if (parentRegionId === "WAL") return new Set(["uk_labour", "uk_conservative", "LAB", "CON"]);
    if (parentRegionId === "NIR") return new Set(["uk_dup", "uk_sf", "DUP", "SF"]);
    // England and national fallback
    return new Set(["uk_labour", "uk_conservative", "LAB", "CON"]);
  }
  if (countryId === "JP") {
    // Nippon Ishin dominates Kansai as the main opposition
    if (parentRegionId === "KNS") return new Set(["ishin", "ldp", "ISHIN", "LDP"]);
    return new Set([
      ...COUNTRY_CONFIGS[countryId].majorPartyIds,
      ...COUNTRY_CONFIGS[countryId].majorPartyIds.map((id) => id.toUpperCase()),
    ]);
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

/**
 * ⚠️ `?.` IS LOAD-BEARING, NOT DEFENSIVE NOISE. The registry is `Partial`, and
 * `addressNames` is optional in the country contract because China has no row
 * here at all -- its reader below falls back to "Address to the Nation". A
 * country that omits the field therefore stays omitted rather than acquiring
 * someone else's phrase.
 */
export const NATIONAL_ADDRESS_NAME: Partial<Record<CountryId, string>> = {
  US: US_IDENTITY.addressNames?.national,
  UK: UK_IDENTITY.addressNames?.national,
  DE: DE_IDENTITY.addressNames?.national,
  JP: JP_IDENTITY.addressNames?.national,
  IE: IE_IDENTITY.addressNames?.national,
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
