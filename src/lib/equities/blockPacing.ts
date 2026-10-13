/**
 * Block pacing for the equity market pool.
 *
 * The pool buys and places shares at the turn-priced fair value with no price
 * impact, so without a size limit a holder could turn any valuation into cash
 * in one turn: a 90% stake once sold to the pool for $1.09bn in a single turn.
 * Pacing keeps the price whole and spreads very large blocks over turns
 * instead: nobody receives less, they receive it later. Small trades and small
 * companies never reach the limits because of the anchor floors.
 *
 * Sells: the pool absorbs at most EQUITY_POOL_SELL_SHARE_PER_TURN of a
 * company's market value per turn (all sellers combined), floored at
 * EQUITY_POOL_SELL_FLOOR_ANCHOR. Usage is tracked on the corporation as
 * `poolSellAbsorbedTurn` / `poolSellAbsorbedLocal` and resets each turn.
 *
 * Primary issues: the pool places at most EQUITY_PRIMARY_PLACE_SHARE_PER_TURN
 * of the shares outstanding in one turn, floored at
 * EQUITY_PRIMARY_PLACE_FLOOR_ANCHOR. The rest becomes the approved pending
 * remainder that `placePendingShareIssuances` already paces.
 */

import type { ClientSession, Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { getCorpFxRate } from "@/lib/currency/corporationCapital";
import { getCurrentTurn } from "@/lib/currentTurn";

/** Share of a company's market value the pool will buy from sellers in one turn. */
export const EQUITY_POOL_SELL_SHARE_PER_TURN = 0.05;
/** Sales below this ₳ value per company per turn are never paced. */
export const EQUITY_POOL_SELL_FLOOR_ANCHOR = 25_000_000;
/** Share of outstanding shares the pool will place from a new issue in one turn. */
export const EQUITY_PRIMARY_PLACE_SHARE_PER_TURN = 0.1;
/** Issues below this ₳ value per turn are never paced. */
export const EQUITY_PRIMARY_PLACE_FLOOR_ANCHOR = 50_000_000;

function finitePositive(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Per-turn cap (local currency) on what the pool buys from sellers of one company. */
export function poolSellCapLocal(input: {
  sharePriceLocal: number;
  totalShares: number;
  localPerAnchor: number;
}): number {
  const marketValue = finitePositive(input.sharePriceLocal) * finitePositive(input.totalShares);
  const floor = EQUITY_POOL_SELL_FLOOR_ANCHOR * (finitePositive(input.localPerAnchor) || 1);
  return Math.max(marketValue * EQUITY_POOL_SELL_SHARE_PER_TURN, floor);
}

/** Cap still unused this turn, given the corporation's recorded usage. */
export function poolSellRemainingLocal(input: {
  capLocal: number;
  turn: number;
  absorbedTurn?: number | null;
  absorbedLocal?: number | null;
}): number {
  const used = input.absorbedTurn === input.turn ? finitePositive(input.absorbedLocal) : 0;
  return Math.max(0, input.capLocal - used);
}

/** Most shares the pool will place from a new issue this turn. */
export function primaryPlaceCapShares(input: {
  totalShares: number;
  pricePerShareLocal: number;
  localPerAnchor: number;
}): number {
  const byOutstanding = Math.floor(
    finitePositive(input.totalShares) * EQUITY_PRIMARY_PLACE_SHARE_PER_TURN
  );
  const price = finitePositive(input.pricePerShareLocal);
  const byFloor =
    price > 0
      ? Math.floor(
          (EQUITY_PRIMARY_PLACE_FLOOR_ANCHOR * (finitePositive(input.localPerAnchor) || 1)) / price
        )
      : 0;
  return Math.max(byOutstanding, byFloor);
}

export interface PoolSellPacing {
  turn: number;
  capLocal: number;
  remainingLocal: number;
}

/** Read this turn's sell allowance for one company from its current document. */
export async function loadPoolSellPacing(
  db: Db,
  corporationId: ObjectId,
  options?: { session?: ClientSession }
): Promise<PoolSellPacing> {
  const [corporation, turn] = await Promise.all([
    db.collection<Corporation>("corporations").findOne(
      { _id: corporationId },
      {
        projection: {
          sharePrice: 1,
          totalShares: 1,
          countryId: 1,
          liquidCurrencyCode: 1,
          poolSellAbsorbedTurn: 1,
          poolSellAbsorbedLocal: 1,
        },
        ...(options?.session ? { session: options.session } : {}),
      }
    ),
    getCurrentTurn(db),
  ]);
  if (!corporation) return { turn, capLocal: 0, remainingLocal: 0 };
  const capLocal = poolSellCapLocal({
    sharePriceLocal: corporation.sharePrice ?? 0,
    totalShares: corporation.totalShares ?? 0,
    localPerAnchor: await getCorpFxRate(db, corporation),
  });
  return {
    turn,
    capLocal,
    remainingLocal: poolSellRemainingLocal({
      capLocal,
      turn,
      absorbedTurn: corporation.poolSellAbsorbedTurn,
      absorbedLocal: corporation.poolSellAbsorbedLocal,
    }),
  };
}

/** Usage expression: this turn's absorbed amount, or 0 when the stamp is from another turn. */
function usedThisTurnExpr(turn: number) {
  return {
    $cond: [
      { $eq: ["$poolSellAbsorbedTurn", turn] },
      { $ifNull: ["$poolSellAbsorbedLocal", 0] },
      0,
    ],
  };
}

/**
 * Atomically reserve `amountLocal` of this turn's sell allowance. Returns false
 * when the reservation would exceed `capLocal` (another sale may have used it).
 */
export async function reservePoolSellAllowance(
  db: Db,
  corporationId: ObjectId,
  turn: number,
  amountLocal: number,
  capLocal: number,
  options?: { session?: ClientSession }
): Promise<boolean> {
  if (!(amountLocal > 0)) return true;
  const result = await db.collection<Corporation>("corporations").updateOne(
    {
      _id: corporationId,
      $expr: { $lte: [{ $add: [usedThisTurnExpr(turn), amountLocal] }, capLocal + 0.01] },
    },
    [
      {
        $set: {
          poolSellAbsorbedLocal: { $add: [usedThisTurnExpr(turn), amountLocal] },
          poolSellAbsorbedTurn: turn,
        },
      },
    ],
    options?.session ? { session: options.session } : undefined
  );
  return result.modifiedCount > 0;
}

/** Record pool absorption decided elsewhere (the turn order book), uncapped. */
export async function recordPoolSellAbsorbed(
  db: Db,
  absorbedByCorporation: ReadonlyMap<string, number>,
  turn: number,
  toObjectId: (id: string) => ObjectId
): Promise<void> {
  const ops = [...absorbedByCorporation]
    .filter(([, amount]) => amount > 0)
    .map(([id, amount]) => ({
      updateOne: {
        filter: { _id: toObjectId(id) },
        update: [
          {
            $set: {
              poolSellAbsorbedLocal: { $add: [usedThisTurnExpr(turn), amount] },
              poolSellAbsorbedTurn: turn,
            },
          },
        ],
      },
    }));
  if (ops.length > 0) await db.collection("corporations").bulkWrite(ops);
}

/** Give back a reservation when the sale it covered was rolled back. */
export async function releasePoolSellAllowance(
  db: Db,
  corporationId: ObjectId,
  turn: number,
  amountLocal: number,
  options?: { session?: ClientSession }
): Promise<void> {
  if (!(amountLocal > 0)) return;
  await db.collection<Corporation>("corporations").updateOne(
    { _id: corporationId, poolSellAbsorbedTurn: turn },
    [
      {
        $set: {
          poolSellAbsorbedLocal: {
            $max: [0, { $subtract: [{ $ifNull: ["$poolSellAbsorbedLocal", 0] }, amountLocal] }],
          },
        },
      },
    ],
    options?.session ? { session: options.session } : undefined
  );
}

/** Player-facing explanation when a sale is larger than this turn's allowance. */
export function poolSellPacedMessage(remainingShares: number, companyName: string): string {
  if (remainingShares <= 0) {
    return `The market has already bought as many ${companyName} shares as it will this turn (5% of the company's value per turn). Place a sell order and it will fill over the coming turns at the market price.`;
  }
  return `The market will buy up to ${remainingShares.toLocaleString("en-US")} more ${companyName} shares this turn (5% of the company's value per turn). Sell that many now, or place a sell order and the rest will fill over the coming turns at the market price.`;
}
