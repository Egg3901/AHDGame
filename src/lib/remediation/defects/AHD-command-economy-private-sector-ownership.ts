import { ObjectId, type Db, type UpdateFilter } from "mongodb";
import type {
  Corporation,
  CorporateSector,
  FederalBudget,
  NationalizationAuction,
} from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import {
  anchorToCorpLiquidCapital,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
} from "@/lib/currency/corporationCapital";
import { writeGovBudgetLocal } from "@/lib/currency/govBudgetFields";
import {
  mergeSectorPlantFields,
  readSectorPlantFields,
} from "@/lib/corporations/sectorTransferCapex";
import type { SectorBuildOrder } from "@/lib/db/types/corporation";
import type {
  Defect,
  DetectResult,
  HealContext,
  HealPlan,
  HealResult,
  TouchedDocs,
  VerifyResult,
} from "../types";

export const DEFECT_ID = "AHD-command-economy-private-sector-ownership";

const DD_SOURCE_CORPORATION_ID = "6a88c39d1b9523d08f751cad";
const DD_TARGET_CORPORATION_ID = "700000000000000000000600";

interface KnownCase {
  sectorId: string;
  sourceCorporationId: string;
  countryId: "DD" | "RU" | "UKR";
  stateId: string;
  sectorType: "financial" | "technology" | "media";
  compensation: "none" | "book";
}

const KNOWN_CASES: readonly KnownCase[] = [
  {
    sectorId: "6a88c39d1b9523d08f751cb2",
    sourceCorporationId: DD_SOURCE_CORPORATION_ID,
    countryId: "DD",
    stateId: "BB",
    sectorType: "financial",
    compensation: "none",
  },
  {
    sectorId: "6a88c39d1b9523d08f751cb3",
    sourceCorporationId: DD_SOURCE_CORPORATION_ID,
    countryId: "DD",
    stateId: "BEO",
    sectorType: "financial",
    compensation: "none",
  },
  {
    sectorId: "6a88c39d1b9523d08f751cb1",
    sourceCorporationId: DD_SOURCE_CORPORATION_ID,
    countryId: "DD",
    stateId: "MV",
    sectorType: "financial",
    compensation: "none",
  },
  {
    sectorId: "6a88c39d1b9523d08f751cb0",
    sourceCorporationId: DD_SOURCE_CORPORATION_ID,
    countryId: "DD",
    stateId: "SN",
    sectorType: "financial",
    compensation: "none",
  },
  {
    sectorId: "6a88c39d1b9523d08f751caf",
    sourceCorporationId: DD_SOURCE_CORPORATION_ID,
    countryId: "DD",
    stateId: "ST",
    sectorType: "financial",
    compensation: "none",
  },
  {
    sectorId: "6a88c39d1b9523d08f751cae",
    sourceCorporationId: DD_SOURCE_CORPORATION_ID,
    countryId: "DD",
    stateId: "TH",
    sectorType: "financial",
    compensation: "none",
  },
  {
    sectorId: "6a7e4868f9ff4f6556c6bd4b",
    sourceCorporationId: "6a7e4868f9ff4f6556c6bd4a",
    countryId: "RU",
    stateId: "VOL",
    sectorType: "technology",
    compensation: "book",
  },
  {
    sectorId: "6a7cb601889964a8cbbe34fa",
    sourceCorporationId: "6a79fd1371e5d11a9601debc",
    countryId: "UKR",
    stateId: "UKR_KYI",
    sectorType: "media",
    compensation: "book",
  },
] as const;

export const KNOWN_SECTOR_IDS = KNOWN_CASES.map((row) => row.sectorId);

type BookInput = Pick<
  CorporateSector,
  "sectorType" | "capacityBookAnchor" | "constructionInProgressAnchor" | "buildQueue"
>;

function queuePaidAnchor(queue: readonly SectorBuildOrder[] | null | undefined): number {
  return (queue ?? []).reduce(
    (sum, order) =>
      sum +
      (typeof order.costPaidAnchor === "number" &&
      Number.isFinite(order.costPaidAnchor) &&
      order.costPaidAnchor > 0
        ? order.costPaidAnchor
        : 0),
    0
  );
}

