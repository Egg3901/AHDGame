// AHD-dissolution-npp-successors: leaving plants were deleted outright.
//
// Before NPP pickup existed, every plant that left its owner (dissolution by
// any path, or a sector abandon) returned all of its capacity to the unowned
// pool. Headroom is bookkeeping, not supply, so the plant simply stopped and
// each large exit was a supply shock in every market it served.
//
// Half A (code): `disposeLeavingSectors` hands NPP_PICKUP_SHARE of each leaving
// plant's built capacity to an NPP operator.
// Half B (this heal): apply the same share to exits that already happened,
// drawing the capacity back out of the pool it went into.
//
// The sector rows are gone, so each event is reconstructed from two surviving
// records:
//  - WHERE: `restoreSectorsToUnowned` leaves a per-sector restore token on each
//    pool it credited, stamped with the moment of the restore. A dissolution's
//    tokens carry the exit row's own `createdAt`; an abandonment's fall inside
//    the window it ran in. Tokens prune after seven days.
//  - HOW MUCH: `corporationHistory` carries output by commodity, which is the
//    exact sum of the corporation's sectors' produced units. A dissolution lost
//    its last recorded output; an abandonment lost the drop across its window.
//    Output converts to capacity through the live fleet's capacity-per-output
//    ratio for the same lane and country.
// Each pickup takes NPP_PICKUP_SHARE of that estimate and never more than the
// headroom still unclaimed in the pool, so capacity others have since built
// into is not counted twice.

