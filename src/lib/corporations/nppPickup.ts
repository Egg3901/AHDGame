import { MongoServerError, ObjectId, type Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { DefenceContract } from "@/lib/db/types/defenceContract";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, getSeedCurrencyCode } from "@/lib/constants/currencies";
import type { CorporationType, OperatingSectorType } from "@/lib/constants/corporations";
import { getOperatingSectorType } from "@/lib/constants/sectorStrategies";
import { pickupMeasurementBasis, pickupProductionHistory } from "./nppPickup/rules";
import { capacityRescaleRatio } from "@/lib/constants/capacityEconomy";
import { createNppCorporationShell } from "@/lib/admin/spawnNppCorporation";
import { chooseNppCorporationName } from "@/lib/corporations/names/rules";
import { isPrivateEnterpriseBlocked } from "@/lib/economy/queries/privateEnterpriseGate";
import { loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { seedPlantLedger, splitWholePlantCount } from "@/lib/corporations/plantLedger";
import {
  carveSectorPlantFields,
  mergeSectorPlantFields,
  readSectorPlantFields,
} from "@/lib/corporations/sectorTransferCapex";
import { hasProtectedConstructionClaim } from "@/lib/corporations/securedConstructionProperty";
import { restoreSectorsToUnowned } from "@/lib/corporations/restoreSectorsToUnowned";
import {
  activeExtractionContractFilter,
  getExtractionContractsCollection,
} from "@/lib/db/collections/extractionContracts";
import { getCurrentTurn } from "@/lib/turn/currentTurn";

/**
 * Share of a leaving plant's built capacity an NPP operator takes over. The
 * rest returns to the unowned pool as headroom: real supply is lost there and
 * that demand opens for any builder, so a mass exit still makes room for
 * competitors without blanking the market.
 */
export const NPP_PICKUP_SHARE = 0.75;

const RECEIPT_CAP = 20;

type LeavingOwner = Pick<Corporation, "_id">;

export interface SectorDisposalResult {
  /** NPP corporations that received capacity. */
  recipientIds: ObjectId[];
  /** Capacity units handed to NPP operators, in each receiver's own strategy basis. */
  unitsPickedUp: number;
}

function laneFilter(
  sector: Pick<CorporateSector, "sectorType" | "industryModel" | "mediaDiscriminator">
) {
  return {
    sectorType: sector.sectorType,
    industryModel: sector.industryModel ?? null,
    mediaDiscriminator: sector.mediaDiscriminator ?? null,
  };
}

function laneOf(sector: CorporateSector): OperatingSectorType {
  return getOperatingSectorType(
    sector.sectorType as CorporationType,
    sector.industryModel,
    sector.mediaDiscriminator
  ) as OperatingSectorType;
}

function builtStock(sector: CorporateSector): number {
  return typeof sector.capitalStock === "number" && Number.isFinite(sector.capitalStock)
    ? Math.max(0, sector.capitalStock)
    : 0;
}

/**
 * Choose who takes a leaving plant: the NPP corporation with the smallest plant
 * of that lane in the same state (spreading the capacity keeps NPP market
 * shares even), else the NPP with the fewest plants of that lane in the state's
 * country, else a new NPP corporation in that country. Null when the country
 * permits no private enterprise.
 */
export async function chooseNppPickupReceiver(
  db: Db,
  owner: LeavingOwner,
  sector: CorporateSector,
  hostCountry: string,
  nppCorpIds: ObjectId[],
  now: Date
): Promise<Omit<NonNullable<CorporateSector["nppPickup"]>, "key"> | null> {
  const sectors = db.collection<CorporateSector>("corporateSectors");
  const candidates = nppCorpIds.filter((id) => !id.equals(owner._id));

  const inState = await sectors
    .find({ ...laneFilter(sector), stateId: sector.stateId, corporationId: { $in: candidates } })
    .project<Pick<CorporateSector, "_id" | "corporationId" | "capitalStock">>({
      _id: 1,
      corporationId: 1,
      capitalStock: 1,
    })
    .sort({ capitalStock: 1, _id: 1 })
    .limit(1)
    .next();
  if (inState) {
    return {
      receiverCorporationId: inState.corporationId,
      receiverSectorId: inState._id,
      merge: true,
    };
  }

  const [inCountry] = await sectors
    .aggregate<{ _id: ObjectId; rows: number }>([
      {
        $match: {
          ...laneFilter(sector),
          countryId: hostCountry,
          corporationId: { $in: candidates },
        },
      },
      { $group: { _id: "$corporationId", rows: { $sum: 1 } } },
      { $sort: { rows: 1, _id: 1 } },
      { $limit: 1 },
    ])
    .toArray();
  if (inCountry) {
    return { receiverCorporationId: inCountry._id, receiverSectorId: new ObjectId(), merge: false };
  }

  if (await isPrivateEnterpriseBlocked(db, hostCountry as CountryId)) return null;
  const preset = await loadWorldPreset(db);
  const currencyCode =
    getSeedCurrencyCode(hostCountry as CountryId, preset) ??
    COUNTRY_CURRENCY_MAP[hostCountry as keyof typeof COUNTRY_CURRENCY_MAP];
  if (!currencyCode) return null;
  const lane = laneOf(sector);
  const existingNames = (
    await db
      .collection<Corporation>("corporations")
      .find({ countryId: hostCountry as CountryId })
      .project<{ name: string }>({ name: 1 })
      .toArray()
  ).map((c) => c.name);
  const shell = await createNppCorporationShell(db, {
    name: chooseNppCorporationName(hostCountry, lane, existingNames, Math.random),
    type: sector.sectorType as CorporationType,
    industryModel: (sector.industryModel ?? null) as CorporateSector["industryModel"] & null,
    mediaDiscriminator: (sector.mediaDiscriminator ??
      null) as CorporateSector["mediaDiscriminator"] & null,
    countryId: hostCountry as CountryId,
    headquartersState: sector.stateId,
    currencyCode,
    preset,
    foundedAtTurn: await getCurrentTurn(db),
    now,
  });
  nppCorpIds.push(shell.corpId);
  return { receiverCorporationId: shell.corpId, receiverSectorId: new ObjectId(), merge: false };
}

/** Credit the carved capacity to the receiver once per pickup key. */
export async function creditNppPickup(
  db: Db,
  sector: CorporateSector,
  pickup: NonNullable<CorporateSector["nppPickup"]>,
  hostCountry: string,
  carved: ReturnType<typeof carveSectorPlantFields>,
  now: Date,
  /** Share of the donor's workers and nameplate that moves with the capacity. */
  share: number = NPP_PICKUP_SHARE
): Promise<number> {
  const sectors = db.collection<CorporateSector>("corporateSectors");
  const workers = Math.round((sector.workers ?? 0) * share);
  const capacityShare = builtStock(sector) > 0 ? carved.capitalStock / builtStock(sector) : 0;

  if (pickup.merge) {
    const receiver = await sectors.findOne({ _id: pickup.receiverSectorId });
    if (!receiver) throw new Error("NPP pickup receiver sector disappeared");
    if (receiver.nppPickupReceipts?.includes(pickup.key)) return 0;
    // Capacity units are strategy-specific; restate the donor's in the
    // receiver's basis before folding them in (same rule as a sector move).
    const ratio = capacityRescaleRatio(
      sector.sectorType as CorporationType,
      sector.strategyId,
      receiver.strategyId,
      sector.industryModel,
      sector.mediaDiscriminator
    );
    const incomingStock = carved.capitalStock * ratio;
    const merged = mergeSectorPlantFields(readSectorPlantFields(receiver), {
      ...readSectorPlantFields(sector),
      ...carved,
      capitalStock: incomingStock,
      ...(carved.operatingCapacityUnits != null
        ? { operatingCapacityUnits: carved.operatingCapacityUnits * ratio }
        : {}),
      buildQueue: [],
    });
    const history = pickupProductionHistory({
      receiver,
      donor: sector,
      capacityShare,
      unitRatio: (ratio * pickupMeasurementBasis(receiver)) / pickupMeasurementBasis(sector),
    });
    const result = await sectors.updateOne(
      { _id: receiver._id, nppPickupReceipts: { $ne: pickup.key } },
      {
        $set: {
          ...merged,
          ...history,
          ...(receiver.productOutputCapacityUnits != null
            ? { productOutputCapacityUnits: merged.operatingCapacityUnits ?? merged.capitalStock }
            : {}),
          updatedAt: now,
        },
        $inc: { workers },
        $push: { nppPickupReceipts: { $each: [pickup.key], $slice: -RECEIPT_CAP } },
      }
    );
    return result.modifiedCount === 1 ? incomingStock : 0;
  }

  try {
    await sectors.insertOne({
      _id: pickup.receiverSectorId,
      corporationId: pickup.receiverCorporationId,
      countryId: hostCountry as CountryId,
      stateId: sector.stateId,
      sectorType: sector.sectorType,
      ...(sector.industryModel ? { industryModel: sector.industryModel } : {}),
      ...(sector.mediaDiscriminator ? { mediaDiscriminator: sector.mediaDiscriminator } : {}),
      targetGrowthRate: 0,
      currentGrowthRate: 0,
      currentGrowthCost: 0,
      // PLANTS-GATED: pickups only run under plants (`disposeLeavingSectors`
      // filters on `plantsEnabled`), so this host-currency nameplate is the
      // donor's scaled with the carved capacity and is restated from
      // `capitalStock` on the next turn.
      revenue: Math.round((sector.revenue ?? 0) * share),
      profitMargin: sector.profitMargin,
      workers,
      ...(sector.strategyId ? { strategyId: sector.strategyId } : {}),
      ...carved,
      ...pickupProductionHistory({
        donor: sector,
        capacityShare,
        unitRatio: 1 / pickupMeasurementBasis(sector),
      }),
      buildQueue: [],
      nppPickupReceipts: [pickup.key],
      createdAt: now,
      updatedAt: now,
    } as CorporateSector);
    return carved.capitalStock;
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) return 0;
    throw error;
  }
}