function normalizedCip(
  sector: Pick<CorporateSector, "constructionInProgressAnchor" | "buildQueue">
) {
  const recorded =
    typeof sector.constructionInProgressAnchor === "number" &&
    Number.isFinite(sector.constructionInProgressAnchor) &&
    sector.constructionInProgressAnchor > 0
      ? sector.constructionInProgressAnchor
      : 0;
  return Math.max(recorded, queuePaidAnchor(sector.buildQueue));
}

/** Paid plant basis plus every still-live paid build order, all in anchor units. */
export function administrativeBookValueAnchor(sector: BookInput): number {
  const capacity =
    typeof sector.capacityBookAnchor === "number" &&
    Number.isFinite(sector.capacityBookAnchor) &&
    sector.capacityBookAnchor > 0
      ? sector.capacityBookAnchor
      : 0;
  return capacity + normalizedCip(sector);
}

const additiveTopLevelFields = [
  "revenue",
  "realizedRevenue",
  "workers",
  "currentGrowthCost",
  "laborCost",
  "producedUnits",
  "soldUnits",
] as const;

const additivePnlFields = [
  "revenue",
  "inventoryRevenue",
  "inventoryCarry",
  "inputs",
  "labour",
  "upkeep",
  "compliance",
  "otherOpex",
  "financialLegs",
  "policyCredit",
  "operatingCost",
  "totalCost",
  "profit",
] as const;

type AdministrativeSectorInput = Partial<CorporateSector> & Pick<CorporateSector, "sectorType">;

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function mergePlantsPnl(
  survivor: AdministrativeSectorInput,
  source: AdministrativeSectorInput
): CorporateSector["plantsPnl"] | undefined {
  if (!survivor.plantsPnl && !source.plantsPnl) return undefined;
  const merged: Record<string, number> = {};
  for (const field of additivePnlFields) {
    merged[field] = finite(survivor.plantsPnl?.[field]) + finite(source.plantsPnl?.[field]);
  }
  merged.turn = Math.max(finite(survivor.plantsPnl?.turn), finite(source.plantsPnl?.turn));
  merged.policyPp = merged.revenue > 0 ? (merged.policyCredit / merged.revenue) * 100 : 0;
  return merged as CorporateSector["plantsPnl"];
}

export interface AdministrativeSectorMergeUpdate {
  $inc: Record<string, number>;
  $set: Record<string, unknown>;
}

/** Full-value administrative merge. This is not a gameplay nationalization. */
export function buildAdministrativeSectorMerge(
  survivor: AdministrativeSectorInput,
  source: AdministrativeSectorInput,
  sourceSectorId: ObjectId,
  now: Date,
  runId: string
): AdministrativeSectorMergeUpdate {
  const survivorPlant = {
    ...readSectorPlantFields(survivor),
    constructionInProgressAnchor: normalizedCip(survivor),
  };
  const sourcePlant = {
    ...readSectorPlantFields(source),
    constructionInProgressAnchor: normalizedCip(source),
  };
  const mergedPlant = mergeSectorPlantFields(survivorPlant, sourcePlant);
  const mergedPnl = mergePlantsPnl(survivor, source);
  const markerPath = `remediation.${DEFECT_ID}.${sourceSectorId.toString()}`;
  const inc: Record<string, number> = {};
  for (const field of additiveTopLevelFields) inc[field] = finite(source[field]);

  const realized = finite(survivor.realizedRevenue) + finite(source.realizedRevenue);
  const operatingCost = finite(mergedPnl?.operatingCost);
  const effectiveProfitMargin =
    realized > 0 ? Math.max(0, Math.min(100, 100 * (1 - operatingCost / realized))) : 0;

  return {
    $inc: inc,
    $set: {
      ...mergedPlant,
      ...(mergedPnl ? { plantsPnl: mergedPnl } : {}),
      effectiveProfitMargin,
      updatedAt: now,
      [markerPath]: { runId, mergedAt: now },
    },
  };
}