import { ObjectId, type Db } from "mongodb";
import type {
  Corporation,
  CorporateSector,
  CorporationExit,
  CorporationExitReason,
  CorporationHistory,
  UnownedSector,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import {
  DEFAULT_PROFIT_MARGIN,
  DEFAULT_SECTOR_STARTING_WORKERS,
  OPERATING_SECTOR_TYPES,
  operatingSectorIdentity,
  type CorporationType,
  type OperatingSectorType,
} from "@/lib/constants/corporations";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategyDefinitions";
import { getOperatingSectorType } from "@/lib/constants/sectorStrategies";
import { NPP_DEFAULT_STARTING_CAPITAL_ANCHOR } from "@/lib/admin/spawnNppCorporation";
import {
  NPP_PICKUP_SHARE,
  chooseNppPickupReceiver,
  creditNppPickup,
} from "@/lib/corporations/nppPickup";
import { seedPlantLedger } from "@/lib/corporations/plantLedger";
import { isPrivateEnterpriseBlocked } from "@/lib/economy/queries/privateEnterpriseGate";
import { loadWorldEraUnitScale, loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import { getEraNominalScale } from "@/lib/constants/sectorSeedEra";
import { unownedPoolDrawdown } from "@/lib/market/unownedPoolDraw";
import type {
  Defect,
  DetectResult,
  HealContext,
  HealPlan,
  HealResult,
  VerifyResult,
} from "../types";

export const DEFECT_ID = "AHD-dissolution-npp-successors";

const DISSOLUTION_REASONS: readonly CorporationExitReason[] = [
  "voluntary_closure",
  "shareholder_vote",
  "bond_default",
  "forced_liquidation",
  "npp_insolvency",
  "owner_deleted",
];

/**
 * Mass abandonments to restore. An abandon leaves no exit row, so the event is
 * named here: the corporation, the window its restores ran in, and the lane.
 */
const KNOWN_ABANDONMENTS: ReadonlyArray<{
  id: string;
  corporationId: string;
  from: string;
  to: string;
  lanes: OperatingSectorType[];
}> = [
  {
    // Turns 192-194, 2026-10-14: a whole logistics network abandoned in under
    // two hours, about a third of world freight supply.
    id: "abandon-6ac3dbf9-t193",
    corporationId: "6ac3dbf9c6e9f850d977790d",
    from: "2026-10-14T16:38:00.000Z",
    to: "2026-10-14T18:01:00.000Z",
    lanes: ["logistics"],
  },
];

/** Pickups below this many capacity units are not worth a write. */
const MIN_PICKUP_UNITS = 0.5;

interface PlannedPickup {
  key: string;
  poolId: string;
  stateId: string;
  countryId: string;
  sectorType: string;
  industryModel: string | null;
  mediaDiscriminator: string | null;
  units: number;
}

interface PlannedEvent {
  eventId: string;
  label: string;
  exitId?: string;
  ownerId: string;
  pickups: PlannedPickup[];
}

interface Payload {
  events: PlannedEvent[];
}

type PoolDoc = UnownedSector & { _id: ObjectId };
type HistoryRow = CorporationHistory & {
  commodityOutput?: Record<string, number>;
  taxPaidByState?: Record<string, number>;
};

function laneOfPool(
  pool: Pick<UnownedSector, "sectorType" | "industryModel" | "mediaDiscriminator">
): OperatingSectorType {
  return getOperatingSectorType(
    pool.sectorType as CorporationType,
    pool.industryModel,
    pool.mediaDiscriminator
  ) as OperatingSectorType;
}

/** Commodities each operating lane can supply under any of its strategies. */
function suppliersByCommodity(): Map<string, Set<OperatingSectorType>> {
  const out = new Map<string, Set<OperatingSectorType>>();
  for (const lane of OPERATING_SECTOR_TYPES) {
    for (const strategy of SECTOR_STRATEGIES[lane] ?? []) {
      for (const [commodity, rate] of Object.entries(strategy.supply ?? {})) {
        if (!(typeof rate === "number" && rate > 0)) continue;
        const set = out.get(commodity) ?? new Set<OperatingSectorType>();
        set.add(lane);
        out.set(commodity, set);
      }
    }
  }
  return out;
}

/** Output units by lane, each commodity split over the lanes present that supply it. */
function outputByLane(
  output: Record<string, number>,
  lanes: ReadonlySet<OperatingSectorType>,
  suppliers: Map<string, Set<OperatingSectorType>>
): Map<OperatingSectorType, number> {
  const out = new Map<OperatingSectorType, number>();
  for (const [commodity, units] of Object.entries(output)) {
    if (!(typeof units === "number" && units > 0)) continue;
    const supplying = [...(suppliers.get(commodity) ?? [])].filter((l) => lanes.has(l));
    for (const lane of supplying) {
      out.set(lane, (out.get(lane) ?? 0) + units / supplying.length);
    }
  }
  return out;
}

/**
 * Capacity units per unit of output for live sectors of a lane, in one
 * country when it has producing sectors of that lane, else world-wide.
 */
async function fleetCapacityPerOutput(
  db: Db,
  lane: OperatingSectorType,
  countryId: string,
  cache: Map<string, number | null>
): Promise<number | null> {
  const identity = operatingSectorIdentity(lane);
  const filter = {
    sectorType: identity.sectorType,
    industryModel: identity.industryModel,
    mediaDiscriminator: identity.mediaDiscriminator,
    producedUnits: { $gt: 0 },
    capitalStock: { $gt: 0 },
  };
  const ratio = async (match: Record<string, unknown>): Promise<number | null> => {
    const [row] = await db
      .collection<CorporateSector>("corporateSectors")
      .aggregate<{ capacity: number; output: number }>([
        { $match: match },
        {
          $group: {
            _id: null,
            capacity: { $sum: "$capitalStock" },
            output: { $sum: "$producedUnits" },
          },
        },
      ])
      .toArray();
    return row && row.output > 0 && row.capacity > 0 ? row.capacity / row.output : null;
  };
  const key = `${lane}|${countryId}`;
  if (!cache.has(key)) {
    cache.set(key, (await ratio({ ...filter, countryId })) ?? (await ratio(filter)));
  }
  return cache.get(key) ?? null;
}

function headroomOf(pool: Pick<UnownedSector, "headroomUnits">): number {
  return typeof pool.headroomUnits === "number" && Number.isFinite(pool.headroomUnits)
    ? Math.max(0, pool.headroomUnits)
    : 0;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function eventDone(db: Db, eventId: string): Promise<boolean> {
  return (
    (await db
      .collection<CorporateSector>("corporateSectors")
      .countDocuments(
        { nppPickupReceipts: { $regex: `^heal-pickup:${escapeRegex(eventId)}:` } },
        { limit: 1 }
      )) > 0
  );
}

interface PlanContext {
  suppliers: Map<string, Set<OperatingSectorType>>;
  ratioCache: Map<string, number | null>;
  /** Headroom already promised to an earlier event in this plan. */
  headroomLeft: Map<string, number>;
  notes: string[];
}

/**
 * Size NPP_PICKUP_SHARE of a lost output across the pools it went into. Pools
 * share a lane's output by tax paid when the record has it for every pool, else
 * by their current headroom.
 */
async function sizePickups(
  db: Db,
  eventId: string,
  label: string,
  pools: PoolDoc[],
  lostOutput: Record<string, number>,
  taxByState: Record<string, number> | undefined,
  ctx: PlanContext
): Promise<PlannedPickup[]> {
  const poolsByLane = new Map<OperatingSectorType, PoolDoc[]>();
  for (const pool of pools) {
    const lane = laneOfPool(pool);
    poolsByLane.set(lane, [...(poolsByLane.get(lane) ?? []), pool]);
  }
  const byLane = outputByLane(lostOutput, new Set(poolsByLane.keys()), ctx.suppliers);
  const pickups: PlannedPickup[] = [];
  for (const [lane, lanePools] of poolsByLane) {
    const laneOutput = byLane.get(lane) ?? 0;
    if (!(laneOutput > 0)) continue;
    const taxed = lanePools.map((pool) => Math.max(0, taxByState?.[pool.stateId] ?? 0));
    const weights = taxed.every((t) => t > 0) ? taxed : lanePools.map(headroomOf);
    const total = weights.reduce((a, b) => a + b, 0);
    if (!(total > 0)) continue;
    for (const [i, pool] of lanePools.entries()) {
      const ratio = await fleetCapacityPerOutput(db, lane, pool.countryId, ctx.ratioCache);
      if (ratio == null) {
        ctx.notes.push(`${label}: no live ${lane} fleet to size capacity from`);
        continue;
      }
      const poolKey = pool._id.toHexString();
      const available = ctx.headroomLeft.get(poolKey) ?? headroomOf(pool);
      const estimate = laneOutput * (weights[i] / total) * ratio;
      const units = Math.min(available, estimate * NPP_PICKUP_SHARE);
      if (!(units >= MIN_PICKUP_UNITS)) continue;
      ctx.headroomLeft.set(poolKey, available - units);
      pickups.push({
        key: `heal-pickup:${eventId}:${poolKey}`,
        poolId: poolKey,
        stateId: pool.stateId,
        countryId: pool.countryId,
        sectorType: pool.sectorType,
        industryModel: pool.industryModel ?? null,
        mediaDiscriminator: pool.mediaDiscriminator ?? null,
        units: Math.round(units * 100) / 100,
      });
    }
  }
  return pickups;
}

async function buildPlan(db: Db): Promise<{ events: PlannedEvent[]; notes: string[] }> {
  const ctx: PlanContext = {
    suppliers: suppliersByCommodity(),
    ratioCache: new Map(),
    headroomLeft: new Map(),
    notes: [],
  };
  const events: PlannedEvent[] = [];
  const pools = db.collection<PoolDoc>("unownedSectors");
  const history = db.collection<HistoryRow>("corporationHistory");

  const exits = await db
    .collection<CorporationExit>("corporationExits")
    .find({ reason: { $in: [...DISSOLUTION_REASONS] } })
    .sort({ createdAt: 1, _id: 1 })
    .toArray();
  for (const exit of exits) {
    const eventId = `exit-${exit._id.toHexString()}`;
    if (await eventDone(db, eventId)) continue;
    if (await isPrivateEnterpriseBlocked(db, exit.countryId as CountryId)) continue;
    const tokenPools = await pools
      .find({ "recentCorporateSectorRestores.restoredAt": exit.createdAt })
      .sort({ _id: 1 })
      .toArray();
    if (tokenPools.length === 0) {
      ctx.notes.push(`${exit.name}: no restore evidence left, skipped`);
      continue;
    }
    // The row written on the exit turn itself has no output; read the last
    // one that does.
    const last = await history
      .find({ corporationId: exit.corporationId, commodityOutput: { $exists: true } })
      .sort({ turn: -1 })
      .limit(1)
      .next();
    if (!last?.commodityOutput) continue;
    const pickups = await sizePickups(
      db,
      eventId,
      exit.name,
      tokenPools,
      last.commodityOutput,
      last.taxPaidByState,
      ctx
    );
    if (pickups.length > 0) {
      events.push({
        eventId,
        label: exit.name,
        exitId: exit._id.toHexString(),
        ownerId: exit.corporationId.toHexString(),
        pickups,
      });
    }
  }

  for (const known of KNOWN_ABANDONMENTS) {
    const eventId = known.id;
    if (await eventDone(db, eventId)) continue;
    const corpId = new ObjectId(known.corporationId);
    const from = new Date(known.from);
    const to = new Date(known.to);
    const [before, after] = await Promise.all([
      history
        .find({ corporationId: corpId, createdAt: { $lt: from } })
        .sort({ createdAt: -1 })
        .limit(1)
        .next(),
      history
        .find({ corporationId: corpId, createdAt: { $gt: to } })
        .sort({ createdAt: 1 })
        .limit(1)
        .next(),
    ]);
    if (!before?.commodityOutput) {
      ctx.notes.push(`${eventId}: no output before the window, skipped`);
      continue;
    }
    const lost: Record<string, number> = {};
    for (const [commodity, units] of Object.entries(before.commodityOutput)) {
      const drop = units - (after?.commodityOutput?.[commodity] ?? 0);
      if (drop > 0) lost[commodity] = drop;
    }
    const laneSet = new Set<OperatingSectorType>(known.lanes);
    const windowPools = (
      await pools
        .find({ "recentCorporateSectorRestores.restoredAt": { $gte: from, $lte: to } })
        .sort({ _id: 1 })
        .toArray()
    ).filter((pool) => laneSet.has(laneOfPool(pool)));
    const pickups = await sizePickups(db, eventId, eventId, windowPools, lost, undefined, ctx);
    if (pickups.length > 0) {
      events.push({ eventId, label: eventId, ownerId: known.corporationId, pickups });
    }
  }

  return { events, notes: ctx.notes };
}

async function detect(db: Db): Promise<DetectResult> {
  const { events, notes } = await buildPlan(db);
  return {
    affected: events.length,
    sample: events.slice(0, 10).map((e) => ({
      event: e.label,
      pickups: e.pickups.length,
      units: Math.round(e.pickups.reduce((n, p) => n + p.units, 0)),
    })),
    notes,
  };
}

async function plan(db: Db): Promise<HealPlan> {
  const { events, notes } = await buildPlan(db);
  const preset = await loadWorldPreset(db);
  const pickupCount = events.reduce((n, e) => n + e.pickups.length, 0);
  const poolIds = [...new Set(events.flatMap((e) => e.pickups.map((p) => p.poolId)))].sort();
  const exitIds = events.flatMap((e) => (e.exitId ? [e.exitId] : [])).sort();
  return {
    affected: events.length,
    touched: [
      { collection: "unownedSectors", ids: poolIds },
      { collection: "corporationExits", ids: exitIds },
    ],
    // Capacity moves system-funded and creates no cash. The only new money is
    // the founding grant of an NPP corporation spawned where a lane has no
    // operator in the country; bounded here by one grant per pickup.
    moneyDelta: Math.round(
      pickupCount * NPP_DEFAULT_STARTING_CAPITAL_ANCHOR * getEraNominalScale(preset)
    ),
    summary: `Hand ${pickupCount} plant pickup(s) from ${events.length} past exit(s) to NPP operators at ${Math.round(NPP_PICKUP_SHARE * 100)}% of lost capacity, drawn from unclaimed pool headroom`,
    notes: [
      "moneyDelta is a ₳ upper bound: a founding grant only where an NPP must be spawned; capacity itself moves without cash",
      ...notes,
    ],
    payload: { events } satisfies Payload,
  };
}

async function apply(db: Db, healPlan: HealPlan, ctx: HealContext): Promise<HealResult> {
  const { events } = healPlan.payload as Payload;
  const now = ctx.now;
  const eraUnitScale = await loadWorldEraUnitScale(db);
  const corps = db.collection<Corporation>("corporations");
  const sectors = db.collection<CorporateSector>("corporateSectors");
  const nppFilter = {
    ceoType: "npp" as const,
    countryOwnerId: { $exists: false },
    ownershipState: { $ne: "stateOwned" as const },
    suspended: { $ne: true },
  };
  const nppCorpIds = await corps.distinct("_id", nppFilter);
  const nppBefore = new Set(
    (await corps.distinct("_id", { ceoType: "npp" })).map((id) => id.toHexString())
  );
  const insertedSectors: string[] = [];
  const notes: string[] = [];
  let updated = 0;

  for (const event of events) {
    const owner = { _id: new ObjectId(event.ownerId) };
    const recipients = new Map<string, ObjectId>();
    for (const pickup of event.pickups) {
      const credited = await sectors.findOne({ nppPickupReceipts: pickup.key });
      if (credited) {
        recipients.set(credited.corporationId.toHexString(), credited.corporationId);
        continue;
      }
      const pool = await db
        .collection<PoolDoc>("unownedSectors")
        .findOne({ _id: new ObjectId(pickup.poolId) });
      const units = pool ? Math.min(pickup.units, headroomOf(pool)) : 0;
      if (!pool || !(units >= MIN_PICKUP_UNITS)) {
        notes.push(`${event.label}: ${pickup.stateId} pool shrank below the plan, skipped`);
        continue;
      }
      const sectorType = pickup.sectorType as CorporationType;
      const industryModel = pickup.industryModel as CorporateSector["industryModel"];
      const mediaDiscriminator = pickup.mediaDiscriminator as CorporateSector["mediaDiscriminator"];
      // A stand-in for the plant that left, in the pool's standard basis.
      const donor = {
        _id: new ObjectId(),
        corporationId: owner._id,
        countryId: pickup.countryId,
        stateId: pickup.stateId,
        sectorType,
        industryModel,
        mediaDiscriminator,
        revenue: 0,
        profitMargin: DEFAULT_PROFIT_MARGIN,
        workers: DEFAULT_SECTOR_STARTING_WORKERS,
        capitalStock: units,
      } as unknown as CorporateSector;
      const receiver = await chooseNppPickupReceiver(
        db,
        owner,
        donor,
        pickup.countryId,
        nppCorpIds,
        now
      );
      if (!receiver) {
        notes.push(`${event.label}: no NPP can operate in ${pickup.countryId}, skipped`);
        continue;
      }
      const carved = {
        capitalStock: units,
        ...seedPlantLedger(sectorType, units, industryModel, mediaDiscriminator),
        // System-funded: no paid basis, so a later exit never salvages cash
        // against capacity nobody bought.
        capacityBookAnchor: 0,
        buildQueue: [],
        mothballed: false,
        plantsStartTurn: null,
        legacyRevenueShadow: null,
      };
      const moved = await creditNppPickup(
        db,
        donor,
        { key: pickup.key, ...receiver },
        pickup.countryId,
        carved,
        now,
        1
      );
      if (!(moved > 0)) continue;
      if (!receiver.merge) insertedSectors.push(receiver.receiverSectorId.toHexString());
      recipients.set(receiver.receiverCorporationId.toHexString(), receiver.receiverCorporationId);
      const drawdown = unownedPoolDrawdown(
        {
          stateId: pickup.stateId,
          countryId: pickup.countryId,
          sectorType,
          industryModel,
          mediaDiscriminator,
        },
        units,
        now,
        eraUnitScale
      );
      if (drawdown) await db.collection("unownedSectors").updateOne({ _id: pool._id }, drawdown);
      updated += 1;
    }
    if (event.exitId && recipients.size > 0) {
      await db
        .collection<CorporationExit>("corporationExits")
        .updateOne(
          { _id: new ObjectId(event.exitId) },
          { $set: { successorIds: [...recipients.values()] } }
        );
    }
  }

  const spawned = (await corps.distinct("_id", { ceoType: "npp" }))
    .map((id) => id.toHexString())
    .filter((id) => !nppBefore.has(id));

  return {
    documentsUpdated: updated,
    documentsInserted: insertedSectors.length + spawned.length,
    notes,
    insertedIds: [
      { collection: "corporations", ids: spawned },
      { collection: "corporateSectors", ids: insertedSectors },
    ],
  };
}

async function verify(db: Db): Promise<VerifyResult> {
  const { events } = await buildPlan(db);
  return {
    ok: events.length === 0,
    remaining: events.length,
    notes: events.map((e) => `${e.label} still has capacity to hand off`),
  };
}

export const defect: Defect = {
  id: DEFECT_ID,
  title: "Plants that left their owner were deleted instead of handed to NPP operators",
  severity: "P1",
  codeFix: { mergedTo: "development" },
  seedFix: {
    status: "not-needed",
    note: "Runtime-only: the seed creates no exits or abandons. Live disposal now hands plants to NPP operators.",
  },
  envs: ["dev", "sandbox", "prod"],
  idempotent: true,
  mintsMoney: true,
  guards: ["turn-lock-free", "max-affected:50"],
  detect: (db) => detect(db),
  plan: (db) => plan(db),
  apply,
  verify: (db) => verify(db),
};