/**
 * Dispose of sectors leaving their owner (abandon, dissolution, restructure
 * liquidation).
 *
 * Before this, every leaving plant returned all of its capacity to the unowned
 * pool. Headroom is bookkeeping, not supply: the plant simply stopped and the
 * market lost that output until someone ordered a build and waited out its
 * window, so one large exit spiked prices across every market it served. Now
 * an NPP operator takes over {@link NPP_PICKUP_SHARE} of each plant's BUILT
 * capacity, system-funded (no cash moves, the leaving owner's refund and payout
 * are unchanged). The remaining share and every undelivered build order return
 * to the pool exactly as before.
 *
 * Resumable: the receiver is recorded on the leaving row before any capacity
 * moves, credits are guarded by a per-pickup receipt, and the pool restore is
 * itself idempotent.
 */
export async function disposeLeavingSectors(
  db: Db,
  owner: LeavingOwner,
  sectors: CorporateSector[],
  now: Date
): Promise<SectorDisposalResult> {
  const result: SectorDisposalResult = { recipientIds: [], unitsPickedUp: 0 };
  if (sectors.length === 0) return result;

  const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");
  const eligible = plantsEnabled
    ? sectors.filter((s) => builtStock(s) > 0 && !hasProtectedConstructionClaim(s))
    : [];
  const eligibleIds = new Set(eligible.map((s) => s._id.toHexString()));
  const remainders: CorporateSector[] = sectors.filter(
    (s) => !eligibleIds.has(s._id.toHexString())
  );

  if (eligible.length > 0) {
    const nppCorpIds = await db.collection<Corporation>("corporations").distinct("_id", {
      ceoType: "npp",
      countryOwnerId: { $exists: false },
      ownershipState: { $ne: "stateOwned" },
      suspended: { $ne: true },
    });
    const hostByState = new Map(
      (
        await db
          .collection<{ _id: string; countryId: string }>("states")
          .find({ _id: { $in: [...new Set(eligible.map((s) => s.stateId))] } })
          .project<{ _id: string; countryId: string }>({ countryId: 1 })
          .toArray()
      ).map((state) => [state._id, state.countryId])
    );
    const recipients = new Map<string, ObjectId>();
    const handedOff: Array<{
      sector: CorporateSector;
      pickup: NonNullable<CorporateSector["nppPickup"]>;
    }> = [];

    // 1. Choose a receiver for every row not already marked by an earlier try.
    const proposals = new Map<string, NonNullable<CorporateSector["nppPickup"]>>();
    for (const sector of eligible) {
      if (sector.nppPickup) continue;
      const hostCountry = hostByState.get(sector.stateId) ?? sector.countryId;
      const receiver = await chooseNppPickupReceiver(
        db,
        owner,
        sector,
        hostCountry,
        nppCorpIds,
        now
      );
      if (receiver) {
        proposals.set(sector._id.toHexString(), {
          key: `npp-pickup:${sector._id.toHexString()}`,
          ...receiver,
        });
      }
    }

    // 2. Commit the receivers before any capacity moves, then read back what
    //    won (a concurrent retry may have marked a row first).
    if (proposals.size > 0) {
      await db.collection<CorporateSector>("corporateSectors").bulkWrite(
        [...proposals].map(([id, proposed]) => ({
          updateOne: {
            filter: { _id: new ObjectId(id), nppPickup: { $exists: false } },
            update: { $set: { nppPickup: proposed } },
          },
        })),
        { ordered: false }
      );
    }
    const storedMarkers = new Map(
      (
        await db
          .collection<CorporateSector>("corporateSectors")
          .find({ _id: { $in: eligible.map((s) => s._id) } })
          .project<Pick<CorporateSector, "_id" | "nppPickup">>({ nppPickup: 1 })
          .toArray()
      ).map((row) => [row._id.toHexString(), row.nppPickup])
    );

    // 3. Credit each receiver and queue the kept share for the pool.
    for (const sector of eligible) {
      const id = sector._id.toHexString();
      const pickup = storedMarkers.get(id) ?? sector.nppPickup ?? proposals.get(id);
      if (!pickup) {
        remainders.push(sector);
        continue;
      }
      const hostCountry = hostByState.get(sector.stateId) ?? sector.countryId;
      const fields = readSectorPlantFields(sector);
      const opening = seedPlantLedger(
        sector.sectorType as CorporationType,
        sector.capitalStock,
        sector.industryModel,
        sector.mediaDiscriminator
      ).plantCount;
      const split = splitWholePlantCount(opening, NPP_PICKUP_SHARE);
      const carved = carveSectorPlantFields(fields, NPP_PICKUP_SHARE, split.carved);
      const kept = carveSectorPlantFields(fields, 1 - NPP_PICKUP_SHARE, split.kept);

      result.unitsPickedUp += await creditNppPickup(db, sector, pickup, hostCountry, carved, now);
      recipients.set(pickup.receiverCorporationId.toHexString(), pickup.receiverCorporationId);
      handedOff.push({ sector, pickup });
      // The pool gets the kept share plus every undelivered order, in full.
      remainders.push({ ...sector, capitalStock: kept.capitalStock });
    }

    await repointContracts(db, owner._id, handedOff, now);
    result.recipientIds = [...recipients.values()];
  }

  if (remainders.length > 0) await restoreSectorsToUnowned(db, remainders, now);
  return result;
}

