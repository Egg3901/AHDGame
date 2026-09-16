import type { CabinetIdentity } from "@/lib/constants/cabinetIdentity";
import type { CountryConfig, EraCountryConfigOverride } from "@/lib/constants/countries";
import type { EconomyIdentity } from "@/lib/constants/economyIdentity";
import type { ExecutiveSeal } from "@/lib/constants/executiveSeals";
import type { ExecutiveSurfaceConfig } from "@/lib/constants/executiveSurface";
import type { IdentityText } from "@/lib/constants/institutionIdentity";
import type { CabinetGroup } from "@/lib/constants/cabinetPositionGroups";
import type { Branch } from "@/lib/constants/military";
import type { EraMonetaryBaseline } from "@/lib/constants/monetaryEra";
import type { NationalIdentity } from "@/lib/constants/nationalIdentity";
import type { StatsIdentity } from "@/lib/constants/nationalStatsIdentity";
import type { ParliamentaryExecutiveSurface } from "@/lib/constants/parliamentaryExecutiveSurface";
import type { CensusLabelSet } from "@/lib/constants/regionCensusLabels";
import type { TreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import type { RosterThunk } from "@/lib/demographics/substrateCoverage";
import type { LegislativeProcess } from "@/lib/legislature/process";
import type { CalibrationTarget } from "@/lib/seeds/calibration/types";
import type { PresetBundles } from "@/lib/seeds/regionCensusData";
import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";
import type { CountryElectionPhaseEntry } from "@/lib/turn/countryPhases";
import type { SpawnElectionsHandler } from "@/lib/turn/perpetualElections/registry";
import type { ShippingPreset } from "@/lib/world/eraRoster";

/**
 * The shape a country folder declares.
 *
 * Every member type is defined HERE, before any phase moves anything, so no
 * later phase can reference a type that does not yet exist. Entry types are
 * imported from their current homes rather than re-declared: a second copy of a
 * shape is a second thing to keep in sync, which is the failure this whole plan
 * exists to stop.
 *
 * Which files each member absorbs, and which phase does it, is tracked
 * mechanically in `jpCoverage.ts` -- not in prose here.
 *
 * NOTHING IMPLEMENTS THIS YET. D1 builds the shape and the harness; D2 onward
 * fill it in one subject at a time.
 */

/**
 * D2 -- identity and labels.
 *
 * Absorbs: CABINET_IDENTITY, NATIONAL_IDENTITY, NATIONAL_STATS_IDENTITY,
 * TREASURY_IDENTITY, TREASURY_TEXT, ECONOMY_TEXT, EXECUTIVE_TEXT, POLICY_TEXT,
 * EXECUTIVE_SEALS, EXECUTIVE_SURFACE, SURFACES (the parliamentary one),
 * REGION_CENSUS_LABELS, NATIONAL_ADDRESS_NAME, STATE_DISPLAY_NAMES,
 * COUNTRY_HISTORICAL_NAMES, COUNTRY_MODERN_NAMES.
 */
export interface CountryIdentity {
  readonly displayName: string;
  readonly cabinet: CabinetIdentity;
  readonly national: NationalIdentity;
  readonly stats: StatsIdentity;
  /**
   * ⚠️ The authored TEXT only. There is deliberately no `treasury` field, because
   * TREASURY_IDENTITY is DERIVED: treasuryIdentity.ts:324 composes it as
   * `{ ...TREASURY_TEXT[c], palette, accent, accentSoft }` from
   * getNationalIdentity(c). It recomposes itself once the text moves, so holding
   * a copy here would create a second source of the same values.
   */
  readonly treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft">;
  readonly economyText: Omit<EconomyIdentity, "accent">;
  readonly executiveText: IdentityText;
  readonly policyText: IdentityText;
  readonly executiveSeal: ExecutiveSeal;
  readonly executiveSurface: ExecutiveSurfaceConfig;
  /**
   * The PARLIAMENTARY surface. `onePartyExecutiveSurface.ts` declares a symbol
   * of the same name that is NOT Japan's and does not move.
   */
  readonly parliamentarySurface: ParliamentaryExecutiveSurface;
  readonly regionCensusLabels: CensusLabelSet;
  /** Region display names (STATE_DISPLAY_NAMES), used by the commodity map. */
  readonly stateDisplayNames: Readonly<Record<string, string>>;
  /**
   * `regional` is OPTIONAL: Japan has no REGIONAL_ADDRESS_NAME entry and uses the
   * documented "State of the State" default. Requiring it would author a fallback
   * into an authored value and break the harness on `undefined` vs a string.
   */
  readonly addressNames: { readonly national: string; readonly regional?: string };
  readonly historicalNames?: readonly string[];
  readonly modernNames?: readonly string[];
  /**
   * Preset-keyed and absent for most countries. ERA_COUNTRY_NAMES holds only
   * 1953/1979 entries for DE and RU; Japan has none, so this stays optional and
   * D2 asserts its absence rather than inventing a value.
   */
  readonly eraNames?: Partial<Record<ShippingPreset, string>>;
}

/**
 * D3 -- institutions.
 *
 * Absorbs: COUNTRY_CONFIGS.JP, REGIONAL_BILL_ASSENT_OFFICE_KEY,
 * ENERGY_POSITION_BY_COUNTRY, INFRA_POSITION_BY_COUNTRY,
 * MILITARY_BRANCHES_BY_COUNTRY, MILITARY_COUNTRY_SCALE,
 * DEFENSE_POSITION_BY_COUNTRY, FOREIGN_AFFAIRS_POSITION_BY_COUNTRY,
 * TRADE_MINISTER_POSITION_BY_COUNTRY, ESTATE_PORTFOLIO_BY_COUNTRY,
 * LEGISLATIVE_PROCESS, ORDERS_OF_BATTLE.
 */
export interface CountryInstitutions {
  readonly config: CountryConfig;
  readonly legislativeProcess: LegislativeProcess;
  readonly regionalBillAssentOfficeKey?: string;
  /**
   * Cabinet seat ids. Five of these are one id or null; ESTATE_PORTFOLIO is a
   * portfolio MAP, not a position, which is why it is typed separately.
   */
  /**
   * ⚠️ These are NOT uniformly optional, and they are not uniformly nullable.
   * The forwarders exposed it: ENERGY and INFRA live in `Partial<Record<...,
   * string>>` so they are `string | undefined`, while DEFENSE, FOREIGN_AFFAIRS
   * and TRADE_MINISTER live in `Record<..., string | null>` so they are required
   * and nullable. Declaring all five the same way compiles in the folder and
   * fails at every forwarder.
   */
  readonly positions: {
    readonly energy?: string;
    readonly infrastructure?: string;
    readonly defense: string | null;
    readonly foreignAffairs: string | null;
    readonly tradeMinister: string | null;
  };
  readonly estatePortfolio: Record<string, string>;
  /**
   * Cabinet data. `orders` and `mechanics` are the SAME objects the registries
   * ORDERS_BY_COUNTRY and MECHANICS_BY_COUNTRY hold for Japan -- their source
   * files were relocated into the folder, so those registries already forward
   * here. Holding copies would be a second source of 1,333 lines.
   */
  readonly cabinet: {
    readonly positions: readonly unknown[];
    readonly orders: Readonly<Record<string, unknown>>;
    readonly mechanics: Readonly<Record<string, unknown>>;
    readonly groups: Record<string, CabinetGroup>;
  };
  readonly military: {
    /**
     * ⚠️ Branch objects, not names. D1 guessed `string[]` here and the generated
     * module caught it: each entry carries id, name, abbr, domain and
     * establishedYear, with dissolvedYear on the branches that were disbanded.
     */
    readonly branches: Branch[];
    readonly scale: number;
    readonly ordersOfBattle: OrderOfBattleEntry[];
  };
}

/**
 * D3 -- elections.
 *
 * Absorbs: COUNTRY_BILL_PHASES, COUNTRY_ELECTION_PHASES,
 * SPAWN_ELECTIONS_REGISTRY, and Japan's seat tables.
 *
 * `spawn` is FUNCTION-VALUED, so the faithful-replacement harness cannot compare
 * it with toEqual. It is pinned by behaviour instead; see MovedThunkRegistry.
 *
 * Seat tables live in constants/states.ts as JP_SHUGIIN_SEATS (465),
 * JP_SANGIIN_SEATS (248) and JP_GOVERNOR_SEATS. They carry no `JP:` key and the
 * file is not Japan-named, which is why four earlier coverage rules missed them.
 */
export interface CountryElections {
  readonly spawn?: SpawnElectionsHandler;
  readonly billPhases?: unknown;
  /**
   * `{ name, fn }` per phase. The fn values are FUNCTIONS, so toEqual compares
   * them by reference and the ordinary harness is blind -- see
   * MOVED_THUNK_REGISTRIES. Typed as the registry's own entry type rather than a
   * structural guess, because `fn: unknown` compiles in the folder and fails at
   * the forwarder.
   */
  readonly electionPhases?: CountryElectionPhaseEntry[];
  readonly seats: {
    readonly byChamber: Readonly<Record<string, Readonly<Record<string, number>>>>;
    readonly totals: Readonly<Record<string, number>>;
  };
}

/**
 * D4 -- economy and fiscal.
 *
 * Absorbs: COUNTRY_CURRENCY_MAP, ECONOMIC_BASELINES, MONETARY_BASELINES and its
 * 1953/1971/1979/1991 era tables, COST_SCALE_ANCHORS,
 * SOVEREIGN_CORP_LEGAL_STRUCTURE, M2_TO_GDP_1953, COUNTRY_SECTOR_WEIGHTS and its
 * 1979/1991 era tables, DEFAULT_STRATEGIC_SECTORS, REP_ECON,
 * TREASURY_PS_RATE_BY_COUNTRY, NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY,
 * NEUTRAL_STATE_SALES_TAX_BY_COUNTRY, PLAYER_PAYOUT_CAP_PER_TURN,
 * NATIONAL_POLICY_STATE_IDS, LEGISLATION_COUNTRY_SCOPES.
 *
 * ⚠️ Exchange rates do NOT belong here. INITIAL_RATES* is relational -- a rate is
 * a fact BETWEEN two currencies, so a per-country copy drifts. Same for the two
 * SOE base tables in budgets.ts. See bucket B in jpCoverage.ts.
 *
 * ⚠️ REP_ECON and the sector-weight tables are BALANCE surfaces. A changed number
 * here needs a GitHub issue and a scripts/sim/ report per CLAUDE.md. This move
 * must change none of them.
 */
export interface CountryEconomy {
  readonly currencyCode: string;
  readonly nationalPolicyStateId: string;
  readonly monetary: {
    readonly baseline?: EraMonetaryBaseline;
    readonly byEra: Partial<Record<ShippingPreset, EraMonetaryBaseline>>;
  };
  readonly sectorWeights: {
    readonly base?: Readonly<Record<string, number>>;
    readonly byEra: Partial<Record<ShippingPreset, Readonly<Record<string, number>>>>;
  };
  readonly strategicSectors?: readonly string[];
  readonly tax: {
    readonly neutralFederalSalesTax?: number;
    readonly neutralStateSalesTax?: number;
    readonly treasuryPsRate?: number;
  };
  readonly payoutCapPerTurn?: number;
  readonly sovereignCorpLegalStructure?: string;
  readonly calibrationTargets?: Partial<Record<string, CalibrationTarget>>;
}

/**
 * D5 -- geography, regions, demographics.
 *
 * Absorbs: COUNTRY_CONTINENT, COUNTRY_TO_ISO_NUMERIC with its inverse,
 * COUNTRY_UN_MEMBER_SINCE, STATE_ADJACENCY, REGION_ROSTERS,
 * FULL_ERA_REGION_BUNDLES, REGION_NAME_MAPS, NPP_CAPITAL_STATES,
 * COUNTRY_MAP_REGISTRY, HAZARD_GROUPS, COUNTRY_REGIONS,
 * REGION_DEMOGRAPHIC_CATEGORY_IDS, CENSUS_BUNDLES, POPULATION_MULTIPLIERS,
 * CONSCRIPTION_SEED, POPULATION_ANCHOR_BUNDLES, METRIC_PRESET_BUNDLES,
 * CORE5_NORMALS, INCOME_ANCHORS, TARGETS, RAW_BUNDLES,
 * COUNTRY_ERA1991_PATCHES.
 *
 * ⚠️ `rosters` is FUNCTION-VALUED (RosterThunk) and nested country -> era, so the
 * harness must walk both levels and compare RESOLVED output, not references.
 *
 * ⚠️ CORE5_NORMALS is METRIC-first with a `global` pseudo-country. There is no
 * CORE5_NORMALS.JP to read; Japan's values sit under eight metric keys beside
 * `global` fallbacks that must not move.
 */
export interface CountryGeography {
  readonly continent: string;
  readonly isoNumeric: string;
  readonly unMemberSince?: number;
  readonly adjacency: Readonly<Record<string, readonly string[]>>;
  readonly rosters: Partial<Record<ShippingPreset, RosterThunk>>;
  readonly regionNames: Readonly<Record<string, string>>;
  readonly censusBundles: PresetBundles;
  readonly demographicCategoryIds?: readonly string[];
  readonly conscription?: unknown;
  readonly hazardGroups?: readonly string[];
  readonly nppCapitalState?: string;
}

/**
 * Per-era overrides. All seven SHIPPING_PRESETS get a file, including 1999 and
 * 2007, for which Japan carries real region, census and demographic data.
 *
 * ⚠️ Japan has TWO era config overrides, 1953 and 1991, and the 1953 one holds a
 * full legislature (466 Shugiin / 248 Sangiin). Writing an era file from a table
 * that names only 1991 loses it silently.
 */
export interface CountryEraOverride {
  readonly preset: ShippingPreset;
  readonly config?: EraCountryConfigOverride;
  readonly identity?: Partial<CountryIdentity>;
  /**
   * ⚠️ NOT `Partial<CountryInstitutions>`. `Partial` only makes the TOP level
   * optional, so a nested `military` still demanded `branches` and `scale` from
   * every era that carries only orders of battle. An era override supplies
   * differences, so each nested group is optional in its own right.
   */
  readonly institutions?: {
    readonly military?: {
      readonly branches?: Branch[];
      readonly scale?: number;
      readonly ordersOfBattle?: OrderOfBattleEntry[];
    };
  };
  readonly elections?: Partial<CountryElections>;
  readonly economy?: Partial<CountryEconomy>;
  readonly geography?: Partial<CountryGeography>;
}

/** One country's folder. */
export interface CountryFolder {
  readonly id: string;
  readonly identity: CountryIdentity;
  readonly institutions: CountryInstitutions;
  readonly elections: CountryElections;
  readonly economy: CountryEconomy;
  readonly geography: CountryGeography;
  readonly eras: Partial<Record<ShippingPreset, CountryEraOverride>>;
}