interface CompensationPlan {
  sectorId: string;
  donorCorporationId: string;
  budgetId: string;
  countryId: "RU" | "UKR";
  anchorAmount: number;
  donorLocalAmount: number;
  treasuryLocalAmount: number;
}

interface TransferPlan {
  sourceSectorId: string;
  sourceCorporationId: string;
  targetCorporationId: string;
  survivorSectorId: string;
}

interface AuctionRefundPlan {
  auctionId: string;
  holderType: "character" | "corporation";
  holderId: string;
  amount: number;
  currencyCode: CurrencyCode;
  balancePath: string;
}

interface Survey {
  affected: number;
  invalidIds: string[];
  unknownIds: string[];
  transfers: TransferPlan[];
  compensation: CompensationPlan[];
  auctionId: string | null;
  auctionRefunds: AuctionRefundPlan[];
  currentTurn: number;
  ddCashTransfer: number;
  ddSourceExists: boolean;
  touched: TouchedDocs[];
  notes: string[];
}

function hasRepairMarker(doc: unknown, key: string) {
  if (!doc || typeof doc !== "object") return false;
  const remediation = (doc as { remediation?: Record<string, unknown> }).remediation;
  const root = remediation?.[DEFECT_ID];
  return Boolean(root && typeof root === "object" && (root as Record<string, unknown>)[key]);
}

function dedupeTouched(rows: TouchedDocs[]): TouchedDocs[] {
  const grouped = new Map<string, Set<string>>();
  for (const row of rows) {
    const ids = grouped.get(row.collection) ?? new Set<string>();
    row.ids.forEach((id) => ids.add(id));
    grouped.set(row.collection, ids);
  }
  return [...grouped].map(([collection, ids]) => ({ collection, ids: [...ids].sort() }));
}

async function findTargetCorporation(db: Db, row: KnownCase): Promise<Corporation | null> {
  const corps = db.collection<Corporation>("corporations");
  return (
    (await corps.findOne({
      countryOwnerId: row.countryId,
      $or: [{ assignedSectorTypes: row.sectorType }, { "soe.sector": row.sectorType }],
    })) ??
    (await corps.findOne({
      countryOwnerId: row.countryId,
      isPrimaryNationalCorporation: true,
    }))
  );
}

