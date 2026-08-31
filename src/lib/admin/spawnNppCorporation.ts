import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector, NPP, PoliticalParty } from "@/lib/db/types";
import {
  buildCeoAffiliations,
  chooseNppCorpCeo,
  type NppCorpCeoAffiliation,
} from "./nppCorpCeoSelection";
import type { State } from "@/lib/db/types/state";
import type { CountryId } from "@/lib/constants/countries";
import {
  getGdpAnchorRate,
  loadWorldEraUnitScale,
  loadWorldPreset,
} from "@/lib/currency/gdpAnchorRate";
import { getEraFounderShares, getEraNominalScale } from "@/lib/constants/sectorSeedEra";
import {
  CORPORATION_TYPES,
  type CorporationType,
  DEFAULT_SHARE_PRICE,
  CEO_INITIAL_SHARES,
  DEFAULT_PROFIT_MARGIN,
  DEFAULT_SECTOR_STARTING_REVENUE,
  DEFAULT_SECTOR_STARTING_WORKERS,
} from "@/lib/constants/corporations";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import {
  getSectorHostFxRate,
  resolveSectorHostCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { writeCorpEconomicLocal } from "@/lib/currency/corpEconomyFields";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import { randomBrandColor } from "@/lib/corporations/brandColor";
import { computeUnownedSeedRevenue } from "@/lib/admin/seed/seedUnownedSectors";
import { createNPP } from "@/lib/npp/generator";
import {
  generateTickerSymbol,
  insertCorporationWithTickerRetry,
} from "@/lib/corporations/tickerSymbol";
import {
  computeUnownedHeadroomUnits,
  unownedHeadroomUnitsPerAnchor,
} from "@/lib/market/unownedHeadroom";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { capacityRescaleRatio } from "@/lib/constants/capacityEconomy";

/**
 * Default founding book for an admin/NPP-spawned corporation, in ₳ at MODERN
 * (2019-calibrated) nominal magnitudes. Converted to the country's currency and
 * deflated by the era's nominal scale at spawn time — see the call site.
 */
export const NPP_DEFAULT_STARTING_CAPITAL_ANCHOR = 2_000_000;

/**
 * Capital state for each enabled country.
 * Used as default HQ when batch-spawning NPP corporations.
 */
export const NPP_CAPITAL_STATES: Record<CountryId, string> = {
  US: "DC",
  UK: "LON",
  JP: "KAN",
  DE: "BE",
  CN: "HB", // Huabei (North China) — the region containing Beijing
  IE: "DUB",
  NG: "NORTH_CENTRAL", // federal capital (Abuja/FCT) sits in the North-Central zone
  BR: "CENTRO_OESTE",
  HU: "", // coming-soon: regions not yet seeded
  PL: "",
  RO: "",
  YU: "",
  BG: "",
  // Union republics: seeded regions exist, so these carry real capitals.
  UKR: "UKR_KYI",
  BLR: "BLR_MIN",
  CS: "",
  BAL: "BAL_LVA", // Riga: the largest Baltic city and the regional administrative centre
  RU: "",
  // Econ-tier market democracies — capital region (political capital where the
  // administrative and market capital differ, e.g. Ankara over Istanbul). These
  // regions are seeded by the econ-tier roster + region seeders, so an NPP corp
  // can HQ there. Left blank previously, which silently zeroed their NPP-corp
  // spawn even though the countries are full market economies.
  FR: "FR_IDF", // Île-de-France (Paris)
  IT: "IT_LAZ", // Lazio (Rome)
  ES: "ES_MAD", // Comunidad de Madrid
  SE: "SE_STH", // Stockholm
  TR: "TR_ANK", // Ankara (political capital)
  GR: "GR_ATT", // Attica (Athens)
  AT: "AT_VIE", // Vienna
  FI: "FI_UUS", // Uusimaa (Helsinki)
  DD: "", // planned economy — SOEs seeded by the budget seeders, no market corps
  SCO: "", // Latent — sub-regions seeded at secession (cannot spawn pre-activation)
  WAL: "", // Latent — sub-regions seeded at secession (cannot spawn pre-activation)
};

export interface SpawnNppCorporationInput {
  /** Human-readable name for the corporation */
  name: string;
  /** Sector type — determines which unowned market it captures from */
  type: CorporationType;
  /** Country where the corporation is headquartered */
  countryId: CountryId;
  /** State code where the corporation is headquartered and operates */
  headquartersState: string;
  /** Starting liquid capital in the country's local currency (default: 2_000_000) */
  startingCapital?: number;
  /** Starting revenue for the initial sector (default: derived from unowned market) */
  startingRevenue?: number;
  /** Profit margin for the initial sector (default: 35%) */
  profitMargin?: number;
  /** Brand color hex (default: random from palette) */
  brandColor?: string;
  /** Optional ticker symbol (auto-generated if not provided) */
  tickerSymbol?: string;
  /**
   * Explicit NPP party sequentialId for the CEO. When omitted (or blank), the CEO
   * is chosen by {@link chooseNppCorpCeo}: an existing NPP without a corp is
   * preferred, balancing corp ownership across active parties + independents, and
   * only falling back to a freshly created `"independent"` NPP when none is free.
   * When set, the CEO is taken from (or created in) that party.
   */
  nppPartyId?: string;
  /**
   * Turn the corp was founded. Defaults to 0 (bootstrap/admin-batch spawns,
   * which represent pre-existing corps). Autonomous NPP founding
   * (nppFoundCorporation) passes the current turn so mid-sim founding is
   * stamped for audit/timeline data rather than reading as turn 0.
   */
  foundedAtTurn?: number;
  /** Initial operating strategy for the founding sector. Defaults to standard. */
  initialStrategyId?: string;
}

/**
 * Gather the per-affiliation inputs {@link chooseNppCorpCeo} needs for one
 * country: how many NPP-corps each participating affiliation (active non-defunct
 * parties + `"independent"`) already controls, and which of its active NPPs are
 * not yet a CEO and so free to take one.
 */
export async function gatherNppCorpCeoAffiliations(
  db: Db,
  countryId: CountryId
): Promise<NppCorpCeoAffiliation[]> {
  const partyDocs = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId, isDefunct: { $ne: true } })
    .project<{ sequentialId: number }>({ sequentialId: 1 })
    .toArray();
  const nonDefunctPartyIds = partyDocs.map((p) => String(p.sequentialId));

  const corps = await db
    .collection<Corporation>("corporations")
    .find({ ceoType: "npp", countryId })
    .project<{ ceoId: ObjectId }>({ ceoId: 1 })
    .toArray();
  const ceoIds = corps.map((c) => c.ceoId).filter(Boolean);

  const ceoNppDocs = ceoIds.length
    ? await db
        .collection<NPP>("npps")
        .find({ _id: { $in: ceoIds } })
        .project<{ _id: ObjectId; party: string }>({ _id: 1, party: 1 })
        .toArray()
    : [];
  const existingCorpCeos = ceoNppDocs.map((n) => ({ nppId: n._id.toString(), party: n.party }));

  const activeNppDocs = await db
    .collection<NPP>("npps")
    .find({ countryId, retiredAt: null })
    .project<{ _id: ObjectId; party: string; politicalInfluence: number; sequentialId?: number }>({
      _id: 1,
      party: 1,
      politicalInfluence: 1,
      sequentialId: 1,
    })
    .toArray();
  const activeNpps = activeNppDocs.map((n) => ({
    id: n._id.toString(),
    party: n.party,
    influence: n.politicalInfluence ?? 0,
    seq: n.sequentialId ?? Number.MAX_SAFE_INTEGER,
  }));

  return buildCeoAffiliations({ nonDefunctPartyIds, existingCorpCeos, activeNpps });
}

