/**
 * Advertising settlement turn shell (issue #2235 slice).
 *
 * Runs inside the corporation turn, after the sector bulk writes, and before
 * the product lifecycle phase. It attributes each buyer's ALREADY-SETTLED
 * marketing spend across its active advertising agreements plus spot, values
 * the effective delivered advertising with the pure rules, and persists one
 * settlement document per spending corporation for the product lifecycle and
 * the UI to read.
 *
 * Cash safety: this phase never touches corporations, corporateSectors, cash,
 * revenue, demand, or prices. It writes only advertisingAgreements lifecycle
 * transitions (expiry, served notices, per-agreement settlement stats) and
 * advertisingSettlements upserts. No double charge and no revenue mint hold
 * by construction: there is no code path here that can move money.
 *
 * Standalone-Mongo design: one bulk agreement read, one bulk operating-model
 * read, and at most two bulkWrites plus the gated lifecycle finalization. No
 * sessions, no transactions. Settlement upserts key on {corporationId, turn}
 * and agreement stats $set absolute values, so a replayed turn recomputes
 * identical values and overlapping writers converge instead of doubling.
 */
import type { AnyBulkWriteOperation, Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import {
  fxRateForCorpFromMap,
  fxRateForSectorHostFromMap,
  resolveCorpLiquidCurrencyCode,
  resolveSectorHostCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import {
  ADVERTISING_AGREEMENTS_COLLECTION,
  ADVERTISING_SETTLEMENTS_COLLECTION,
  isAgreementSettling,
  type AdvertisingAgreement,
  type AdvertisingSettlement,
} from "./types";
import {
  aggregateContractedClaims,
  attributeBuyerSpend,
  coverFractions,
} from "./rules/attribution";
import {
  buyerOperatingWeights,
  coverageOverlap,
  supplierCoverageByState,
  type CoverageSectorInput,
} from "./rules/coverage";
import { finalizeAdvertisingAgreementLifecycle, listOperatingModelsForCorps } from "./persistence";

export interface ProcessAdvertisingTurnArgs {
  /** Resolved `corporationProductsEnabled`; false performs zero DB access. */
  enabled: boolean;
  turn: number | undefined;
  /** Turn's in-memory corp map (no per-corp queries). */
  corpsById: ReadonlyMap<string, Corporation>;
  /** Turn's in-memory sectors by corp (no sector queries). */
  sectorsByCorp: ReadonlyMap<string, readonly CoverageSectorInput[]>;
  /** Preloaded FX map (local per 1 anchor). */
  fxByCurrency: ReadonlyMap<CurrencyCode, number>;
  /** Settled delivered advertising value per selling corp, anchor basis. */
  deliveredAnchorBySellerId: ReadonlyMap<string, number>;
  /** Marketing cash the sector pass settled per buying corp, anchor basis. */
  settledSpendAnchorByBuyerId: ReadonlyMap<string, number>;
}

export interface ProcessAdvertisingTurnResult {
  enabled: boolean;
  /** Spending corporations settled (settlement docs written). */
  buyers: number;
  /** Agreements that settled delivery this turn. */
  agreementsSettling: number;
  /** Lifecycle transitions finalized (expired + cancelled). */
  finalized: number;
  /**
   * Effective delivered advertising per corporation, anchor basis. The
   * product lifecycle phase consumes this map; the persisted settlement
   * documents carry the same values for UI and audit reads.
   */
  effectiveAnchorByCorpId: Map<string, number>;
}

const ZERO_RESULT = {
  buyers: 0,
  agreementsSettling: 0,
  finalized: 0,
} as const;

function toPerTurnAnchor(value: unknown, code: CurrencyCode, fx: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  const anchor = readCorpEconomicAnchor(value, code, fx);
  if (!Number.isFinite(anchor) || anchor <= 0) return 0;
  return anchor / TURNS_PER_DAY;
}

function techCount(corp: Corporation): number {
  return Array.isArray(corp.unlockedTechNodeIds)
    ? corp.unlockedTechNodeIds.filter((id): id is string => typeof id === "string").length
    : 0;
}

function sectorRevenueAnchor(
  sector: CoverageSectorInput,
  corp: Corporation,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>
): number {
  const code = resolveSectorHostCurrencyCode(sector, corp);
  const fx = fxRateForSectorHostFromMap(sector, corp, fxByCurrency);
  const anchor = readCorpEconomicAnchor(sector.revenue, code, fx);
  return Number.isFinite(anchor) ? Math.max(0, anchor) : 0;
}

export async function processAdvertisingTurn(
  db: Db,
  args: ProcessAdvertisingTurnArgs
): Promise<ProcessAdvertisingTurnResult> {
  if (!args.enabled) {
    return { enabled: false, ...ZERO_RESULT, effectiveAnchorByCorpId: new Map() };
  }
  const turn = args.turn;
  if (typeof turn !== "number" || !Number.isFinite(turn)) {
    return { enabled: true, ...ZERO_RESULT, effectiveAnchorByCorpId: new Map() };
  }

  const agreementCollection = db.collection<AdvertisingAgreement>(
    ADVERTISING_AGREEMENTS_COLLECTION
  );
  const allLive = await agreementCollection
    .find({ status: { $in: ["active", "cancelling"] } } as never)
    .toArray();

  // Finalize only when a loaded agreement actually hit its deadline, so idle
  // turns skip the lifecycle writes entirely.
  let finalized = 0;
  const needsFinalize = allLive.some(
    (a) =>
      (a.status === "active" &&
        a.expiresAtTurn !== undefined &&
        Number.isFinite(a.expiresAtTurn) &&
        turn >= a.expiresAtTurn) ||
      (a.status === "cancelling" &&
        a.cancelEffectiveTurn !== undefined &&
        Number.isFinite(a.cancelEffectiveTurn) &&
        turn >= a.cancelEffectiveTurn)
  );
  if (needsFinalize) {
    const done = await finalizeAdvertisingAgreementLifecycle(db, turn);
    finalized = done.expired + done.cancelled;
  }

  const settling = allLive.filter((a) => isAgreementSettling(a, turn));
  const byBuyer = new Map<string, AdvertisingAgreement[]>();
  for (const agreement of settling) {
    const list = byBuyer.get(agreement.buyerCorpId) ?? [];
    list.push(agreement);
    byBuyer.set(agreement.buyerCorpId, list);
  }

  const supplierIds = [...new Set(settling.map((a) => a.supplierCorpId))];
  const modelsBySupplier =
    supplierIds.length > 0 ? await listOperatingModelsForCorps(db, supplierIds) : new Map();

  const totalDelivered = [...args.deliveredAnchorBySellerId.values()].reduce(
    (sum, v) => sum + (Number.isFinite(v) && v > 0 ? v : 0),
    0
  );
  const deliveryExists = totalDelivered > 0;

  // Aggregate contracted claims across buyers BEFORE attributing any single
  // buyer, so one supplier's delivery is shared fairly.
  const claimants: Array<{
    buyerCorpId: string;
    settledSpendAnchor: number;
    agreements: Array<{ supplierCorpId: string; allocationShareBps: number }>;
  }> = [];
  for (const [buyerCorpId, agreements] of byBuyer) {
    const settled = args.settledSpendAnchorByBuyerId.get(buyerCorpId) ?? 0;
    if (!(settled > 0)) continue;
    claimants.push({
      buyerCorpId,
      settledSpendAnchor: settled,
      agreements: agreements.map((a) => ({
        supplierCorpId: a.supplierCorpId,
        allocationShareBps: a.allocationShareBps,
      })),
    });
  }
  const claimsBySupplier = aggregateContractedClaims(claimants);
  const deliveredAnchor = new Map<string, number>();
  for (const [sellerId, value] of args.deliveredAnchorBySellerId) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      deliveredAnchor.set(sellerId, value);
    }
  }
  const coverBySupplier = coverFractions(claimsBySupplier, deliveredAnchor);
  const deliveredFlag = new Map<string, boolean>();
  for (const supplierId of claimsBySupplier.keys()) {
    deliveredFlag.set(supplierId, (deliveredAnchor.get(supplierId) ?? 0) > 0);
  }

  const effectiveAnchorByCorpId = new Map<string, number>();
  const settlementOps: AnyBulkWriteOperation<AdvertisingSettlement>[] = [];
  const agreementOps: AnyBulkWriteOperation<AdvertisingAgreement>[] = [];
  let buyers = 0;

  for (const [corpId, corp] of args.corpsById) {
    const code = resolveCorpLiquidCurrencyCode(corp);
    const fx = fxRateForCorpFromMap(corp, args.fxByCurrency);
    const requested = toPerTurnAnchor(corp.marketingBudget, code, fx);
    const settled = args.settledSpendAnchorByBuyerId.get(corpId) ?? 0;
    if (!(requested > 0) && !(settled > 0)) continue;

    const agreements = byBuyer.get(corpId) ?? [];
    const buyerSectors = args.sectorsByCorp.get(corpId) ?? [];
    const buyerWeights = buyerOperatingWeights({
      buyerSectors: buyerSectors.map((s) => ({
        ...s,
        revenue: sectorRevenueAnchor(s, corp, args.fxByCurrency),
      })),
      headquartersState: corp.headquartersState,
    });

    const overlaps = new Map<string, number>();
    if (agreements.length > 0 && buyerWeights.size > 0) {
      const buyerStates = [...buyerWeights.keys()];
      for (const agreement of agreements) {
        const supplierCorp = args.corpsById.get(agreement.supplierCorpId);
        const supplierSectors = args.sectorsByCorp.get(agreement.supplierCorpId) ?? [];
        const coverage = supplierCoverageByState({
          operatingModels: modelsBySupplier.get(agreement.supplierCorpId) ?? [],
          supplierSectors,
          relevantTechCount: supplierCorp ? techCount(supplierCorp) : 0,
          states: buyerStates,
        });
        overlaps.set(agreement.supplierCorpId, coverageOverlap(buyerWeights, coverage));
      }
    }

    const attribution = attributeBuyerSpend({
      settledSpendAnchor: settled,
      deliveryExists,
      agreements: agreements.map((a) => ({
        supplierCorpId: a.supplierCorpId,
        allocationShareBps: a.allocationShareBps,
      })),
      coverFractionBySupplier: coverBySupplier,
      deliveredBySupplier: deliveredFlag,
      overlapBySupplier: overlaps,
    });

    effectiveAnchorByCorpId.set(corpId, attribution.effectiveAnchor);
    buyers += 1;
    settlementOps.push({
      updateOne: {
        filter: { corporationId: corpId, turn } as never,
        update: {
          $set: {
            corporationId: corpId,
            turn,
            settledSpendAnchor: attribution.settledSpendAnchor,
            contractedSpendAnchor: attribution.contractedSpendAnchor,
            spotSpendAnchor: attribution.spotSpendAnchor,
            effectiveAdvertisingAnchor: attribution.effectiveAnchor,
            lines: attribution.lines.map((line) => ({
              supplierCorpId: line.supplierCorpId,
              allocationShareBps: line.allocationShareBps,
              overlap: line.overlap,
              coveredSpendAnchor: line.coveredSpendAnchor,
              effectiveAnchor: line.effectiveAnchor,
            })),
            updatedAt: new Date(),
          },
        } as never,
        upsert: true,
      },
    });

    for (const line of attribution.lines) {
      const agreement = agreements.find((a) => a.supplierCorpId === line.supplierCorpId);
      if (!agreement?._id) continue;
      agreementOps.push({
        updateOne: {
          filter: { _id: agreement._id } as never,
          update: {
            $set: {
              lastSettlementTurn: turn,
              lastCoveredSpendAnchor: line.coveredSpendAnchor,
              lastEffectiveAnchor: line.effectiveAnchor,
              lastOverlap: line.overlap,
              updatedAt: new Date(),
            },
          } as never,
        },
      });
    }
  }

  if (settlementOps.length > 0) {
    await db
      .collection<AdvertisingSettlement>(ADVERTISING_SETTLEMENTS_COLLECTION)
      .bulkWrite(settlementOps);
  }
  if (agreementOps.length > 0) {
    await agreementCollection.bulkWrite(agreementOps);
  }

  return {
    enabled: true,
    buyers,
    agreementsSettling: settling.length,
    finalized,
    effectiveAnchorByCorpId,
  };
}
