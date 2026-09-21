import { ObjectId, type Db } from "mongodb";
import {
  DIVERSIFIED_MEDIA_STRATEGY,
  MEDIA_ENTERTAINMENT_SECTOR_TYPE,
  canonicalMediaStrategyForLegacy,
  canonicalizeMediaStrategyIdInput,
  consolidateMediaTechUnlocks,
  isLegacyMediaSectorType,
  planCorporationTypeMigration,
  unionInferredOperatingModels,
} from "@/lib/corporations/mediaConsolidation/rules";
import { mapLegacyMediaTechId } from "@/lib/constants/techTree/mediaMerge";
import {
  capacityRescaleRatio,
  rescaleBuildQueueForStrategyChange,
} from "@/lib/constants/capacityEconomy";
import {
  mergeSectorPlantFields,
  readSectorPlantFields,
} from "@/lib/corporations/sectorTransferCapex";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { getCurrentTurn } from "@/lib/currentTurn";
import {
  INDEX_FUND_INITIAL_NAV,
  INDEX_FUND_SEED_CASH_ANCHOR,
  INDEX_FUND_SEED_RESERVE_UNITS,
} from "@/lib/indexFunds/unitAccounting";
import type {
  IndexFund,
  IndexFundHolding,
  IndexFundPosition,
  IndexFundTargetConstituent,
} from "@/lib/db/types";
import type { Migration, MigrationContext, MigrationResult } from "../types";

const CANON = MEDIA_ENTERTAINMENT_SECTOR_TYPE;
const DIVERSIFIED = DIVERSIFIED_MEDIA_STRATEGY;
const LEGACY_SECTOR_SLUGS = ["global_sector_media", "global_sector_entertainment"];
const SURVIVOR_FUND_SLUG = "global_sector_media_entertainment";
const SURVIVOR_FUND_NAME = "Global Media & Entertainment Index";
const SURVIVOR_FUND_TICKER = "GLBMEA";
const LEGACY_STRATEGY_IDS = [
  "streaming_media",
  "digital_first",
  "legacy_broadcast",
  "live_service",
];

const finite = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const positive = (value: unknown): number => (finite(value) > 0 ? finite(value) : 0);

function createdAtMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Deterministic oldest-first order: earliest creation wins, _id breaks ties. */
function oldestFirst<T>(
  rows: readonly T[],
  idOf: (row: T) => string,
  timeOf: (row: T) => number
): T[] {
  return [...rows].sort((a, b) => timeOf(a) - timeOf(b) || (idOf(a) < idOf(b) ? -1 : 1));
}

interface CorporationDoc {
  _id: ObjectId;
  type?: unknown;
  secondaryType?: unknown;
  unlockedTechNodeIds?: unknown;
}

interface SectorDoc {
  _id: ObjectId;
  corporationId?: unknown;
  countryId?: unknown;
  stateId?: unknown;
  sectorType?: unknown;
  strategyId?: unknown;
  transitionFromStrategyId?: unknown;
  revenue?: unknown;
  workers?: unknown;
  workersDesired?: unknown;
  profitMargin?: unknown;
  productionPolicyLevel?: unknown;
  negativeProductionSustainedTurns?: unknown;
  laborCost?: unknown;
  wagePerWorker?: unknown;
  inventoryUnits?: unknown;
  inventoryValueAnchor?: unknown;
  inventoryDrainedUnits?: unknown;
  inventorySpoiledUnits?: unknown;
  realizedRevenue?: unknown;
  producedUnits?: unknown;
  soldUnits?: unknown;
  contractAchievableUnits?: unknown;
  representingUnionId?: unknown;
  createdAt?: unknown;
  [key: string]: unknown;
}

interface UnownedDoc {
  _id: ObjectId;
  stateId?: unknown;
  countryId?: unknown;
  sectorType?: unknown;
  revenue?: unknown;
  headroomUnits?: unknown;
  recentCorporateSectorRestores?: unknown;
  createdAt?: unknown;
}

interface UnionDoc {
  _id: ObjectId;
  countryId?: unknown;
  sectorType?: unknown;
  foundedByCharacterId?: unknown;
  treasury?: unknown;
  strength?: unknown;
  createdAt?: unknown;
}

