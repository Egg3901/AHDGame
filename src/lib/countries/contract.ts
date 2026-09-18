import type { AdjacencyMap } from "@/lib/constants/stateAdjacency";
import type { Continent } from "@/lib/constants/countryContinents";
import type { ConscriptionPolicy } from "@/lib/demographics/conscription";
import type { CountryMapConfig } from "@/lib/commodity-map/commodityMapRegistry";
import type { CountryModifierPatch } from "@/lib/states/conditions/countryPatches";
import type { HazardTag } from "@/lib/db/types/crisis";
import type { NormalAnchor } from "@/lib/era/metricCatalog";
import type { AnchorBundle } from "@/lib/seeds/populationAnchors";
import type { MetricPresetBundle } from "@/lib/seeds/metricPresets";
import type { State, StateMetrics } from "@/lib/db/types";
import type { RegionCensus } from "@/lib/seeds/regionCensusData";
import type { EraId, ResetPresetId } from "@/lib/seeds/presetSelector";
import type { CalibrationTarget } from "@/lib/seeds/calibration/types";
import type { CabinetIdentity } from "@/lib/constants/cabinetIdentity";
import type { CountryConfig, EraCountryConfigOverride } from "@/lib/constants/countries";
import type { EconomyIdentity } from "@/lib/constants/economyIdentity";
import type { ExecutiveSeal } from "@/lib/constants/executiveSeals";
import type { ExecutiveSurfaceConfig } from "@/lib/constants/executiveSurface";
import type { IdentityText } from "@/lib/constants/institutionIdentity";
import type { CostScaleAnchor } from "@/lib/budget/costs";
import type { CabinetGroup } from "@/lib/constants/cabinetPositionGroups";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CurrencyCode, MonetaryBaseline } from "@/lib/constants/currencies";
import type { LegalStructureId } from "@/lib/constants/legalStructures";
import type { GdpDenomination } from "@/lib/seeds/reference/gdpDenomination";
import type { LegislationType } from "@/lib/db/types";
import type { Branch } from "@/lib/constants/military";
import type { CountryCommandFlavor } from "@/lib/military/theaters";
import type { EraMonetaryBaseline } from "@/lib/constants/monetaryEra";
import type { NationalIdentity } from "@/lib/constants/nationalIdentity";
import type { StatsIdentity } from "@/lib/constants/nationalStatsIdentity";
import type { ParliamentaryExecutiveSurface } from "@/lib/constants/parliamentaryExecutiveSurface";
import type { CensusLabelSet } from "@/lib/constants/regionCensusLabels";
import type { TreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import type { LegislativeProcess } from "@/lib/legislature/process";
import type { OrderOfBattleEntry } from "@/lib/seeds/reference/ordersOfBattle";
import type { CountryElectionPhaseEntry } from "@/lib/turn/countryPhases";
import type { MajorDefaultParty } from "@/lib/seeds/defaultPartyTiers";
import type { SpawnElectionsHandler } from "@/lib/turn/perpetualElections/registry";
import type { ShippingPreset } from "@/lib/world/eraRoster";
import type { WorldEntityRegion } from "@/lib/world/worldEntityManifest";

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
 * mechanically in `singleCountryData.ts` -- not in prose here.
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
  /**
   * Situation-board dressing: high-command name, classification strip, accent.
   *
   * ⚠️ REQUIRED, and measured like the optional fields below it -- its registry
   * covers all 29 playable countries, so there is no absence to record.
   *
   * ⚠️ THE ACCENT IS AN INLINE HEX, not the shared WEST_ACC/EAST_ACC constant it
   * was written as. `identity.ts` is client-reachable through this very registry
   * (`SituationBoardClient` imports it) and so must carry NO value imports --
   * `clientSafeLeafModules.test.ts` enforces that. The accents had already
   * diverged from the bloc before the move (DE and CN carry bespoke hexes), so
   * this is per-country dressing, not a bloc fact being copied.
   */
  readonly commandFlavor: CountryCommandFlavor;
  /**
   * ⚠️ MEASURED, NOT GUESSED. `COUNTRY_CONFIGS` holds 29 playable countries.
   * This field's registry holds 9. The others relaxed alongside it hold 8, 10,
   * 26 and 27. Every one of them was `readonly` and required, and every one of
   * their readers already handles the absence -- `getCabinetIdentity` falls back
   * to a documented shell, `getMinisterialOrders` returns `[]`, `getSeal`
   * returns null, `getRegionCensus` returns null "for no bundle for the
   * country", and `seedCabinetEstates` simply `continue`s.
   *
   * They were discovered one country at a time -- Russia relaxed eight, East
   * Germany two more -- until the coverage of all 53 registries was measured
   * against the playable roster in one go. These six are the remainder. See
   * `stats` for why the first cohort hid this.
   */
  readonly cabinet?: CabinetIdentity;
  readonly national: NationalIdentity;
  /**
   * ⚠️ OPTIONAL BECAUSE THE FIRST SIX COUNTRIES WERE NOT THE GAME. This field
   * was required while only Japan, the United States, the United Kingdom,
   * Germany, China and Ireland had folders -- and those six are exactly the
   * countries its registry covers. Russia has a `COUNTRY_CONFIGS` row, a
   * cabinet, regions and elections, and no row here at all; the registry holds
   * six to eight keys in total, so what looked like a contract about countries
   * was a contract about the first cohort.
   *
   * Every reader already handles the absence: this one is
   * `NATIONAL_STATS_IDENTITY[countryId] ?? DEFAULT_STATS_IDENTITY`. A folder
   * that filled the gap with that default would convert a documented fallback
   * into an authored value and hide which countries are really configured.
   *
   * The same reasoning relaxes `economyText`, `legislativeProcess`,
   * `economicBaseline`, `repEcon`, `costScaleAnchors`, `conscription` and
   * `populationMultipliers`. Each one is recorded per country in the runtime
   * harness's ABSENT_UPSTREAM, which fails if the absence ever stops being true.
   */
  readonly stats?: StatsIdentity;
  /**
   * ⚠️ The authored TEXT only. There is deliberately no `treasury` field, because
   * TREASURY_IDENTITY is DERIVED: treasuryIdentity.ts:324 composes it as
   * `{ ...TREASURY_TEXT[c], palette, accent, accentSoft }` from
   * getNationalIdentity(c). It recomposes itself once the text moves, so holding
   * a copy here would create a second source of the same values.
   */
  readonly treasuryText: Omit<TreasuryIdentity, "palette" | "accent" | "accentSoft">;
  readonly economyText?: Omit<EconomyIdentity, "accent">;
  readonly executiveText: IdentityText;
  readonly policyText: IdentityText;
  readonly executiveSeal?: ExecutiveSeal;
  readonly executiveSurface: ExecutiveSurfaceConfig;
  /**
   * The PARLIAMENTARY surface. `onePartyExecutiveSurface.ts` declares a symbol
   * of the same name that is NOT Japan's and does not move.
   *
   * ⚠️ OPTIONAL BECAUSE A PRESIDENTIAL COUNTRY HAS NONE, NOT BECAUSE IT IS
   * SLACK. `SURFACES` in `parliamentaryExecutiveSurface.ts` has no US entry and
   * should not: the US has no parliamentary executive to give a surface to.
   * `contract.test.ts` requires it for every country whose
   * `config.governmentType` is parliamentary, so the requirement moved from
   * "every country" to "every country of this kind" rather than being dropped.
   */
  readonly parliamentarySurface?: ParliamentaryExecutiveSurface;
  /**
   * ⚠️ OPTIONAL BECAUSE THE US IS THE DEFAULT COUNTRY. `REGION_CENSUS_LABELS`
   * has no US key; consumers fall back to the generic labels, and that fallback
   * is not US data hiding behind a US-specific branch -- it is the same text
   * every unlisted country gets. Authoring a US entry here would invent an
   * authored value out of a default, which is the failure this whole exercise
   * exists to prevent, only pointing the other way.
   */
  readonly regionCensusLabels?: CensusLabelSet;
  /**
   * Region display names (STATE_DISPLAY_NAMES), used by the commodity map.
   *
   * ⚠️ OPTIONAL for the same reason. With no US key the map falls back to
   * `compactRegionCode(countryId, stateId)`, which derives from the state id
   * rather than naming anything. There is no US value to move.
   */
  readonly stateDisplayNames?: Readonly<Record<string, string>>;
  /**
   * `regional` is OPTIONAL: Japan has no REGIONAL_ADDRESS_NAME entry and uses the
   * documented "State of the State" default. Requiring it would author a fallback
   * into an authored value and break the harness on `undefined` vs a string.
   *
   * ⚠️ AND SO IS THE WHOLE FIELD, for the same reason one level up. China has no
   * `NATIONAL_ADDRESS_NAME` row at all, and that registry's only reader is
   * `NATIONAL_ADDRESS_NAME[countryId] ?? "Address to the Nation"`. A country that
   * declines to name its address and one whose address is named "Address to the
   * Nation" are different facts, and writing the fallback into the folder would
   * make them indistinguishable from that point on.
   */
  readonly addressNames?: { readonly national: string; readonly regional?: string };
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
  readonly legislativeProcess?: LegislativeProcess;
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
  readonly estatePortfolio?: Record<string, string>;
  /**
   * Cabinet data. `orders` and `mechanics` are the SAME objects the registries
   * ORDERS_BY_COUNTRY and MECHANICS_BY_COUNTRY hold for Japan -- their source
   * files were relocated into the folder, so those registries already forward
   * here. Holding copies would be a second source of 1,333 lines.
   */
  readonly cabinet: {
    /**
     * ⚠️ OPTIONAL BECAUSE A SHARED CABINET IS NOT THIS COUNTRY'S CABINET. Brazil
     * has no `brCabinet.ts`: `MECHANICS_BY_COUNTRY.BR` and its positions sibling
     * both point at `ECON_COUNTRY_CABINET_POSITIONS`, the economy-tier set that
     * NINE countries share. The registry has a BR row, so a coverage count would
     * call it present -- but forwarding it would file shared machinery inside
     * Brazil's folder and make eight other countries' cabinet Brazil's data.
     *
     * That is the opposite failure from an absent row and it looks identical
     * from the registry side. A folder carries what the country AUTHORS.
     */
    readonly positions?: readonly unknown[];
    readonly orders?: Readonly<Record<string, unknown>>;
    /** Optional for the same reason as `positions`: Brazil's is the shared set. */
    readonly mechanics?: Readonly<Record<string, unknown>>;
    /**
     * ⚠️ OPTIONAL: East Germany has no `GROUPS` row, and the only reader is
     * `GROUPS[countryId]?.[positionId] ?? "Centre"` -- already written for the
     * absence. See `stats` on CountryIdentity for why the first cohort made so
     * many of these look required.
     */
    readonly groups?: Record<string, CabinetGroup>;
  };
  readonly military: {
    /**
     * ⚠️ Branch objects, not names. D1 guessed `string[]` here and the generated
     * module caught it: each entry carries id, name, abbr, domain and
     * establishedYear, with dissolvedYear on the branches that were disbanded.
     */
    readonly branches: Branch[];
    readonly scale: number;
    readonly ordersOfBattle?: OrderOfBattleEntry[];
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
  /**
   * Default parties that seed as Major; every other default party seeds Minor.
   *
   * ⚠️ A STARTING VALUE, NOT A STANDING FACT. `partyTierTurn` recomputes tier
   * from live Org every turn, so this only sets the badge and cap at game start.
   * `presets` narrows Major status to specific eras, and is needed only where a
   * party exists in several presets but is Major in one.
   */
  readonly majorDefaultParties?: MajorDefaultParty[];
  readonly billPhases?: unknown;
  /**
   * `{ name, fn }` per phase. The fn values are FUNCTIONS, so toEqual compares
   * them by reference and the ordinary harness is blind -- see
   * MOVED_THUNK_REGISTRIES. Typed as the registry's own entry type rather than a
   * structural guess, because `fn: unknown` compiles in the folder and fails at
   * the forwarder.
   */
  readonly electionPhases?: CountryElectionPhaseEntry[];
  /**
   * ⚠️ OPTIONAL, BECAUSE SOME COUNTRIES APPORTION FROM THE LIVE REGIONS. East
   * Germany's spawner reads `seatsFromRegionField(regions, "houseDistricts")`;
   * there is no static table anywhere to carry, and Russia's Soviet of the Union
   * works the same way -- `ruSeats.ts` says outright that a parallel map would
   * drift. A folder that invented `byChamber: {}` to satisfy the type would
   * report a chamber with no seats, which reads as data rather than as absence.
   */
  readonly seats?: {
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
 * SOE base tables in budgets.ts: relational data, which belongs beside the
 * rows it must stay consistent with rather than in either country.
 *
 * ⚠️ REP_ECON and the sector-weight tables are BALANCE surfaces. A changed number
 * here needs a GitHub issue and a scripts/sim/ report per CLAUDE.md. This move
 * must change none of them.
 */
export interface CountryEconomy {
  /**
   * ⚠️ NARROW UNION, not string. COUNTRY_CURRENCY_MAP is keyed to CurrencyCode,
   * so a plain string compiles in the folder and fails at the forwarder -- the
   * same mismatch class that cost D3 six contract corrections.
   */
  readonly currencyCode: CurrencyCode;
  readonly nationalPolicyStateId: string;
  /** Scope key for country-scoped legislation. Also a narrow union. */
  readonly legislationScope: NonNullable<LegislationType["countryScope"]>;
  /**
   * ⚠️ OPTIONAL, AND THE CODEBASE SAYS SO OUT LOUD. `rateCalculation.ts` names
   * the countries -- "IT/ES/SE/TR/FR/RU" -- as forex-active with no full
   * economic baseline, and handles them. See `stats` above for the general case.
   */
  readonly economicBaseline?: { readonly gdpGrowth: number; readonly tradeGrowth: number };
  readonly monetary: {
    /** Required: MONETARY_BASELINES is a total Record, not a Partial. */
    readonly baseline: MonetaryBaseline;
    /**
     * ⚠️ Keyed by YEAR, not by shipping preset. There are four era tables
     * (1953/1971/1979/1991) and seven presets; ERA_TABLES maps a year onto one
     * of these and has no country axis of its own.
     */
    readonly byEra: Record<string, EraMonetaryBaseline>;
  };
  /**
   * ⚠️ Keyed to CorporationType, not string. A loose Record<string, number>
   * accepts a sector name that does not exist, on a BALANCE surface where a
   * typo would silently drop a sector's weight.
   */
  readonly sectorWeights: {
    /** Required: COUNTRY_SECTOR_WEIGHTS is a total Record, not a Partial. */
    readonly base: Partial<Record<CorporationType, number>>;
    /** Only 1979 and 1991 carry era-specific weights. */
    readonly byEra: Record<string, Partial<Record<CorporationType, number>>>;
  };
  readonly strategicSectors?: CorporationType[];
  /** GDP and population anchors for legislation cost scaling. BALANCE SURFACE. */
  readonly repEcon?: { readonly gdp: number; readonly population: number };
  /** Cost-scale interpolation anchors. BALANCE SURFACE. */
  readonly costScaleAnchors?: CostScaleAnchor;
  readonly tax: {
    readonly neutralFederalSalesTax?: number;
    readonly neutralStateSalesTax?: number;
    /** Required and mutable: the registry is a total Record of mutable objects. */
    readonly treasuryPsRate: { national: number; state: number };
  };
  readonly payoutCapPerTurn?: number;
  readonly sovereignCorpLegalStructure?: LegalStructureId;
  readonly m2ToGdp1953?: number;
  /**
   * Whether the 1953 GDP figure is stated in local currency or USD.
   *
   * ⚠️ 1953 ONLY, and the table lists only the countries the 1953 world starts
   * with. Later presets are uniformly local-currency by design, so a country
   * absent from it has nothing to denominate rather than a missing value.
   */
  readonly gdpDenomination1953?: GdpDenomination;
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
/**
 * D5 -- geography, regions, demographics.
 *
 * ⚠️ TARGETS (seeds/calibration/targets.ts) belongs HERE, not in CountryEconomy.
 * It was briefly typed on the economy member; the plan lists it under D5, and
 * the unused import it left behind is what surfaced the misplacement.
 */
export interface CountryGeography {
  readonly continent: Continent;
  /**
   * ⚠️ The ISO pair moves TOGETHER. COUNTRY_TO_ISO_NUMERIC and its exported
   * inverse ISO_NUMERIC_TO_COUNTRY are two halves of one fact; separate homes
   * let them drift. The inverse is keyed by code with JP as the VALUE, so it is
   * pinned by the harness rather than forwarded.
   */
  /**
   * ⚠️ OPTIONAL BECAUSE NOT EVERY ENTITY HAS A CODE. The Baltic States carry `""`
   * in `COUNTRY_TO_ISO_NUMERIC` -- not an ISO code, an absence spelled as an
   * empty string. Scotland and Wales are the other shape of this: they carry a
   * real code, 826, which is the United Kingdom's, so `ISO_NUMERIC_TO_COUNTRY`
   * maps it back to the UK and a lookup by code will never return them.
   */
  readonly isoNumeric?: string;
  readonly unMemberSince?: number;
  /**
   * ⚠️ NOT a count. COUNTRY_REGIONS is `Record<CountryId, WorldEntityRegion>` --
   * which bloc-level world region Japan sits in ("asia"). The plural name reads
   * like a tally; it is a single key, and a different taxonomy from `continent`
   * ("Asia").
   */
  readonly worldRegion: WorldEntityRegion;
  readonly nppCapitalState: string;
  readonly nonPartyIndependentBias?: number;
  readonly adjacency: AdjacencyMap;
  readonly regionNames: Record<string, string>;
  readonly demographicCategoryIds?: string[];
  readonly conscription?: ConscriptionPolicy;
  /**
   * ⚠️ Forwarded WITHOUT exporting its const. Seven seeders destructure
   * applyEra1991DemographicAdjustments out of a ternary that unions the whole
   * module type with a stub, so any new export on that module collapses the
   * seeded value to `unknown`. Forwarding the JP entry only adds an import.
   */
  readonly populationMultipliers?: Record<string, number>;
  /**
   * ⚠️ THREE DIFFERENT TYPES SHARE THE NAME `PresetBundles`, one per seed module:
   * regionCensusData's is keyed to RegionCensus, populationAnchors' to
   * AnchorBundle, metricPresets' to MetricPresetBundle. Only the first is
   * exported. Importing "the" PresetBundles would type two of these three wrong,
   * so each is spelled out here.
   */
  readonly censusBundles?: Partial<Record<ResetPresetId, Record<string, RegionCensus>>>;
  readonly populationAnchors: Partial<Record<ResetPresetId, AnchorBundle>>;
  readonly metricPresets: Partial<Record<ResetPresetId, MetricPresetBundle>>;
  readonly regionBundles: Partial<Record<ResetPresetId, State[]>>;
  readonly rawMetrics: StateMetrics[];
  readonly incomeAnchors?: NormalAnchor[];
  /** TARGETS from seeds/calibration/targets.ts. D5 owns this, not the economy. */
  readonly calibrationTargets?: Partial<Record<EraId, CalibrationTarget>>;
  /**
   * Base-era per-modifier threshold overrides and suppressions, the sibling of
   * `era1991Patches` below.
   *
   * ⚠️ THE TWO HALVES DRIFTED APART FOR NO REASON. The 1991 half has forwarded
   * to the folder since the first conversion; the base half kept its literals in
   * `countryPatches.ts` for every country but Japan, so the same country's
   * patches lived in two places depending on the era. Both forward now.
   */
  readonly modifierPatches?: Record<string, CountryModifierPatch>;
  readonly era1991Patches?: Record<string, CountryModifierPatch>;
  readonly hazardGroups?: Partial<Record<HazardTag, string[]>>;
  readonly mapRegistry: CountryMapConfig;
  /**
   * ⚠️ METRIC-FIRST slices. CORE5_NORMALS is keyed metric -> country, with a
   * `global` fallback per metric that belongs to every country and must NOT
   * move. Keyed here by metric name.
   */
  /**
   * ⚠️ OPTIONAL: `CORE5_NORMALS` is METRIC-first, and Russia appears under none
   * of the five metrics. See `stats` on CountryIdentity for why the first cohort
   * made this look required.
   */
  readonly core5Normals?: Record<string, NormalAnchor[]>;
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