async function survey(db: Db): Promise<Survey> {
  const sectorIds = KNOWN_CASES.map((row) => new ObjectId(row.sectorId));
  const sourceCorpIds = [...new Set(KNOWN_CASES.map((row) => row.sourceCorporationId))].map(
    (id) => new ObjectId(id)
  );
  const [sectors, sourceCorps, fxByCurrency, budgets, gameState, openAuctions] = await Promise.all([
    db
      .collection<CorporateSector>("corporateSectors")
      .find({ _id: { $in: sectorIds } })
      .toArray(),
    db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: sourceCorpIds } })
      .toArray(),
    loadFxRatesByCurrency(db),
    db
      .collection<FederalBudget>("federalBudget")
      .find({ countryId: { $in: ["RU", "UKR"] } })
      .toArray(),
    db.collection<{ _id: string; currentTurn?: number }>("gameState").findOne({ _id: "current" }),
    db
      .collection<NationalizationAuction>("nationalizationAuctions")
      .find({ corporationId: new ObjectId(DD_SOURCE_CORPORATION_ID), status: "open" })
      .toArray(),
  ]);
  const sectorById = new Map(sectors.map((row) => [row._id.toString(), row]));
  const corpById = new Map(sourceCorps.map((row) => [row._id.toString(), row]));
  const budgetByCountry = new Map(budgets.map((row) => [row.countryId, row]));
  const transfers: TransferPlan[] = [];
  const compensation: CompensationPlan[] = [];
  const auctionRefunds: AuctionRefundPlan[] = [];
  const invalidIds: string[] = [];
  const touched: TouchedDocs[] = [];
  const affectedKeys = new Set<string>();
  const notes: string[] = [];

  for (const row of KNOWN_CASES) {
    const sector = sectorById.get(row.sectorId);
    const source = corpById.get(row.sourceCorporationId) ?? null;
    const target = await findTargetCorporation(db, row);
    if (!target)
      throw new Error(`no state enterprise target for ${row.countryId}/${row.sectorType}`);

    if (sector && sector.corporationId.toString() === row.sourceCorporationId) {
      invalidIds.push(row.sectorId);
      affectedKeys.add(row.sectorId);
      const survivor = await db.collection<CorporateSector>("corporateSectors").findOne({
        corporationId: target._id,
        stateId: row.stateId,
        sectorType: row.sectorType,
      });
      if (!survivor) {
        throw new Error(`no merge survivor for ${row.countryId}/${row.stateId}/${row.sectorType}`);
      }
      transfers.push({
        sourceSectorId: row.sectorId,
        sourceCorporationId: row.sourceCorporationId,
        targetCorporationId: target._id.toString(),
        survivorSectorId: survivor._id.toString(),
      });
      touched.push(
        { collection: "corporateSectors", ids: [row.sectorId, survivor._id.toString()] },
        { collection: "corporations", ids: [target._id.toString()] }
      );
    }

    if (row.compensation === "book") {
      if (row.countryId === "DD") throw new Error("DD state-owned sectors cannot be compensated");
      if (!source) throw new Error(`compensation donor ${row.sourceCorporationId} is missing`);
      const budget = budgetByCountry.get(row.countryId);
      if (!budget) throw new Error(`federal budget for ${row.countryId} is missing`);
      const markerKey = `compensation:${row.sectorId}`;
      const donorDone = hasRepairMarker(source, markerKey);
      const budgetDone = hasRepairMarker(budget, markerKey);
      if (!donorDone || !budgetDone) {
        if (!sector) {
          throw new Error(`sector ${row.sectorId} is gone before its compensation completed`);
        }
        affectedKeys.add(row.sectorId);
        const anchorAmount = administrativeBookValueAnchor(sector);
        const donorRate = fxRateForCorpFromMap(source, fxByCurrency);
        const treasuryCurrency = COUNTRY_CURRENCY_MAP[row.countryId] as CurrencyCode;
        const treasuryRate = fxByCurrency.get(treasuryCurrency) ?? 1;
        compensation.push({
          sectorId: row.sectorId,
          donorCorporationId: source._id.toString(),
          budgetId: String(budget._id),
          countryId: row.countryId,
          anchorAmount,
          donorLocalAmount: Math.round(anchorToCorpLiquidCapital(anchorAmount, source, donorRate)),
          treasuryLocalAmount: Math.round(
            writeGovBudgetLocal(anchorAmount, treasuryCurrency, treasuryRate)
          ),
        });
        touched.push(
          { collection: "corporations", ids: [source._id.toString()] },
          { collection: "federalBudget", ids: [String(budget._id)] }
        );
      }
    }
  }

  const ddSource = corpById.get(DD_SOURCE_CORPORATION_ID) ?? null;
  const ddTarget = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: new ObjectId(DD_TARGET_CORPORATION_ID) });
  if (!ddTarget) throw new Error("East German Financial Enterprise is missing");
  const ddCashDone = hasRepairMarker(ddTarget, "dd-shell-cash");
  const ddCashTransfer = ddSource && !ddCashDone ? Math.max(0, finite(ddSource.liquidCapital)) : 0;
  if (ddSource) {
    affectedKeys.add(KNOWN_CASES[0].sectorId);
    touched.push({
      collection: "corporations",
      ids: [DD_SOURCE_CORPORATION_ID, DD_TARGET_CORPORATION_ID],
    });
  }

  if (openAuctions.length > 1) {
    throw new Error(`East German shell has ${openAuctions.length} open auctions`);
  }
  const auction = openAuctions[0] ?? null;
  if (auction) {
    affectedKeys.add(KNOWN_CASES[0].sectorId);
    touched.push({ collection: "nationalizationAuctions", ids: [auction._id.toString()] });
    for (const bid of auction.bids) {
      const holderType = bid.characterId ? "character" : "corporation";
      const holderId = (bid.characterId ?? bid.corporationId)?.toString();
      if (!holderId)
        throw new Error(`auction ${auction._id.toString()} has a bid without a holder`);
      const collection = holderType === "character" ? "characters" : "corporations";
      const holder = await db.collection(collection).findOne({ _id: new ObjectId(holderId) });
      if (!holder) throw new Error(`${holderType} auction bidder ${holderId} is missing`);
      const markerKey = `auction-refund:${auction._id.toString()}`;
      if (!hasRepairMarker(holder, markerKey)) {
        const balancePath =
          holderType === "corporation"
            ? "liquidCapital"
            : `currencyBalances.personal.${bid.escrowCurrency}`;
        auctionRefunds.push({
          auctionId: auction._id.toString(),
          holderType,
          holderId,
          amount: bid.amount,
          currencyCode: bid.escrowCurrency,
          balancePath,
        });
        touched.push({ collection, ids: [holderId] });
      }
    }
  }

  const knownSet = new Set(KNOWN_SECTOR_IDS);
  const unknownIds = invalidIds.filter((id) => !knownSet.has(id));
  if (unknownIds.length > 0) notes.push(`unknown invalid sectors: ${unknownIds.join(", ")}`);
  notes.push(
    `${transfers.length} sector rows will merge into existing state-enterprise rows`,
    `${compensation.length} private owners require current paid-book compensation`,
    `${auctionRefunds.length} auction escrow refund(s) must be returned`,
    `East German shell cash transfer: DDM ${ddCashTransfer.toFixed(2)}`
  );

  return {
    affected: affectedKeys.size,
    invalidIds,
    unknownIds,
    transfers,
    compensation,
    auctionId: auction?._id.toString() ?? null,
    auctionRefunds,
    currentTurn: finite(gameState?.currentTurn),
    ddCashTransfer,
    ddSourceExists: Boolean(ddSource),
    touched: dedupeTouched(touched),
    notes,
  };
}