export interface SpawnNppCorporationResult {
  corporationId: string;
  sequentialId: number;
  name: string;
  type: CorporationType;
  countryId: CountryId;
  headquartersState: string;
  /** In the corp's local currency (`liquidCurrencyCode`), as persisted. */
  startingCapital: number;
  /**
   * In ₳ (anchor). This is the market-capture quantity, not the stored field:
   * the sector row persists it converted to the sector's host currency.
   */
  startingRevenue: number;
  sectorId: string;
  nppId: string;
  nppName: string;
  tickerSymbol: string;
}

function pickBrandColor(inputColor?: string): string {
  return inputColor ?? randomBrandColor();
}

/**
 * Spawn an NPP-run corporation.
 *
 * - Generates a new NPP character to serve as CEO.
 * - Creates a corporation with the NPP as ceoId and ceoType="npp".
 * - Allocates shares: 51% to NPP CEO, 49% to public float (purchasable by players).
 * - Creates one initial sector in the HQ state matching the corp type.
 * - Captures revenue from the unowned market.
 * - Does NOT charge founding costs — admin-spawned, no player wallet involved.
 */
export async function spawnNppCorporation(
  db: Db,
  input: SpawnNppCorporationInput
): Promise<SpawnNppCorporationResult> {
  const now = new Date();
  const {
    name,
    type,
    countryId,
    headquartersState,
    startingCapital: customCapital,
    startingRevenue: customRevenue,
    profitMargin: customMargin,
    brandColor,
    tickerSymbol: customTicker,
    nppPartyId,
  } = input;

  // Validate state exists and belongs to the country
  const state = await db.collection<State>("states").findOne({ _id: headquartersState });
  if (!state) {
    throw new Error(`State "${headquartersState}" not found`);
  }
  if (state.countryId !== countryId) {
    throw new Error(
      `State "${headquartersState}" belongs to country "${state.countryId}", not "${countryId}"`
    );
  }

  // Get currency for the country
  const currencyCode = COUNTRY_CURRENCY_MAP[countryId];
  if (!currencyCode) {
    throw new Error(`No currency configured for country "${countryId}"`);
  }

  // Choose the CEO: prefer an existing NPP without a corp (balanced across
  // active parties + independents); only create a new NPP when none is free.
  const affiliations = await gatherNppCorpCeoAffiliations(db, countryId);
  const choice = chooseNppCorpCeo({ forcedParty: nppPartyId, affiliations });

  let npp: NPP | null = null;
  if (choice.kind === "existing") {
    npp = await db.collection<NPP>("npps").findOne({ _id: new ObjectId(choice.nppId) });
  }
  // Fall back to creating a fresh NPP when told to (choice.kind === "new") or if
  // the chosen existing NPP vanished between gather and fetch (defensive). Either
  // way `choice.party` holds the affiliation the balancer settled on.
  if (!npp) {
    npp = await createNPP({
      state: headquartersState,
      party: choice.party,
      countryId,
      targetOffice: null,
    });
  }

  // Determine starting capital. Two normalizations, both on the default only
  // (an explicit `customCapital` is taken literally):
  //
  //  1. FX: ~₳2M expressed in the country's own currency, so weak-currency
  //     countries (JP, NG, BR) are not seeded with tiny local books. A flat 2M
  //     LOCAL left e.g. JP corps at ~19k ₳ vs UK/US at ~2M — an ~800x
  //     cross-nation gap that also kept those corps below the nominal cash
  //     floors gating expansion. See balance audit (2026-07-21).
  //  2. ERA: ₳2,000,000 is a MODERN absolute (refs #3778 §3). 1953 nominal GDP
  //     is ~70x smaller, so the unscaled default handed a fresh NPP corp more
  //     cash than several 1953 regional sector markets put together. Deflating
  //     by the era's nominal scale keeps the founding book the same share of
  //     the economy it is in a 2019 world. No-op for every modern preset.
  const preset = await loadWorldPreset(db);
  const startingCapital =
    customCapital ??
    Math.round(
      (NPP_DEFAULT_STARTING_CAPITAL_ANCHOR * getEraNominalScale(preset)) /
        getGdpAnchorRate(countryId, preset)
    );

  // Determine starting revenue: use custom, or derive from unowned market.
  //
  // DENOMINATION: `startingRevenue` is ₳ (anchor) throughout this function. Every
  // source it can come from is ₳-native — `unownedSectors.revenue` is ₳ by
  // documented convention, `computeUnownedSeedRevenue` returns ₳,
  // `DEFAULT_SECTOR_STARTING_REVENUE` is a ₳ constant, and the admin route's
  // `startingRevenue` override is specified in ₳. It stays ₳ because the two
  // other things it feeds — `computeUnownedHeadroomUnits` and the unowned-pool
  // drawdown — both require ₳. It is converted to the sector's HOST-state
  // currency exactly once, at the `corporateSectors` insert below.
  let startingRevenue: number;
  if (customRevenue !== undefined) {
    startingRevenue = customRevenue;
  } else {
    const unowned = await db
      .collection("unownedSectors")
      .findOne({ stateId: headquartersState, sectorType: type });
    if (unowned?.revenue) {
      startingRevenue = Math.round(unowned.revenue * 0.25);
    } else {
      startingRevenue = computeUnownedSeedRevenue({
        gdp: state.gdp,
        countryId,
        stateId: headquartersState,
        sectorType: type,
        preset,
      });
    }
  }

  startingRevenue = Math.max(startingRevenue, DEFAULT_SECTOR_STARTING_REVENUE);
  const profitMargin = customMargin ?? DEFAULT_PROFIT_MARGIN;

  // Get next sequential ID for corporation
  const sequentialId = await getNextSequentialId(db, "corporation");

  // Generate ticker if not provided
  const tickerSymbol = customTicker ?? (await generateTickerSymbol(db, name));

  // Share allocation: NPP CEO gets 51%, public float gets 49%. The share base
  // deflates with the era for the same reason `startingCapital` above does —
  // on a fixed 10M base a 1953 corp prices below MIN_SHARE_PRICE and floors.
  const totalIssuedShares = getEraFounderShares(CEO_INITIAL_SHARES, preset);
  const nppShares = Math.floor(totalIssuedShares * 0.51);
  const publicFloatShares = totalIssuedShares - nppShares;

  // Calculate initial share price based on starting capital
  const initialSharePrice = Math.max(
    DEFAULT_SHARE_PRICE,
    Math.round((startingCapital / totalIssuedShares) * 100) / 100
  );

  // Create the corporation document
  const corpId = new ObjectId();
  const corpDoc: Omit<Corporation, "_id"> & { _id: ObjectId } = {
    _id: corpId,
    name,
    tickerSymbol,
    type,
    ceoId: npp._id,
    ceoType: "npp",
    ceoVacant: false,
    userId: new ObjectId("000000000000000000000000"), // system placeholder
    countryId,
    headquartersState,
    liquidCapital: startingCapital,
    liquidCurrencyCode: currencyCode,
    marketingBudget: Math.round(startingCapital * 0.02), // 2% marketing
    marketingStrength: 10,
    logisticsBudget: Math.round(startingCapital * 0.01), // 1% logistics
    logisticsStrength: 0,
    rdBudget: Math.round(startingCapital * 0.01), // 1% R&D
    rdScore: 0,
    ceoSalary: 0,
    brandColor: pickBrandColor(brandColor),
    sequentialId,
    totalShares: totalIssuedShares,
    sharePrice: initialSharePrice,
    shareholders: [{ nppId: npp._id, shares: nppShares }],
    publicFloat: publicFloatShares,
    dividendRate: 5, // 5% dividend — attractive to investors
    suspended: false,
    hiddenFromExchange: false,
    isPrivate: false,
    foundedAtTurn: input.foundedAtTurn ?? 0,
    createdAt: now,
    updatedAt: now,
  };

  await insertCorporationWithTickerRetry(db, corpDoc as Corporation);

  // ─── Plants: the founding sector is GRANTED capacity, not a revenue line ──
  //
  // This is the SEED/ADMIN path, not a player action, and it is deliberately
  // NOT the founding-build flow `expandSector` and the NPP turn behaviour use.
  // A world is seeded at t0: there is no turn on which a build queue could
  // drain, and a spawned corp whose plants are all still under construction
  // would start a world producing nothing. So the capacity is granted directly
  // into `capitalStock` — instant, in UNITS — and drawn out of the unowned pool
  // it captures, exactly as the founding build draws its own starter capacity.
  // The grant is sized from the same `startingRevenue` the legacy path used, so
  // a seeded world's opening capacity is unchanged; only its BASIS changes from
  // ₳/day to units/day.
  const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");
  const eraUnitScale = await loadWorldEraUnitScale(db);
  const startingCapacityUnitsStandard = plantsEnabled
    ? computeUnownedHeadroomUnits(type, startingRevenue, eraUnitScale)
    : 0;
  const startingCapacityUnits = plantsEnabled
    ? startingCapacityUnitsStandard *
      capacityRescaleRatio(type, "standard", input.initialStrategyId)
    : 0;

  // ─── Currency: `corporateSectors.revenue` is stored in the sector's HOST-state
  // currency, NOT in ₳ (see src/lib/currency/corpEconomyFields.ts; readers call
  // `readCorpEconomicAnchor`, writers `writeCorpEconomicLocal`). This path wrote
  // the ₳ figure straight in, so every sector in a non-anchor-currency country
  // (JP fx ≈ 360, BR, NG, DE, CN, IE…) was read back at 1/fx of its true weight
  // by every ₳-denominated aggregate — tax rollups, GDP weighting, market-share
  // denominators, corp valuation. Capital mode hid it because the turn's
  // read→grow→write round-trips and cancels; plants exposes it because the
  // nameplate is rebuilt from currency-free capacity.
  //
  // The seeded sector is always domestic (HQ state ⇒ host country == corp
  // country), so host == `currencyCode`, but resolve it through the shared
  // helpers anyway so this stays correct if a spawn is ever cross-border.
  const sectorHostFxRate = await getSectorHostFxRate(db, { countryId }, corpDoc);
  const startingRevenueLocal = Math.round(
    writeCorpEconomicLocal(
      startingRevenue,
      resolveSectorHostCurrencyCode({ countryId }, corpDoc),
      sectorHostFxRate
    )
  );

  // Create the initial sector
  const sectorId = new ObjectId();
  const sectorDoc: Omit<CorporateSector, "_id"> & { _id: ObjectId } = {
    _id: sectorId,
    corporationId: corpId,
    countryId,
    stateId: headquartersState,
    sectorType: type,
    targetGrowthRate: 3, // Moderate growth
    currentGrowthRate: 0,
    currentGrowthCost: 0,
    // HOST-currency, converted from the ₳ `startingRevenue` above.
    revenue: startingRevenueLocal,
    profitMargin,
    workers: DEFAULT_SECTOR_STARTING_WORKERS,
    ...(input.initialStrategyId ? { strategyId: input.initialStrategyId } : {}),
    createdAt: now,
    updatedAt: now,
    ...(plantsEnabled
      ? {
          capitalStock: startingCapacityUnits,
          // Born under plants — never needs the flip-turn migration.
          plantsStartTurn: input.foundedAtTurn ?? 0,
        }
      : {}),
  };

  await db.collection<CorporateSector>("corporateSectors").insertOne(sectorDoc as CorporateSector);

  // Reduce the unowned sector pool to reflect market capture.
  const unownedSector = await db
    .collection("unownedSectors")
    .findOne({ stateId: headquartersState, sectorType: type });
  if (unownedSector) {
    const captureAmount = startingRevenue;
    const newRevenue = Math.max(0, unownedSector.revenue - captureAmount);
    // `headroomUnits` was NOT being decremented here: the spawn captured ₳
    // revenue out of the pool while leaving its unit view at the pre-capture
    // figure. Under plants that view is what market share and the founding
    // build are sized against, so every spawned corp permanently inflated the
    // headroom of the market it had just taken a bite out of. Decrement in
    // lockstep. Non-plants worlds get the same fix: `headroomUnits` is a derived
    // view of `revenue` and must never disagree with it.
    // The pool is denominated on the sector type's standard strategy. A focused
    // founding holds a D9-rescaled stock but consumes the same standard-basis
    // market entry that its unchanged starting revenue represents.
    const unitsCaptured = plantsEnabled
      ? startingCapacityUnitsStandard
      : computeUnownedHeadroomUnits(type, captureAmount, eraUnitScale);
    const priorUnits =
      typeof unownedSector.headroomUnits === "number" &&
      Number.isFinite(unownedSector.headroomUnits)
        ? unownedSector.headroomUnits
        : unownedHeadroomUnitsPerAnchor(type, eraUnitScale) * (unownedSector.revenue ?? 0);
    await db.collection("unownedSectors").updateOne(
      { _id: unownedSector._id },
      {
        $set: {
          revenue: newRevenue,
          headroomUnits: Math.max(0, priorUnits - unitsCaptured),
          updatedAt: now,
        },
      }
    );
  }

  return {
    corporationId: corpId.toString(),
    sequentialId,
    name,
    type,
    countryId,
    headquartersState,
    startingCapital,
    startingRevenue,
    sectorId: sectorId.toString(),
    nppId: npp._id.toString(),
    nppName: npp.name,
    tickerSymbol,
  };
}

