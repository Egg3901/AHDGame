/**
 * Corporation product lifecycle turn shell (issue #2125 slice).
 *
 * Wires the pure `processProductLifecycle` rules core into the corporation
 * turn: once per turn, every active corporation product accumulates its share
 * of the owning corp's already-consumed R&D / marketing budgets (anchor
 * basis, per-turn slice) and advances exactly one lifecycle step.
 *
 * Allocation view only: the corporate overhead settlement in
 * `sectorCalculations.ts` already consumes `rdBudget` and `marketingBudget`
 * as cash costs. This phase never touches cash, revenue, demand, prices, or
 * coverage — it only persists the returned product state, so no budget is
 * ever double-charged.
 *
 * Safety properties:
 * - Flag-off (`corporationProductsEnabled !== true`) performs zero product
 *   reads or writes. The caller resolves the flag from its existing
 *   gameConfig projection, so the off path adds no round trips either.
 * - One bulk read of active products plus one bulkWrite, never per-product
 *   queries. Corporations resolve from the turn's in-memory corp map.
 * - Each write carries `lastProcessedTurn: { $ne: turn }` in its filter, so a
 *   concurrent or repeated execution cannot double-advance a product: both
 *   writers compute from the same pre-image and `$set` identical absolute
 *   values, and a stale retry matches nothing.
 * - Auto-retire keeps the atomic slot invariant: the same single-document
 *   update `$set`s `stage: "retired"` and `$unset`s `activeCorporationId`.
 * - No transactions, no sessions, no new balance constants, no market reads.
 */
import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import {
  fxRateForCorpFromMap,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import {
  CORPORATION_PRODUCTS_COLLECTION,
  type CorporationProductDocument,
} from "@/lib/products/persistence";
import { processProductLifecycle } from "@/lib/products/lifecycle";

export interface ProductLifecycleTurnCorpInput {
  corpId: string;
  /** Existing sector quality rollup (0-100); null when absent or non-finite. */
  sectorQuality: number | null;
  /** This turn's product R&D slice, anchor basis (allocation view, no cash). */
  productRnDAnchor: number;
  /** This turn's delivered advertising slice, anchor basis (allocation view). */
  deliveredAdvertisingAnchor: number;
  /** Technology ids the corporation unlocked; only kind-relevant ones count. */
  unlockedTechnologyIds: readonly string[];
}

export interface ProcessCorporationProductTurnArgs {
  /** Resolved `corporationProductsEnabled`; false performs zero DB access. */
  enabled: boolean;
  turn: number | undefined;
  /** Existing turn corp map (no per-product corporation query). */
  corpsById: ReadonlyMap<string, Corporation>;
  /** Preloaded FX map (local per 1 anchor), same map the sector loop uses. */
  fxByCurrency: ReadonlyMap<CurrencyCode, number>;
}

export interface ProcessCorporationProductTurnResult {
  enabled: boolean;
  /** Active products found this turn. */
  found: number;
  /** Products advanced (bulkWrite ops issued). */
  advanced: number;
  /** Of those, products auto-retired with their slot freed. */
  retired: number;
  /** Products skipped because their corporation was absent from the map. */
  skippedMissingCorp: number;
}

const ZERO_RESULT = {
  found: 0,
  advanced: 0,
  retired: 0,
  skippedMissingCorp: 0,
} as const;

/**
 * Derives one corp's lifecycle inputs from its stored document. Pure apart
 * from the currency helpers, which are synchronous arithmetic.
 */
export function buildProductLifecycleCorpInput(
  corp: Corporation,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>
): ProductLifecycleCorpInput {
  const corpId = corp._id.toString();
  const code = resolveCorpLiquidCurrencyCode(corp);
  const fx = fxRateForCorpFromMap(corp, fxByCurrency);
  const toPerTurnAnchor = (local: unknown): number => {
    if (typeof local !== "number" || !Number.isFinite(local) || local <= 0) return 0;
    const anchor = readCorpEconomicAnchor(local, code, fx);
    if (!Number.isFinite(anchor) || anchor <= 0) return 0;
    return anchor / TURNS_PER_DAY;
  };
  const quality =
    typeof corp.averageQuality === "number" && Number.isFinite(corp.averageQuality)
      ? corp.averageQuality
      : null;
  const unlocked = Array.isArray(corp.unlockedTechNodeIds)
    ? corp.unlockedTechNodeIds.filter((id): id is string => typeof id === "string")
    : [];
  return {
    corpId,
    sectorQuality: quality,
    productRnDAnchor: toPerTurnAnchor(corp.rdBudget),
    deliveredAdvertisingAnchor: toPerTurnAnchor(corp.marketingBudget),
    unlockedTechnologyIds: unlocked,
  };
}

export async function processCorporationProductTurn(
  db: Db,
  args: ProcessCorporationProductTurnArgs
): Promise<ProcessCorporationProductTurnResult> {
  if (!args.enabled) return { enabled: false, ...ZERO_RESULT };
  const turn = args.turn;
  if (typeof turn !== "number" || !Number.isFinite(turn)) {
    return { enabled: true, ...ZERO_RESULT };
  }

  const collection = db.collection<CorporationProductDocument>(CORPORATION_PRODUCTS_COLLECTION);
  const active = await collection
    .find({ activeCorporationId: { $exists: true } } as never)
    .toArray();
  if (active.length === 0) return { enabled: true, ...ZERO_RESULT };

  const ops: Parameters<typeof collection.bulkWrite>[0] = [];
  let retired = 0;
  let skippedMissingCorp = 0;
  for (const doc of active) {
    const corp = args.corpsById.get(doc.corporationId);
    if (!corp) {
      skippedMissingCorp += 1;
      continue;
    }
    const input = buildProductLifecycleCorpInput(corp, args.fxByCurrency);
    const result = processProductLifecycle({
      enabled: true,
      product: doc,
      turn,
      sectorQuality: input.sectorQuality,
      productRnDAnchor: input.productRnDAnchor,
      deliveredAdvertisingAnchor: input.deliveredAdvertisingAnchor,
      unlockedTechnologyIds: input.unlockedTechnologyIds,
    });
    if (!result.advanced) continue;
    const next = result.product;
    const set: Record<string, unknown> = {
      stage: next.stage,
      developmentSpendAnchor: next.developmentSpendAnchor,
      developmentAdvertisingAnchor: next.developmentAdvertisingAnchor,
      developmentAdvertisingTurns: next.developmentAdvertisingTurns,
      lastProcessedTurn: next.lastProcessedTurn,
    };
    if (next.launchedTurn !== undefined) set.launchedTurn = next.launchedTurn;
    if (next.launchQuality !== undefined) set.launchQuality = next.launchQuality;
    if (next.productBrand !== undefined) set.productBrand = next.productBrand;
    if (next.retiredTurn !== undefined) set.retiredTurn = next.retiredTurn;
    const update: Record<string, unknown> = { $set: set };
    if (next.stage === "retired") {
      // Same single-document write frees the one-active-product slot.
      (update as { $unset: Record<string, string> }).$unset = { activeCorporationId: "" };
      retired += 1;
    }
    ops.push({
      updateOne: {
        filter: { _id: doc._id, lastProcessedTurn: { $ne: turn } } as never,
        update: update as never,
      },
    });
  }

  if (ops.length > 0) {
    await collection.bulkWrite(ops);
  }
  return {
    enabled: true,
    found: active.length,
    advanced: ops.length,
    retired,
    skippedMissingCorp,
  };
}