async function detect(db: Db): Promise<DetectResult> {
  const result = await survey(db);
  return {
    affected: result.affected,
    sample: result.invalidIds.slice(0, 10),
    notes: result.notes,
  };
}

async function plan(db: Db): Promise<HealPlan> {
  const result = await survey(db);
  if (result.unknownIds.length > 0) {
    throw new Error(`refusing unreviewed command-economy sectors: ${result.unknownIds.join(", ")}`);
  }
  const totalCompensation = result.compensation.reduce((sum, row) => sum + row.anchorAmount, 0);
  if (result.affected === 0) {
    return {
      affected: 0,
      touched: [],
      moneyDelta: 0,
      summary: `${DEFECT_ID}: nothing to heal`,
      payload: result,
    };
  }
  return {
    affected: result.affected,
    touched: result.touched,
    moneyDelta: 0,
    summary:
      `${DEFECT_ID}: merge ${result.transfers.length} illegal sector rows at full value, ` +
      `pay ${totalCompensation.toFixed(2)} anchor in current-book compensation, and absorb the East German state-owned shell`,
    notes: [
      "No revenue history is rewritten and no prior operating income is clawed back.",
      "The two private donors receive paid book only, with no premium.",
      "The East German shell is wholly state-owned, so its sectors and cash move without compensation.",
      ...result.notes,
    ],
    payload: result,
  };
}

