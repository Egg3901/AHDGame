/** Whole-order conversion refunds reverse both unfinished and delivered investment. */
import type { CorporateSector } from "@/lib/db/types/corporation";
import { deliveredFraction } from "@/lib/corporations/buildDelivery";
import { seedPlantLedger } from "@/lib/corporations/plantLedger";
export function quoteConversionConstructionRefund(sector: CorporateSector, turn: number) {
  const processed = Math.min(turn, sector.operatingCapacityTurn ?? turn - 1);
  const queue = sector.buildQueue ?? [];
  for (const order of queue) {
    if (
      ![order.unitsOrdered, order.costPaidAnchor, order.startTurn, order.onlineTurn].every(
        Number.isFinite
      ) ||
      order.unitsOrdered < 0 ||
      order.costPaidAnchor < 0
    )
      throw new Error("Invalid conversion construction order");
  }
  const anchor = queue.reduce((sum, order) => sum + Math.max(0, order.costPaidAnchor), 0);
  const removedUnits = queue.reduce(
    (sum, order) => sum + order.unitsOrdered * deliveredFraction(order, processed),
    0
  );
  const removedBook = queue.reduce(
    (sum, order) => sum + order.costPaidAnchor * deliveredFraction(order, processed),
    0
  );
  if (![anchor, removedUnits, removedBook].every(Number.isFinite))
    throw new Error("Invalid conversion construction quote");
  const capitalStock = Math.max(0, (sector.capitalStock ?? 0) - removedUnits);
  return {
    anchor,
    units: queue.reduce(
      (sum, order) => sum + (order.costPaidAnchor > 0 ? order.unitsOrdered : 0),
      0
    ),
    set: {
      buildQueue: [],
      constructionInProgressAnchor: 0,
      capitalStock,
      operatingCapacityUnits: capitalStock,
      capacityBookAnchor: Math.max(0, (sector.capacityBookAnchor ?? 0) - removedBook),
      ...seedPlantLedger(
        sector.sectorType,
        capitalStock,
        sector.industryModel,
        sector.mediaDiscriminator
      ),
    },
  };
}
