import type { Collection } from "mongodb";
import type { SupplyAgreement } from "@/lib/db/types/supplyAgreement";
import { CONTRACT_CANCEL_NOTICE_TURNS } from "@/lib/db/types/supplyAgreement";
import { STATE_SCOPED_COMMODITIES } from "@/lib/market/commodityMarketScope";

/**
 * Retire corporation-wide contracts that cannot identify a state market.
 *
 * Pending proposals are withdrawn immediately because neither party has
 * accepted them. Live agreements receive the same notice period as a normal
 * cancellation and continue under legacy clearing until that notice expires.
 */
export async function migrateStateScopedSupplyAgreements(args: {
  agreements: Collection<SupplyAgreement>;
  turn: number;
  now: Date;
}): Promise<{ pendingCancelled: number; noticeServed: number; noticeExpired: number }> {
  const commodityFilter = { $in: STATE_SCOPED_COMMODITIES };
  const pending = await args.agreements.updateMany(
    { status: "pending", commodity: commodityFilter },
    { $set: { status: "cancelled", updatedAt: args.now } }
  );
  const active = await args.agreements.updateMany(
    { status: "active", commodity: commodityFilter },
    {
      $set: {
        status: "cancelling",
        cancelEffectiveTurn: args.turn + CONTRACT_CANCEL_NOTICE_TURNS,
        updatedAt: args.now,
      },
    }
  );
  const expired = await args.agreements.updateMany(
    { status: "cancelling", cancelEffectiveTurn: { $lte: args.turn } },
    { $set: { status: "cancelled", updatedAt: args.now } }
  );

  return {
    pendingCancelled: pending.modifiedCount,
    noticeServed: active.modifiedCount,
    noticeExpired: expired.modifiedCount,
  };
}