function sectorGroupKey(row: SectorDoc): string {
  return `${String(row.corporationId)}::${String(row.stateId)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sumInventoryUnits(rows: readonly SectorDoc[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    for (const [commodity, units] of Object.entries(asRecord(row.inventoryUnits))) {
      if (typeof units !== "number" || !Number.isFinite(units) || units === 0) continue;
      out[commodity] = (out[commodity] ?? 0) + units;
    }
  }
  return out;
}

function revenueWeighted(
  rows: readonly SectorDoc[],
  totalRevenue: number,
  survivorFallback: number,
  pick: (row: SectorDoc) => number
): number {
  if (!(totalRevenue > 0)) return survivorFallback;
  return rows.reduce((sum, row) => sum + pick(row) * finite(row.revenue), 0) / totalRevenue;
}

export interface MediaEntertainmentConsolidationCounts {
  corporations: number;
  operatingModels: number;
  sectorsRekeyed: number;
  sectorMerges: number;
  sectorsDeleted: number;
  unownedRekeyed: number;
  unownedMerges: number;
  unownedDeleted: number;
  unionsRekeyed: number;
  unionMerges: number;
  unionsDeleted: number;
  campaignsRekeyed: number;
  agreementsRekeyed: number;
  designationsRekeyed: number;
  designationsDeleted: number;
  fundsFolded: number;
  fundsDeleted: number;
  positionsMoved: number;
  historiesRekeyed: number;
}

function holderKey(position: IndexFundPosition): string {
  return [
    position.holderKind,
    position.characterId ? String(position.characterId) : "",
    position.imperialCharacterId ? String(position.imperialCharacterId) : "",
    position.nppId ? String(position.nppId) : "",
    position.pensionSchemeId ? String(position.pensionSchemeId) : "",
  ].join(":");
}

function mergeAvgNav(
  unitsA: number,
  avgA: number,
  unitsB: number,
  avgB: number,
  fallback: number
): number {
  const total = unitsA + unitsB;
  if (!(total > 0)) return fallback;
  return (unitsA * avgA + unitsB * avgB) / total;
}

/**
 * Fold the retired media/entertainment sector funds into the surviving
 * GLBMEA fund. Holdings for the same corporation sum (one entry, never two),
 * same-holder positions merge with units summed and cost basis
 * NAV-weighted (the creditFundUnits convention), cash/reserve/supply follow
 * the position ledger (the orphan-repair convention: unitSupply is reconciled
 * to ledger units, never carried as a stale sum), and the retired definition
 * docs are deleted so no legacy sector label remains.
 */
async function foldLegacyIndexFunds(
  db: Db,
  opts: { dry: boolean; now: Date }
): Promise<{
  fundsFolded: number;
  fundsDeleted: number;
  positionsMoved: number;
  definitionsRekeyed: number;
}> {
  const out = { fundsFolded: 0, fundsDeleted: 0, positionsMoved: 0, definitionsRekeyed: 0 };
  let survivor = await db.collection<IndexFund>("indexFunds").findOne({ slug: SURVIVOR_FUND_SLUG });
  if (!survivor && !opts.dry) {
    const doc: Omit<IndexFund, "_id"> & { _id?: ObjectId } = {
      _id: new ObjectId(),
      slug: SURVIVOR_FUND_SLUG,
      name: SURVIVOR_FUND_NAME,
      tickerSymbol: SURVIVOR_FUND_TICKER,
      scope: "global",
      kind: "sector",
      sectorType: CANON,
      anchorCurrencyCode: "USD",
      status: "active",
      quotedNav: INDEX_FUND_INITIAL_NAV,
      unitSupply: INDEX_FUND_SEED_RESERVE_UNITS,
      reserveUnits: INDEX_FUND_SEED_RESERVE_UNITS,
      cashAnchor: INDEX_FUND_SEED_CASH_ANCHOR,
      targetConstituents: [],
      holdings: [],
      createdAt: opts.now,
      updatedAt: opts.now,
    };
    await db.collection<IndexFund>("indexFunds").insertOne(doc as IndexFund);
    await db.collection<IndexFundPosition>("indexFundPositions").updateOne(
      { fundId: doc._id, holderKind: "fund_reserve" },
      {
        $setOnInsert: { fundId: doc._id, holderKind: "fund_reserve", createdAt: opts.now },
        $set: {
          units: INDEX_FUND_SEED_RESERVE_UNITS,
          avgNavAnchor: INDEX_FUND_INITIAL_NAV,
          updatedAt: opts.now,
        },
      },
      { upsert: true }
    );
    survivor = await db.collection<IndexFund>("indexFunds").findOne({ slug: SURVIVOR_FUND_SLUG });
  }
  if (!survivor) return out;
  const canonUpdate: Record<string, unknown> = {};
  if (survivor.sectorType !== CANON) canonUpdate.sectorType = CANON;
  if (survivor.name !== SURVIVOR_FUND_NAME) canonUpdate.name = SURVIVOR_FUND_NAME;
  if (survivor.tickerSymbol !== SURVIVOR_FUND_TICKER)
    canonUpdate.tickerSymbol = SURVIVOR_FUND_TICKER;
  if (Object.keys(canonUpdate).length > 0) {
    canonUpdate.updatedAt = opts.now;
    if (!opts.dry) {
      await db.collection("indexFunds").updateOne({ _id: survivor._id }, { $set: canonUpdate });
    }
    out.definitionsRekeyed += 1;
  }

  const legacy = await db
    .collection<IndexFund>("indexFunds")
    .find({
      $or: [
        { sectorType: { $in: ["media", "entertainment"] } },
        { slug: { $in: LEGACY_SECTOR_SLUGS } },
        { tickerSymbol: "GLBENT" },
      ],
    })
    .toArray();
  const ordered = oldestFirst(
    legacy.filter((fund) => !fund._id.equals(survivor!._id)),
    (fund) => String(fund._id),
    (fund) => createdAtMs(fund.createdAt)
  );
  for (const fund of ordered) {
    const positions = await db
      .collection<IndexFundPosition>("indexFundPositions")
      .find({ fundId: fund._id })
      .toArray();
    if (!opts.dry) {
      const live =
        (await db.collection<IndexFund>("indexFunds").findOne({ _id: survivor._id })) ?? survivor;
      const livePositions = await db
        .collection<IndexFundPosition>("indexFundPositions")
        .find({ fundId: survivor._id })
        .toArray();
      const holdingsByCorp = new Map<string, IndexFundHolding>();
      for (const holding of live.holdings ?? [])
        holdingsByCorp.set(String(holding.corporationId), { ...holding });
      for (const holding of fund.holdings ?? []) {
        const key = String(holding.corporationId);
        const existing = holdingsByCorp.get(key);
        if (!existing) {
          holdingsByCorp.set(key, { ...holding });
          continue;
        }
        const shares = positive(existing.shares) + positive(holding.shares);
        const costA =
          typeof existing.avgCostPerShareAnchor === "number"
            ? existing.avgCostPerShareAnchor
            : null;
        const costB =
          typeof holding.avgCostPerShareAnchor === "number" ? holding.avgCostPerShareAnchor : null;
        holdingsByCorp.set(key, {
          ...existing,
          shares,
          ...(costA !== null || costB !== null
            ? {
                avgCostPerShareAnchor: mergeAvgNav(
                  positive(existing.shares),
                  costA ?? costB ?? 0,
                  positive(holding.shares),
                  costB ?? costA ?? 0,
                  live.quotedNav
                ),
              }
            : {}),
          lastValueAnchor:
            existing.lastValueAnchor !== undefined || holding.lastValueAnchor !== undefined
              ? positive(existing.lastValueAnchor) + positive(holding.lastValueAnchor)
              : undefined,
        });
      }
      const targetsByCorp = new Map<string, IndexFundTargetConstituent>();
      for (const target of live.targetConstituents ?? []) {
        targetsByCorp.set(String(target.corporationId), { ...target });
      }
      for (const target of fund.targetConstituents ?? []) {
        const key = String(target.corporationId);
        const existing = targetsByCorp.get(key);
        targetsByCorp.set(
          key,
          existing
            ? {
                ...existing,
                targetWeight: finite(existing.targetWeight) + finite(target.targetWeight),
                marketCapAnchor: finite(existing.marketCapAnchor) + finite(target.marketCapAnchor),
              }
            : { ...target }
        );
      }
      const streaksByCorp = new Map<
        string,
        NonNullable<IndexFund["listingFailureStreaks"]>[number]
      >();
      for (const streak of live.listingFailureStreaks ?? []) {
        streaksByCorp.set(String(streak.corporationId), {
          ...streak,
          failures: [...streak.failures],
        });
      }
      for (const streak of fund.listingFailureStreaks ?? []) {
        const key = String(streak.corporationId);
        const existing = streaksByCorp.get(key);
        streaksByCorp.set(
          key,
          existing
            ? {
                ...existing,
                consecutiveFailures: Math.max(
                  existing.consecutiveFailures,
                  streak.consecutiveFailures
                ),
                failures: [...new Set([...existing.failures, ...streak.failures])],
              }
            : { ...streak, failures: [...streak.failures] }
        );
      }
      const bondsByCountry = new Map<string, NonNullable<IndexFund["bondAllocations"]>[number]>();
      for (const bond of live.bondAllocations ?? [])
        bondsByCountry.set(String(bond.countryId), { ...bond });
      for (const bond of fund.bondAllocations ?? []) {
        const key = String(bond.countryId);
        const existing = bondsByCountry.get(key);
        bondsByCountry.set(
          key,
          existing
            ? {
                ...existing,
                principalAnchor: finite(existing.principalAnchor) + finite(bond.principalAnchor),
              }
            : { ...bond }
        );
      }
      const positionsByHolder = new Map<string, IndexFundPosition>();
      for (const position of livePositions) positionsByHolder.set(holderKey(position), position);
      const deletePositionIds: ObjectId[] = [];
      for (const position of positions) {
        const key = holderKey(position);
        const existing = positionsByHolder.get(key);
        out.positionsMoved += 1;
        if (!existing) {
          await db
            .collection("indexFundPositions")
            .updateOne(
              { _id: position._id },
              { $set: { fundId: survivor._id, updatedAt: opts.now } }
            );
          positionsByHolder.set(key, { ...position, fundId: survivor._id });
          continue;
        }
        const units = Math.floor(positive(existing.units)) + Math.floor(positive(position.units));
        const avg = mergeAvgNav(
          Math.floor(positive(existing.units)),
          typeof existing.avgNavAnchor === "number" ? existing.avgNavAnchor : live.quotedNav,
          Math.floor(positive(position.units)),
          typeof position.avgNavAnchor === "number" ? position.avgNavAnchor : fund.quotedNav,
          live.quotedNav
        );
        const createdAt =
          createdAtMs(existing.createdAt) <= createdAtMs(position.createdAt)
            ? existing.createdAt
            : position.createdAt;
        await db.collection("indexFundPositions").updateOne(
          { _id: existing._id },
          {
            $set: {
              units,
              avgNavAnchor: avg,
              legacyUnits:
                Math.floor(positive(existing.legacyUnits)) +
                Math.floor(positive(position.legacyUnits)),
              createdAt,
              updatedAt: opts.now,
            },
          }
        );
        positionsByHolder.set(key, { ...existing, units, avgNavAnchor: avg });
        deletePositionIds.push(position._id);
      }
      if (deletePositionIds.length > 0) {
        await db.collection("indexFundPositions").deleteMany({ _id: { $in: deletePositionIds } });
      }
      const finalPositions = await db
        .collection<IndexFundPosition>("indexFundPositions")
        .find({ fundId: survivor._id })
        .toArray();
      const supply = finalPositions.reduce((sum, row) => sum + Math.floor(positive(row.units)), 0);
      await db.collection("indexFunds").updateOne(
        { _id: survivor._id },
        {
          $set: {
            holdings: [...holdingsByCorp.values()],
            targetConstituents: [...targetsByCorp.values()],
            ...(streaksByCorp.size > 0
              ? { listingFailureStreaks: [...streaksByCorp.values()] }
              : {}),
            ...(bondsByCountry.size > 0 ? { bondAllocations: [...bondsByCountry.values()] } : {}),
            cashAnchor: finite(live.cashAnchor) + finite(fund.cashAnchor),
            reserveUnits:
              Math.floor(positive(live.reserveUnits)) + Math.floor(positive(fund.reserveUnits)),
            unitSupply: supply,
            updatedAt: opts.now,
          },
        }
      );
      await db.collection("indexFunds").deleteOne({ _id: fund._id });
      survivor =
        (await db.collection<IndexFund>("indexFunds").findOne({ _id: survivor._id })) ?? survivor;
    } else {
      out.positionsMoved += positions.length;
    }
    out.fundsFolded += 1;
    out.fundsDeleted += 1;
  }
  return out;
}

/** Rewrite one bill-provisions array; returns the rewritten array or null when clean. */
function rekeyBillProvisions(provisions: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(provisions)) return null;
  let changed = false;
  const next = provisions.map((provision) => {
    if (provision === null || typeof provision !== "object" || Array.isArray(provision))
      return provision;
    const row = provision as Record<string, unknown>;
    const out = { ...row };
    if (typeof row.targetSectorType === "string" && isLegacyMediaSectorType(row.targetSectorType)) {
      out.targetSectorType = CANON;
      changed = true;
    }
    if (typeof row.sectorType === "string" && isLegacyMediaSectorType(row.sectorType)) {
      out.sectorType = CANON;
      changed = true;
    }
    if (typeof row.targetStrategyId === "string") {
      const mapped = canonicalizeMediaStrategyIdInput(row.targetStrategyId);
      if (mapped !== row.targetStrategyId) {
        out.targetStrategyId = mapped;
        changed = true;
      }
    }
    return out;
  });
  return changed ? (next as Record<string, unknown>[]) : null;
}

/**
 * Type-keyed histories and config with directly persisted legacy labels:
 * market-cap history sector keys, nationalization ledger sector lists, state
 * specializations and top-sector caches, sentiment and demand-modifier
 * discriminators, and live bill provisions. All rewrites are in place and
 * rerun-safe.
 */
async function rekeyTypeKeyedHistories(db: Db, opts: { dry: boolean; now: Date }): Promise<number> {
  let touched = 0;
  const legacyFilter = { $in: ["media", "entertainment"] };

  const capRows = await db
    .collection<{ _id: ObjectId; bySector?: Record<string, number> }>("marketCapHistory")
    .find({
      $or: [
        { "bySector.media": { $exists: true } },
        { "bySector.entertainment": { $exists: true } },
      ],
    })
    .toArray();
  for (const row of capRows) {
    const bySector = { ...(row.bySector ?? {}) };
    const merged =
      positive(bySector[CANON]) + positive(bySector.media) + positive(bySector.entertainment);
    delete bySector.media;
    delete bySector.entertainment;
    bySector[CANON] = merged;
    if (!opts.dry) {
      await db.collection("marketCapHistory").updateOne({ _id: row._id }, { $set: { bySector } });
    }
    touched += 1;
  }

  const ledgerRows = await db
    .collection<{ _id: ObjectId; sectorTypes?: unknown }>("nationalizationLedger")
    .find({ sectorTypes: legacyFilter })
    .toArray();
  for (const row of ledgerRows) {
    if (!Array.isArray(row.sectorTypes)) continue;
    const next = [
      ...new Set(row.sectorTypes.map((entry) => (isLegacyMediaSectorType(entry) ? CANON : entry))),
    ];
    if (!opts.dry) {
      await db
        .collection("nationalizationLedger")
        .updateOne({ _id: row._id }, { $set: { sectorTypes: next } });
    }
    touched += 1;
  }

  const states = await db
    .collection<{
      _id: ObjectId;
      sectorSpecializations?: { primary?: unknown; secondary?: unknown; updatedAt?: unknown };
      topSectorsCache?: {
        sectors?: { sectorType?: unknown; revenue?: unknown; specializationBonus?: unknown }[];
        computedAtTurn?: unknown;
      };
    }>("states")
    .find({
      $or: [
        { "sectorSpecializations.primary": legacyFilter },
        { "sectorSpecializations.secondary": legacyFilter },
        { topSectorsCache: { $exists: true } },
      ],
    })
    .toArray();
  for (const state of states) {
    const set: Record<string, unknown> = {};
    if (
      state.sectorSpecializations &&
      (isLegacyMediaSectorType(state.sectorSpecializations.primary) ||
        isLegacyMediaSectorType(state.sectorSpecializations.secondary))
    ) {
      set.sectorSpecializations = {
        ...state.sectorSpecializations,
        primary: isLegacyMediaSectorType(state.sectorSpecializations.primary)
          ? CANON
          : state.sectorSpecializations.primary,
        secondary: isLegacyMediaSectorType(state.sectorSpecializations.secondary)
          ? CANON
          : state.sectorSpecializations.secondary,
      };
    }
    if (Array.isArray(state.topSectorsCache?.sectors)) {
      const sectors = state.topSectorsCache.sectors.map((entry) => ({
        ...entry,
        sectorType: isLegacyMediaSectorType(entry.sectorType) ? CANON : entry.sectorType,
      }));
      if (JSON.stringify(sectors) !== JSON.stringify(state.topSectorsCache.sectors)) {
        set.topSectorsCache = { ...state.topSectorsCache, sectors };
      }
    }
    if (Object.keys(set).length === 0) continue;
    if (!opts.dry) {
      await db.collection("states").updateOne({ _id: state._id }, { $set: set });
    }
    touched += 1;
  }

  for (const collection of ["sentimentPulses", "countryModifiers"] as const) {
    const result = opts.dry
      ? {
          modifiedCount: await db
            .collection(collection)
            .countDocuments({ sectorType: legacyFilter }),
        }
      : await db
          .collection(collection)
          .updateMany({ sectorType: legacyFilter }, { $set: { sectorType: CANON } });
    touched += result.modifiedCount ?? 0;
  }

  const bills = await db
    .collection<{ _id: ObjectId; provisions?: unknown }>("bills")
    .find({
      $or: [
        { "provisions.targetSectorType": legacyFilter },
        { "provisions.sectorType": legacyFilter },
        { "provisions.targetStrategyId": { $in: LEGACY_STRATEGY_IDS } },
      ],
    })
    .toArray();
  for (const bill of bills) {
    const next = rekeyBillProvisions(bill.provisions);
    if (!next) continue;
    if (!opts.dry) {
      await db
        .collection("bills")
        .updateOne({ _id: bill._id }, { $set: { provisions: next, updatedAt: opts.now } });
    }
    touched += 1;
  }
  return touched;
}

const zeroCounts = (): MediaEntertainmentConsolidationCounts => ({
  corporations: 0,
  operatingModels: 0,
  sectorsRekeyed: 0,
  sectorMerges: 0,
  sectorsDeleted: 0,
  unownedRekeyed: 0,
  unownedMerges: 0,
  unownedDeleted: 0,
  unionsRekeyed: 0,
  unionMerges: 0,
  unionsDeleted: 0,
  campaignsRekeyed: 0,
  agreementsRekeyed: 0,
  designationsRekeyed: 0,
  designationsDeleted: 0,
  fundsFolded: 0,
  fundsDeleted: 0,
  positionsMoved: 0,
  historiesRekeyed: 0,
});

/**
 * Persisted-data consolidation for the media/entertainment merge (issue
 * #2234), following the repairDuplicateSectors conventions: deterministic
 * earliest survivor per collision key, additive conservation legs,
 * revenue-weighted margin/policy, plant fold gated on the plants tier, no
 * transactions, safe to rerun.
 */
export async function consolidateMediaEntertainment(
  db: Db,
  ctx: MigrationContext
): Promise<{ counts: MediaEntertainmentConsolidationCounts; notes: string[] }> {
  const counts = zeroCounts();
  const notes: string[] = [];
  const now = new Date();
  const dry = ctx.dryRun;
  const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");
  const turn = await getCurrentTurn(db);

  // ── 1. Corporations: types, tech unlocks, inferred operating models ──────
  const corporations = await db
    .collection<CorporationDoc>("corporations")
    .find({
      $or: [
        { type: { $in: ["media", "entertainment"] } },
        { secondaryType: { $in: ["media", "entertainment"] } },
      ],
    })
    .toArray();
  const legacySectorTypesByCorp = new Map<string, unknown[]>();
  const legacySectors = await db
    .collection<SectorDoc>("corporateSectors")
    .find(
      { sectorType: { $in: ["media", "entertainment"] } },
      { projection: { corporationId: 1, sectorType: 1 } }
    )
    .toArray();
  for (const sector of legacySectors) {
    const key = String(sector.corporationId);
    legacySectorTypesByCorp.set(key, [
      ...(legacySectorTypesByCorp.get(key) ?? []),
      sector.sectorType,
    ]);
  }
  const corpPreImage = new Map(
    corporations.map((corp) => [
      String(corp._id),
      { type: corp.type, secondaryType: corp.secondaryType },
    ])
  );
  for (const corp of corporations) {
    const pre = corpPreImage.get(String(corp._id))!;
    const plan = planCorporationTypeMigration(pre.type, pre.secondaryType);
    const nextTech = consolidateMediaTechUnlocks(
      Array.isArray(corp.unlockedTechNodeIds) ? (corp.unlockedTechNodeIds as unknown[]) : undefined,
      mapLegacyMediaTechId
    );
    const techChanged = JSON.stringify(nextTech) !== JSON.stringify(corp.unlockedTechNodeIds ?? []);
    if (!plan.changed && !techChanged) continue;
    const set: Record<string, unknown> = {};
    if (plan.changed) {
      set.type = plan.type;
      set.secondaryType = plan.secondaryType;
    }
    if (techChanged) set.unlockedTechNodeIds = nextTech;
    set.updatedAt = now;
    if (!dry) {
      await db.collection("corporations").updateOne({ _id: corp._id }, { $set: set });
    }
    counts.corporations += 1;
  }
  const modelCorps = new Set<string>([
    ...corporations.map((corp) => String(corp._id)),
    ...legacySectorTypesByCorp.keys(),
  ]);
  for (const corpId of [...modelCorps].sort()) {
    const pre = corpPreImage.get(corpId);
    const models = unionInferredOperatingModels([
      pre?.type,
      pre?.secondaryType,
      ...(legacySectorTypesByCorp.get(corpId) ?? []),
    ]);
    for (const model of models) {
      if (!dry) {
        await db.collection("corporationOperatingModels").updateOne(
          { _id: `${corpId}:${model}` },
          {
            $set: { corporationId: corpId, operatingModel: model },
            $setOnInsert: { acquiredTurn: turn },
          },
          { upsert: true }
        );
      }
      counts.operatingModels += 1;
    }
  }
  notes.push(
    `${counts.corporations} corporation(s) retyped, ${counts.operatingModels} operating-model grant(s)`
  );

  // ── 2. Owned sectors: rekey + deterministic collision fold ────────────────
  const sectors = await db
    .collection<SectorDoc>("corporateSectors")
    .find({ sectorType: { $in: ["media", "entertainment", CANON] } })
    .toArray();
  const groups = new Map<string, SectorDoc[]>();
  for (const sector of sectors) {
    const key = sectorGroupKey(sector);
    groups.set(key, [...(groups.get(key) ?? []), sector]);
  }
  for (const group of groups.values()) {
    const legacy = group.filter((row) => isLegacyMediaSectorType(row.sectorType));
    if (legacy.length === 0) continue;
    if (group.length < 2) {
      const row = legacy[0]!;
      const set: Record<string, unknown> = {
        sectorType: CANON,
        strategyId: canonicalMediaStrategyForLegacy(row.strategyId),
        updatedAt: now,
      };
      const fromTransition =
        typeof row.transitionFromStrategyId === "string"
          ? canonicalizeMediaStrategyIdInput(row.transitionFromStrategyId)
          : row.transitionFromStrategyId;
      if (fromTransition !== row.transitionFromStrategyId) {
        set.transitionFromStrategyId = fromTransition;
      }
      if (!dry) {
        await db.collection("corporateSectors").updateOne({ _id: row._id }, { $set: set });
      }
      counts.sectorsRekeyed += 1;
      continue;
    }
    const ordered = oldestFirst(
      group,
      (row) => String(row._id),
      (row) => createdAtMs(row.createdAt)
    );
    const [survivor, ...losers] = ordered as [SectorDoc, ...SectorDoc[]];
    const strategies = ordered.map((row) => canonicalMediaStrategyForLegacy(row.strategyId));
    // Retool every leg onto the diversified recipe first (nameplate-invariant),
    // then fold plant state with the transfer-merge semantics. Below plants the
    // capacity basis does not exist, so no plant keys are stamped at all.
    const retooled = plantsEnabled
      ? ordered.map((row, index) => {
          const ratio = capacityRescaleRatio(CANON, strategies[index], DIVERSIFIED);
          const queue = rescaleBuildQueueForStrategyChange(
            (Array.isArray(row.buildQueue) ? row.buildQueue : []) as {
              unitsOrdered: number;
            }[],
            ratio
          );
          const opex =
            typeof row.otherOpexPerUnitAnchor === "number" &&
            Number.isFinite(row.otherOpexPerUnitAnchor) &&
            Number.isFinite(ratio) &&
            ratio > 0
              ? row.otherOpexPerUnitAnchor / ratio
              : row.otherOpexPerUnitAnchor;
          const operatingUnits =
            typeof row.operatingCapacityUnits === "number" &&
            Number.isFinite(row.operatingCapacityUnits)
              ? row.operatingCapacityUnits * ratio
              : row.operatingCapacityUnits;
          return {
            row,
            plant: {
              ...readSectorPlantFields(row),
              sectorType: CANON,
              capitalStock: positive(row.capitalStock) * ratio,
              operatingCapacityUnits: operatingUnits,
              buildQueue: queue,
              otherOpexPerUnitAnchor: opex,
            },
          };
        })
      : ordered.map((row) => ({ row, plant: null }));
    const plantUpdate: Record<string, unknown> = {};
    if (plantsEnabled) {
      let merged = mergeSectorPlantFields(
        { ...(retooled[0]!.plant ?? {}), sectorType: CANON },
        { sectorType: CANON }
      );
      for (const leg of retooled.slice(1)) {
        merged = mergeSectorPlantFields(
          { ...merged, sectorType: CANON },
          { ...(leg.plant ?? {}), sectorType: CANON }
        );
      }
      Object.assign(plantUpdate, merged);
    }
    const totalRevenue = ordered.reduce((sum, row) => sum + positive(row.revenue), 0);
    const totalWorkers = ordered.reduce((sum, row) => sum + positive(row.workers), 0);
    const totalLaborCost = ordered.reduce((sum, row) => sum + positive(row.laborCost), 0);
    const hasDesired = ordered.some((row) => typeof row.workersDesired === "number");
    const set: Record<string, unknown> = {
      sectorType: CANON,
      strategyId: DIVERSIFIED,
      revenue: totalRevenue,
      workers: totalWorkers,
      profitMargin: revenueWeighted(ordered, totalRevenue, finite(survivor.profitMargin), (row) =>
        finite(row.profitMargin)
      ),
      productionPolicyLevel: Math.round(
        revenueWeighted(ordered, totalRevenue, finite(survivor.productionPolicyLevel), (row) =>
          finite(row.productionPolicyLevel)
        )
      ),
      negativeProductionSustainedTurns: Math.round(
        revenueWeighted(
          ordered,
          totalRevenue,
          finite(survivor.negativeProductionSustainedTurns),
          (row) => finite(row.negativeProductionSustainedTurns)
        )
      ),
      inventoryUnits: sumInventoryUnits(ordered),
      inventoryValueAnchor: ordered.reduce(
        (sum, row) => sum + positive(row.inventoryValueAnchor),
        0
      ),
      inventoryDrainedUnits: ordered.reduce(
        (sum, row) => sum + positive(row.inventoryDrainedUnits),
        0
      ),
      inventorySpoiledUnits: ordered.reduce(
        (sum, row) => sum + positive(row.inventorySpoiledUnits),
        0
      ),
      realizedRevenue: ordered.reduce((sum, row) => sum + positive(row.realizedRevenue), 0),
      producedUnits: ordered.reduce((sum, row) => sum + positive(row.producedUnits), 0),
      soldUnits: ordered.reduce((sum, row) => sum + positive(row.soldUnits), 0),
      contractAchievableUnits: ordered.reduce(
        (sum, row) => sum + positive(row.contractAchievableUnits),
        0
      ),
      updatedAt: now,
      ...plantUpdate,
    };
    if (hasDesired) {
      set.workersDesired = ordered.reduce(
        (sum, row) => sum + (typeof row.workersDesired === "number" ? row.workersDesired : 0),
        0
      );
    }
    if (ordered.some((row) => typeof row.laborCost === "number")) {
      set.laborCost = totalLaborCost;
      set.wagePerWorker =
        totalWorkers > 0 ? totalLaborCost / totalWorkers : (survivor.wagePerWorker ?? null);
    }
    if (!dry) {
      await db.collection("corporateSectors").updateOne({ _id: survivor._id }, { $set: set });
      await db
        .collection("corporateSectors")
        .deleteMany({ _id: { $in: losers.map((row) => row._id) } });
    }
    counts.sectorMerges += 1;
    counts.sectorsDeleted += losers.length;
    counts.sectorsRekeyed += legacy.length;
  }
  notes.push(
    `${counts.sectorsRekeyed} sector row(s) rekeyed, ${counts.sectorMerges} collision(s) folded, ${counts.sectorsDeleted} loser row(s) removed`
  );

  // ── 3. Unowned sectors: rekey + deterministic collision fold ──────────────
  const unowned = await db
    .collection<UnownedDoc>("unownedSectors")
    .find({ sectorType: { $in: ["media", "entertainment", CANON] } })
    .toArray();
  const unownedGroups = new Map<string, UnownedDoc[]>();
  for (const row of unowned) {
    const key = `${String(row.countryId)}::${String(row.stateId)}`;
    unownedGroups.set(key, [...(unownedGroups.get(key) ?? []), row]);
  }
  for (const group of unownedGroups.values()) {
    const legacy = group.filter((row) => isLegacyMediaSectorType(row.sectorType));
    if (legacy.length === 0) continue;
    if (group.length < 2) {
      if (!dry) {
        await db
          .collection("unownedSectors")
          .updateOne({ _id: legacy[0]!._id }, { $set: { sectorType: CANON, updatedAt: now } });
      }
      counts.unownedRekeyed += 1;
      continue;
    }
    const ordered = oldestFirst(
      group,
      (row) => String(row._id),
      (row) => createdAtMs(row.createdAt)
    );
    const [survivor, ...losers] = ordered as [UnownedDoc, ...UnownedDoc[]];
    const restores: { sectorId: string; restoredAt: Date }[] = [];
    const seenRestore = new Set<string>();
    for (const row of ordered) {
      const list = Array.isArray(row.recentCorporateSectorRestores)
        ? (row.recentCorporateSectorRestores as { sectorId?: unknown; restoredAt?: unknown }[])
        : [];
      for (const entry of list) {
        const key = String(entry.sectorId);
        if (seenRestore.has(key)) continue;
        seenRestore.add(key);
        if (entry.restoredAt instanceof Date)
          restores.push({ sectorId: key, restoredAt: entry.restoredAt });
      }
    }
    const set: Record<string, unknown> = {
      sectorType: CANON,
      revenue: ordered.reduce((sum, row) => sum + positive(row.revenue), 0),
      updatedAt: now,
    };
    if (ordered.some((row) => typeof row.headroomUnits === "number")) {
      set.headroomUnits = ordered.reduce((sum, row) => sum + positive(row.headroomUnits), 0);
    }
    if (restores.length > 0) set.recentCorporateSectorRestores = restores;
    if (!dry) {
      await db.collection("unownedSectors").updateOne({ _id: survivor._id }, { $set: set });
      await db
        .collection("unownedSectors")
        .deleteMany({ _id: { $in: losers.map((row) => row._id) } });
    }
    counts.unownedMerges += 1;
    counts.unownedDeleted += losers.length;
    counts.unownedRekeyed += legacy.length;
  }
  notes.push(
    `${counts.unownedRekeyed} unowned row(s) rekeyed, ${counts.unownedMerges} collision(s) folded`
  );

  // ── 4. Unions: rekey + seeded same-country collision fold ─────────────────
  const legacyUnions = await db
    .collection<UnionDoc>("unions")
    .find({ sectorType: { $in: ["media", "entertainment"] } })
    .toArray();
  for (const union of legacyUnions) {
    if (!dry) {
      await db
        .collection("unions")
        .updateOne({ _id: union._id }, { $set: { sectorType: CANON, updatedAt: now } });
    }
    counts.unionsRekeyed += 1;
  }
  const canonUnions = await db.collection<UnionDoc>("unions").find({ sectorType: CANON }).toArray();
  const unionsByCountry = new Map<string, UnionDoc[]>();
  for (const union of canonUnions) {
    const key = String(union.countryId);
    unionsByCountry.set(key, [...(unionsByCountry.get(key) ?? []), union]);
  }
  for (const group of unionsByCountry.values()) {
    const seeded = group.filter(
      (union) => union.foundedByCharacterId === null || union.foundedByCharacterId === undefined
    );
    if (seeded.length < 2) continue;
    const ordered = oldestFirst(
      seeded,
      (row) => String(row._id),
      (row) => createdAtMs(row.createdAt)
    );
    const [survivor, ...losers] = ordered as [UnionDoc, ...UnionDoc[]];
    const loserIds = losers.map((row) => row._id);
    if (!dry) {
      await db.collection("unions").updateOne(
        { _id: survivor._id },
        {
          $set: {
            treasury:
              finite(survivor.treasury) +
              losers.reduce((sum, row) => sum + finite(row.treasury), 0),
            updatedAt: now,
            ...(ordered.some((row) => typeof row.strength === "number")
              ? { strength: ordered.reduce((sum, row) => sum + finite(row.strength), 0) }
              : {}),
          },
        }
      );
      await db
        .collection("corporateSectors")
        .updateMany(
          { representingUnionId: { $in: loserIds } },
          { $set: { representingUnionId: survivor._id } }
        );
      await db
        .collection("bargainingCampaigns")
        .updateMany({ unionId: { $in: loserIds } }, { $set: { unionId: survivor._id } });
      await db
        .collection("collectiveAgreements")
        .updateMany({ unionId: { $in: loserIds } }, { $set: { unionId: survivor._id } });
      await db.collection("unions").deleteMany({ _id: { $in: loserIds } });
    }
    counts.unionMerges += 1;
    counts.unionsDeleted += losers.length;
  }
  notes.push(
    `${counts.unionsRekeyed} union(s) rekeyed, ${counts.unionMerges} seeded collision(s) folded`
  );

  // ── 5. Bargaining campaigns + collective agreements: rekey in place ──────
  for (const collection of ["bargainingCampaigns", "collectiveAgreements"] as const) {
    const result = dry
      ? {
          modifiedCount: await db
            .collection(collection)
            .countDocuments({ sectorType: { $in: ["media", "entertainment"] } }),
        }
      : await db
          .collection(collection)
          .updateMany(
            { sectorType: { $in: ["media", "entertainment"] } },
            { $set: { sectorType: CANON, updatedAt: now } }
          );
    if (collection === "bargainingCampaigns") counts.campaignsRekeyed += result.modifiedCount ?? 0;
    else counts.agreementsRekeyed += result.modifiedCount ?? 0;
  }
  notes.push(
    `${counts.campaignsRekeyed} campaign(s) and ${counts.agreementsRekeyed} agreement(s) rekeyed`
  );

  // ── 6. Strategic designations: rekey + same-country collision fold ────────
  const designations = await db
    .collection<{
      _id: ObjectId;
      countryId?: unknown;
      sectorType?: unknown;
      designatedAtTurn?: unknown;
      createdAt?: unknown;
    }>("strategicSectorDesignations")
    .find({ sectorType: { $in: ["media", "entertainment", CANON] } })
    .toArray();
  const designationsByCountry = new Map<string, typeof designations>();
  for (const row of designations) {
    const key = String(row.countryId);
    designationsByCountry.set(key, [...(designationsByCountry.get(key) ?? []), row]);
  }
  for (const group of designationsByCountry.values()) {
    const legacy = group.filter((row) => isLegacyMediaSectorType(row.sectorType));
    if (legacy.length === 0) continue;
    if (group.length < 2) {
      if (!dry) {
        await db
          .collection("strategicSectorDesignations")
          .updateOne({ _id: legacy[0]!._id }, { $set: { sectorType: CANON } });
      }
      counts.designationsRekeyed += 1;
      continue;
    }
    const ordered = oldestFirst(
      group,
      (row) => String(row._id),
      (row) => finite(row.designatedAtTurn) || createdAtMs(row.createdAt)
    );
    const [survivor, ...losers] = ordered;
    if (!dry) {
      if (isLegacyMediaSectorType(survivor!.sectorType)) {
        await db
          .collection("strategicSectorDesignations")
          .updateOne({ _id: survivor!._id }, { $set: { sectorType: CANON } });
      }
      await db
        .collection("strategicSectorDesignations")
        .deleteMany({ _id: { $in: losers.map((row) => row._id) } });
    }
    counts.designationsRekeyed += legacy.length;
    counts.designationsDeleted += losers.length;
  }
  notes.push(
    `${counts.designationsRekeyed} designation(s) rekeyed, ${counts.designationsDeleted} duplicate(s) removed`
  );

  // ── 7. Index funds: fold legacy media/entertainment funds into GLBMEA ────
  const fundsResult = await foldLegacyIndexFunds(db, { dry, now });
  counts.fundsFolded += fundsResult.fundsFolded;
  counts.fundsDeleted += fundsResult.fundsDeleted;
  counts.positionsMoved += fundsResult.positionsMoved;
  counts.historiesRekeyed += fundsResult.definitionsRekeyed;
  notes.push(
    `${fundsResult.fundsFolded} fund(s) folded into ${SURVIVOR_FUND_TICKER}, ${fundsResult.fundsDeleted} retired, ${fundsResult.positionsMoved} position(s) moved`
  );

  // ── 8. Type-keyed histories and config: rekey in place ────────────────────
  counts.historiesRekeyed += await rekeyTypeKeyedHistories(db, { dry, now });
  notes.push(`${counts.historiesRekeyed} history/config document(s) rekeyed`);

  return { counts, notes };
}

export const migration: Migration = {
  id: "2026-09-21-media-entertainment-persisted-consolidation",
  description:
    "Consolidate persisted media/entertainment rows onto media_entertainment (corps, sectors, unions, funds, histories).",
  idempotent: true,
  execute: async (db: Db, ctx: MigrationContext): Promise<MigrationResult> => {
    const { counts, notes } = await consolidateMediaEntertainment(db, ctx);
    const scanned =
      counts.corporations +
      counts.sectorsRekeyed +
      counts.unownedRekeyed +
      counts.unionsRekeyed +
      counts.historiesRekeyed;
    return {
      documentsScanned: scanned,
      documentsUpdated:
        counts.corporations +
        counts.operatingModels +
        counts.sectorsRekeyed +
        counts.unownedRekeyed +
        counts.unionsRekeyed +
        counts.campaignsRekeyed +
        counts.agreementsRekeyed +
        counts.designationsRekeyed +
        counts.positionsMoved +
        counts.historiesRekeyed,
      documentsDeleted:
        counts.sectorsDeleted + counts.unownedDeleted + counts.unionsDeleted + counts.fundsDeleted,
      notes: ctx.dryRun ? ["DRY RUN, no writes.", ...notes] : notes,
    };
  },
};
