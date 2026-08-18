import type { Db } from "mongodb";
import {
  defenceContractLotCaps,
  defenceContractWindow,
  defenceSupplierCapShare,
  type DefenceContractLotCaps,
  type DefenceContractWindow,
} from "@/lib/military/defenceContractLimits";

interface DefenceProcurementAllocation {
  _id: string;
  countryId: string;
  windowIndex: number;
  startTurn: number;
  endTurn: number;
  countryAmount: number;
  supplierAmounts: Record<string, number>;
  updatedAt: Date;
}

export interface DefenceContractAvailability extends DefenceContractLotCaps {
  window: DefenceContractWindow;
  countryUsed: number;
  supplierUsed: number;
  countryRemaining: number;
  supplierRemaining: number;
  maxLots: number;
}

function allocations(db: Db) {
  return db.collection<DefenceProcurementAllocation>("defenceProcurementAllocations");
}

function supplierField(corporationId: string): string {
  return `supplierAmounts.${corporationId}`;
}

export async function getDefenceContractAvailability(
  db: Db,
  input: {
    countryId: string;
    corporationId: string;
    currentTurn: number;
    defenseLine: number;
    pricePerLot: number;
    /** National Corporations skip the private anti-dumping cap (ticket #1134). */
    stateOwned?: boolean;
  }
): Promise<DefenceContractAvailability> {
  const window = defenceContractWindow(input.countryId, input.currentTurn);
  const caps = defenceContractLotCaps(input.defenseLine, input.pricePerLot);
  const share = defenceSupplierCapShare(input.stateOwned === true);
  const allocation = await allocations(db).findOne({ _id: window.id });
  const countryAmount = allocation?.countryAmount ?? 0;
  const supplierAmount = allocation?.supplierAmounts?.[input.corporationId] ?? 0;
  const countryRemainingAmount = Math.max(0, caps.procurementNotional - countryAmount);
  const supplierRemainingAmount = Math.max(0, caps.procurementNotional * share - supplierAmount);
  const countryUsed = Math.floor(countryAmount / input.pricePerLot);
  const supplierUsed = Math.floor(supplierAmount / input.pricePerLot);
  const countryRemaining = Math.floor(countryRemainingAmount / input.pricePerLot);
  const supplierRemaining = Math.floor(supplierRemainingAmount / input.pricePerLot);
  return {
    ...caps,
    supplierLots: caps.countryLots > 0 ? Math.max(1, Math.floor(caps.countryLots * share)) : 0,
    window,
    countryUsed,
    supplierUsed,
    countryRemaining,
    supplierRemaining,
    maxLots: Math.min(countryRemaining, supplierRemaining),
  };
}

/**
 * Race-safe quota reservation. The route performs a read first for a useful error, but this
 * guarded increment is authoritative when two award requests arrive together.
 */
export async function reserveDefenceContractLots(
  db: Db,
  input: {
    countryId: string;
    corporationId: string;
    currentTurn: number;
    defenseLine: number;
    pricePerLot: number;
    lots: number;
    stateOwned?: boolean;
  }
): Promise<DefenceContractAvailability & { reserved: boolean }> {
  const requested = Math.max(0, Math.floor(input.lots));
  const requestedAmount = requested * input.pricePerLot;
  const availability = await getDefenceContractAvailability(db, input);
  if (requested <= 0 || requested > availability.maxLots) {
    return { ...availability, reserved: false };
  }

  const now = new Date();
  try {
    await allocations(db).updateOne(
      { _id: availability.window.id },
      {
        $setOnInsert: {
          countryId: input.countryId,
          windowIndex: availability.window.index,
          startTurn: availability.window.startTurn,
          endTurn: availability.window.endTurn,
          countryAmount: 0,
          supplierAmounts: {},
        },
        $set: { updatedAt: now },
      },
      { upsert: true }
    );
  } catch (error) {
    // Two first awards can race the upsert. The winner created the window; the loser can
    // continue to the guarded increment against that same document.
    if ((error as { code?: number })?.code !== 11000) throw error;
  }

  const field = supplierField(input.corporationId);
  const result = await allocations(db).updateOne(
    {
      _id: availability.window.id,
      $expr: {
        $and: [
          {
            $lte: [
              { $ifNull: ["$countryAmount", 0] },
              availability.procurementNotional - requestedAmount,
            ],
          },
          {
            $lte: [
              { $ifNull: [`$${field}`, 0] },
              availability.procurementNotional *
                defenceSupplierCapShare(input.stateOwned === true) -
                requestedAmount,
            ],
          },
        ],
      },
    } as never,
    {
      $inc: { countryAmount: requestedAmount, [field]: requestedAmount },
      $set: { updatedAt: now },
    }
  );

  if (result.modifiedCount > 0) {
    return {
      ...availability,
      countryUsed: availability.countryUsed + requested,
      supplierUsed: availability.supplierUsed + requested,
      countryRemaining: availability.countryRemaining - requested,
      supplierRemaining: availability.supplierRemaining - requested,
      maxLots: Math.min(
        availability.countryRemaining - requested,
        availability.supplierRemaining - requested
      ),
      reserved: true,
    };
  }

  const fresh = await getDefenceContractAvailability(db, input);
  return { ...fresh, reserved: false };
}

/** Release quota after an offer is declined, withdrawn, or fails to persist. */
export async function releaseDefenceContractLots(
  db: Db,
  allocationWindowId: string,
  corporationId: string,
  amount: number
): Promise<void> {
  const released = Math.max(0, Math.floor(amount));
  if (released <= 0) return;
  const field = supplierField(corporationId);
  await allocations(db).updateOne(
    {
      _id: allocationWindowId,
      countryAmount: { $gte: released },
      [field]: { $gte: released },
    },
    {
      $inc: { countryAmount: -released, [field]: -released },
      $set: { updatedAt: new Date() },
    }
  );
}