async function applyCompensation(db: Db, row: CompensationPlan, ctx: HealContext): Promise<number> {
  const markerKey = `compensation:${row.sectorId}`;
  const markerPath = `remediation.${DEFECT_ID}.${markerKey}`;
  const marker = {
    runId: ctx.runId ?? null,
    anchorAmount: row.anchorAmount,
    donorLocalAmount: row.donorLocalAmount,
    treasuryLocalAmount: row.treasuryLocalAmount,
    appliedAt: ctx.now,
  };
  let modified = 0;
  const budget = await db.collection<FederalBudget>("federalBudget").updateOne(
    { _id: row.budgetId, [markerPath]: { $exists: false } },
    {
      $inc: { treasuryBalance: -row.treasuryLocalAmount },
      $set: { [markerPath]: marker, updatedAt: ctx.now },
    }
  );
  modified += budget.modifiedCount;
  const donor = await db.collection<Corporation>("corporations").updateOne(
    { _id: new ObjectId(row.donorCorporationId), [markerPath]: { $exists: false } },
    {
      $inc: { liquidCapital: row.donorLocalAmount },
      $set: { [markerPath]: marker, updatedAt: ctx.now },
    }
  );
  modified += donor.modifiedCount;
  return modified;
}

async function applySectorMerge(
  db: Db,
  row: TransferPlan,
  ctx: HealContext
): Promise<{ updated: number; deleted: number }> {
  if (!ctx.runId) throw new Error("command-economy ownership heal requires a run id");
  const sectors = db.collection<CorporateSector>("corporateSectors");
  const [source, survivor] = await Promise.all([
    sectors.findOne({
      _id: new ObjectId(row.sourceSectorId),
      corporationId: new ObjectId(row.sourceCorporationId),
    }),
    sectors.findOne({
      _id: new ObjectId(row.survivorSectorId),
      corporationId: new ObjectId(row.targetCorporationId),
    }),
  ]);
  const markerPath = `remediation.${DEFECT_ID}.${row.sourceSectorId}`;
  if (!source) {
    const already = await sectors.findOne({
      _id: new ObjectId(row.survivorSectorId),
      [markerPath]: { $exists: true },
    });
    if (already) return { updated: 0, deleted: 0 };
    throw new Error(`source sector ${row.sourceSectorId} disappeared before merge`);
  }
  if (!survivor) throw new Error(`survivor sector ${row.survivorSectorId} is missing`);
  const update = buildAdministrativeSectorMerge(
    survivor,
    source,
    source._id,
    ctx.now,
    ctx.runId
  ) as UpdateFilter<CorporateSector>;
  const merged = await sectors.updateOne(
    { _id: survivor._id, [markerPath]: { $exists: false } },
    update
  );
  if (merged.modifiedCount !== 1) {
    const already = await sectors.findOne({ _id: survivor._id, [markerPath]: { $exists: true } });
    if (!already) throw new Error(`survivor sector ${row.survivorSectorId} rejected merge`);
  }
  const removed = await sectors.deleteOne({
    _id: source._id,
    corporationId: new ObjectId(row.sourceCorporationId),
  });
  return { updated: merged.modifiedCount, deleted: removed.deletedCount };
}

async function applyAuctionRefund(
  db: Db,
  row: AuctionRefundPlan,
  ctx: HealContext
): Promise<number> {
  const collection = row.holderType === "character" ? "characters" : "corporations";
  const markerPath = `remediation.${DEFECT_ID}.auction-refund:${row.auctionId}`;
  const refund = await db.collection(collection).updateOne(
    { _id: new ObjectId(row.holderId), [markerPath]: { $exists: false } },
    {
      $inc: { [row.balancePath]: row.amount },
      $set: {
        [markerPath]: {
          runId: ctx.runId ?? null,
          amount: row.amount,
          currencyCode: row.currencyCode,
          refundedAt: ctx.now,
        },
        updatedAt: ctx.now,
      },
    }
  );
  return refund.modifiedCount;
}