/**
 * Batch spawn NPP corporations for a country — one per sector type.
 * Uses the country's capital state as HQ for all corps.
 */
export async function batchSpawnNppCorporations(
  db: Db,
  countryId: CountryId,
  options?: {
    /** Specific sector types to spawn (default: all 17) */
    sectorTypes?: CorporationType[];
    /** Starting capital per corp (default: 2M local currency) */
    startingCapital?: number;
    /** HQ state (default: country capital from NPP_CAPITAL_STATES) */
    headquartersState?: string;
    /**
     * How many competing corps to spawn per sector type (default: 1). Each
     * sector's revenue is a shared, bounded market (see
     * buildMarketShareBySectorId in marketShare.ts — owned revenue across
     * ALL corps in a (state, sectorType) bucket is ratioed against a
     * GDP-derived market anchor, not summed unboundedly), so multiple corps
     * per sector model real intra-sector competition rather than inflating
     * aggregate economic output.
     */
    perSectorCount?: number;
  }
): Promise<SpawnNppCorporationResult[]> {
  const defaultHq = NPP_CAPITAL_STATES[countryId];
  if (!defaultHq) {
    throw new Error(`No capital state configured for country "${countryId}"`);
  }
  const hqState = options?.headquartersState ?? defaultHq;

  const sectorTypes = options?.sectorTypes ?? [...CORPORATION_TYPES];
  const perSectorCount = Math.max(1, Math.floor(options?.perSectorCount ?? 1));
  const results: SpawnNppCorporationResult[] = [];

  for (const type of sectorTypes) {
    for (let i = 0; i < perSectorCount; i++) {
      // Generate a thematic name based on sector and country — passing the
      // growing results list (including same-sector prior spawns this loop)
      // keeps names distinct across all perSectorCount competitors.
      const name = generateNppCorpName(
        countryId,
        type,
        results.map((r) => r.name)
      );

      try {
        const result = await spawnNppCorporation(db, {
          name,
          type,
          countryId,
          headquartersState: hqState,
          startingCapital: options?.startingCapital,
        });
        results.push(result);
      } catch (err) {
        console.error(`[spawnNpp] Failed to spawn ${type} corp for ${countryId}:`, err);
        // Continue with other sectors/slots
      }
    }
  }

  return results;
}