/**
 * Contracts that follow the plant. A defence contract names its plant, so it
 * moves to the receiving row when the receiver can legally hold it (supplier and
 * buyer share a country). An extraction concession belongs to the corporation:
 * it moves to the receiver only when the leaving owner has no extraction plant
 * left in that state, so a corporation that still operates there keeps it.
 */
async function repointContracts(
  db: Db,
  ownerId: ObjectId,
  handedOff: Array<{ sector: CorporateSector; pickup: NonNullable<CorporateSector["nppPickup"]> }>,
  now: Date
): Promise<void> {
  if (handedOff.length === 0) return;
  const receiverCountry = new Map(
    (
      await db
        .collection<Corporation>("corporations")
        .find({ _id: { $in: handedOff.map((h) => h.pickup.receiverCorporationId) } })
        .project<Pick<Corporation, "_id" | "countryId">>({ countryId: 1 })
        .toArray()
    ).map((c) => [c._id.toHexString(), c.countryId])
  );

  const defenceOps = handedOff.map(({ sector, pickup }) => ({
    updateMany: {
      filter: {
        corporationId: ownerId,
        sectorId: sector._id,
        countryId: receiverCountry.get(pickup.receiverCorporationId.toHexString()) as CountryId,
      },
      update: {
        $set: { corporationId: pickup.receiverCorporationId, sectorId: pickup.receiverSectorId },
      },
    },
  }));
  await db.collection<DefenceContract>("defenceContracts").bulkWrite(defenceOps, {
    ordered: false,
  });

  const extractionReceiverByState = new Map<string, ObjectId>();
  for (const { sector, pickup } of handedOff) {
    if (sector.sectorType === "extraction" && !extractionReceiverByState.has(sector.stateId)) {
      extractionReceiverByState.set(sector.stateId, pickup.receiverCorporationId);
    }
  }
  if (extractionReceiverByState.size === 0) return;
  const stillOperating = new Set(
    await db.collection<CorporateSector>("corporateSectors").distinct("stateId", {
      corporationId: ownerId,
      stateId: { $in: [...extractionReceiverByState.keys()] },
      sectorType: "extraction",
      _id: { $nin: handedOff.map((h) => h.sector._id) },
    })
  );
  const contractOps = [...extractionReceiverByState]
    .filter(([stateId]) => !stillOperating.has(stateId))
    .map(([stateId, receiverId]) => ({
      updateMany: {
        filter: { corporationId: ownerId, stateId, ...activeExtractionContractFilter() },
        update: { $set: { corporationId: receiverId, updatedAt: now } },
      },
    }));
  if (contractOps.length > 0) {
    await (await getExtractionContractsCollection(db)).bulkWrite(contractOps, { ordered: false });
  }
}