async function apply(db: Db, healPlan: HealPlan, ctx: HealContext): Promise<HealResult> {
  const result = healPlan.payload as Survey | undefined;
  if (!result || result.affected === 0) {
    return { documentsScanned: 0, documentsUpdated: 0, documentsDeleted: 0 };
  }
  if (!ctx.runId) throw new Error("command-economy ownership heal requires a run id");
  let updated = 0;
  let deleted = 0;

  for (const row of result.compensation) updated += await applyCompensation(db, row, ctx);

  for (const row of result.auctionRefunds) updated += await applyAuctionRefund(db, row, ctx);
  if (result.auctionId) {
    const auction = await db
      .collection<NationalizationAuction>("nationalizationAuctions")
      .updateOne(
        { _id: new ObjectId(result.auctionId), status: "open" },
        {
          $set: {
            status: "cancelled",
            resolvedAtTurn: result.currentTurn,
            updatedAt: ctx.now,
            [`remediation.${DEFECT_ID}`]: {
              runId: ctx.runId,
              reason: "invalid private shell reabsorbed by administrative ownership repair",
              cancelledAt: ctx.now,
            },
          },
        }
      );
    updated += auction.modifiedCount;
  }

  if (result.ddSourceExists && result.ddCashTransfer > 0) {
    const markerPath = `remediation.${DEFECT_ID}.dd-shell-cash`;
    const transfer = await db.collection<Corporation>("corporations").updateOne(
      { _id: new ObjectId(DD_TARGET_CORPORATION_ID), [markerPath]: { $exists: false } },
      {
        $inc: { liquidCapital: result.ddCashTransfer },
        $set: {
          [markerPath]: {
            runId: ctx.runId,
            sourceCorporationId: DD_SOURCE_CORPORATION_ID,
            amountLocal: result.ddCashTransfer,
            appliedAt: ctx.now,
          },
          updatedAt: ctx.now,
        },
      }
    );
    updated += transfer.modifiedCount;
  }

  for (const row of result.transfers) {
    const merge = await applySectorMerge(db, row, ctx);
    updated += merge.updated;
    deleted += merge.deleted;
  }

  if (result.ddSourceExists) {
    const openAuctionCount = await db
      .collection<NationalizationAuction>("nationalizationAuctions")
      .countDocuments({ corporationId: new ObjectId(DD_SOURCE_CORPORATION_ID), status: "open" });
    if (openAuctionCount !== 0) throw new Error("East German shell still has an open auction");
    const remaining = await db.collection<CorporateSector>("corporateSectors").countDocuments({
      corporationId: new ObjectId(DD_SOURCE_CORPORATION_ID),
    });
    if (remaining !== 0) throw new Error(`East German shell still owns ${remaining} sector(s)`);
    const removed = await db
      .collection<Corporation>("corporations")
      .deleteOne({ _id: new ObjectId(DD_SOURCE_CORPORATION_ID) });
    deleted += removed.deletedCount;
  }

  return {
    documentsScanned: result.affected,
    documentsUpdated: updated,
    documentsDeleted: deleted,
    notes: [
      `merged ${result.transfers.length} sector rows without a transition haircut`,
      `processed ${result.compensation.length} paid-book compensation transfers`,
      `returned ${result.auctionRefunds.length} auction escrow(s) and cancelled the invalid auction`,
      result.ddSourceExists
        ? "absorbed the East German state-owned shell"
        : "East German shell already absent",
    ],
  };
}

async function verify(db: Db): Promise<VerifyResult> {
  const result = await survey(db);
  return {
    ok: result.affected === 0,
    remaining: result.affected,
    notes:
      result.affected === 0
        ? [
            "all eight reviewed sectors are held by their host state enterprises and compensation is complete",
          ]
        : result.notes,
  };
}

export const defect: Defect = {
  id: DEFECT_ID,
  title: "Private corporations retained sectors inside blocked command economies",
  severity: "P1",
  codeFix: {
    mergedTo: "main",
    requiredCommit: "23c23601254109f382085bca00f85ccd38149545",
  },
  seedFix: {
    status: "fixed",
    files: [
      "src/lib/economy/queries/commandEconomyMarketGate.ts",
      "src/lib/seeds/reference/budgets.ts",
    ],
  },
  envs: ["prod"],
  idempotent: true,
  guards: ["turn-lock-free", "max-affected:8", "money-conserving"],
  detect,
  plan,
  apply,
  verify,
};