// ─── Name generation ─────────────────────────────────────────────────────────

const SECTOR_NAME_PREFIXES: Record<CorporationType, string[]> = {
  financial: ["First", "National", "Union", "Metro", "Central"],
  media: ["Daily", "Metro", "National", "Global", "Prime"],
  manufacturing: ["Atlas", "Prime", "National", "United", "Standard"],
  chemical_industries: ["Nova", "Chem", "Atlas", "Prime", "National"],
  healthcare: ["Med", "Health", "Care", "Life", "Prime"],
  retail: ["Super", "Mega", "Prime", "Value", "National"],
  automobiles: ["Auto", "Motor", "Drive", "Speed", "Prime"],
  technology: ["Tech", "Cyber", "Data", "Nova", "Prime"],
  energy: ["Power", "Energy", "Volt", "Fuel", "Nova"],
  agriculture: ["Agri", "Farm", "Crop", "Green", "Prime"],
  real_estate: ["Metro", "Prime", "City", "Home", "National"],
  construction: ["Build", "Construct", "Atlas", "Prime", "United"],
  defense: ["Defense", "Shield", "Atlas", "Prime", "National"],
  telecommunications: ["Tele", "Comms", "Net", "Prime", "National"],
  entertainment: ["Star", "Prime", "Show", "Media", "Global"],
  logistics: ["Logi", "Freight", "Transport", "Prime", "National"],
  extraction: ["Mine", "Extract", "Resource", "Atlas", "Prime"],
};

const SECTOR_NAME_SUFFIXES: Record<CorporationType, string[]> = {
  financial: ["Bank", "Financial", "Capital", "Trust", "Holdings"],
  media: ["Media", "News", "Broadcasting", "Press", "Communications"],
  manufacturing: ["Industries", "Manufacturing", "Works", "Products", "Group"],
  chemical_industries: ["Chemicals", "Industries", "Materials", "Science", "Group"],
  healthcare: ["Healthcare", "Medical", "Health", "Clinics", "Systems"],
  retail: ["Mart", "Retail", "Stores", "Market", "Outlets"],
  automobiles: ["Motors", "Automotive", "Vehicles", "Cars", "Mobility"],
  technology: ["Systems", "Technologies", "Solutions", "Digital", "Innovations"],
  energy: ["Power", "Energy", "Utilities", "Electric", "Resources"],
  agriculture: ["Farms", "Agriculture", "Produce", "Foods", "Group"],
  real_estate: ["Properties", "Realty", "Estates", "Homes", "Developments"],
  construction: ["Construction", "Builders", "Contracting", "Development", "Engineering"],
  defense: ["Systems", "Industries", "Defense", "Technologies", "Contractors"],
  telecommunications: ["Communications", "Telecom", "Networks", "Wireless", "Systems"],
  entertainment: ["Entertainment", "Studios", "Productions", "Media", "Group"],
  logistics: ["Logistics", "Shipping", "Transport", "Freight", "Supply"],
  extraction: ["Mining", "Resources", "Materials", "Extraction", "Industries"],
};

export function generateNppCorpName(
  countryId: CountryId,
  type: CorporationType,
  existingNames: string[]
): string {
  const prefixes = SECTOR_NAME_PREFIXES[type];
  const suffixes = SECTOR_NAME_SUFFIXES[type];

  // Try up to 20 times to find a unique name
  for (let attempt = 0; attempt < 20; attempt++) {
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
    const name = `${prefix} ${suffix}`;

    if (!existingNames.some((n) => n.toLowerCase() === name.toLowerCase())) {
      return name;
    }
  }

  // Fallback with country prefix
  return `${countryId} ${SECTOR_NAME_SUFFIXES[type][0]} ${Math.floor(Math.random() * 1000)}`;
}
