/**
 * Winning defence bids become active orders using existing procurement economics.
 * A plant lock coordinates awards with CEO factory assignments; named budget markers
 * and the frozen contract id let an interrupted award resume without a second obligation.
 */
import { createSystemNewsPost } from "@/lib/news";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { selfDealingDisclosure } from "@/lib/military/defenceSelfDealing";
import { ObjectId, type Db } from "mongodb";
import type { AuthUserWithCharacter } from "@/lib/auth";
import type { DefenceContract } from "@/lib/db/types/defenceContract";
import { assignedFactoriesForSector } from "@/lib/db/collections/defenceContracts";
import {
  awardFactoryAllocation,
  defaultFactoryAllocation,
  DEFENCE_FACTORY_SLOTS_PER_PLANT,
} from "@/lib/military/defenceLotEconomics";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { resolveDefenseLineFrom } from "@/lib/turn/defenseEnvelope";
import { convertDefenceReservation, fenceDefenceReservation } from "./reservations";
import { lockContractPlant, releaseContractPlant } from "./plantSlots";
import { validateBid, ContractError } from "./eligibility";
import { tenders } from "./persistence";
import type { GovernmentTender, ContractBid } from "./types";

export async function activateDefenceBid(
  db: Db,
  t: GovernmentTender,
  bid: ContractBid,
  _user: AuthUserWithCharacter,
  turn: number,
  now: Date
) {
  const col = db.collection<DefenceContract>("defenceContracts");
  const existing = await col.findOne({ _id: new ObjectId(t.contractId) });
  if (existing) {
    await finishAward(db, t, existing);
    return;
  }
  if (!(await fenceDefenceReservation(db, t)))
    throw new ContractError(
      "A newer award request owns this reservation. Refresh before retrying."
    );
  const sectorId = new ObjectId(bid.sectorId);
  if (
    !(await lockContractPlant(db, sectorId, t._id, t.awardLeaseKey ?? t._id, t.awardLeaseRevision))
  )
    throw new ContractError(
      "This plant is processing another contract operation. Resume that operation first."
    );
  // Keep the lock after interrupted financial work. The same tender can resume it.
  let prepared = t.preparedDefence;
  let defenseLine = t.preparedDefenseLine,
    stateOwned = t.preparedStateOwned;
  if (!prepared) {
    try {
      if (t.terms.type !== "defence") throw new ContractError("Not a defence tender.", 400);
      const { corp, sector, budget, fill } = await validateBid(db, t, bid, turn);
      if (!sector || !budget || !fill)
        throw new ContractError("The plant cannot supply this order.");
      stateOwned = isStateOwned(corp);
      const used = await assignedFactoriesForSector(
        db,
        sector._id,
        defaultFactoryAllocation(fill.components.length, DEFENCE_FACTORY_SLOTS_PER_PLANT)
      );
      const slots = awardFactoryAllocation({
        componentCount: fill.components.length,
        freeSlots: Math.max(0, DEFENCE_FACTORY_SLOTS_PER_PLANT - used),
        stateOwned,
      });
      if (!slots) throw new ContractError("This plant has no available production lines.");
      defenseLine = resolveDefenseLineFrom(budget);
      const value = t.terms.lots * bid.amount;
      prepared = {
        _id: new ObjectId(t.contractId),
        tenderId: t._id,
        countryId: t.countryId,
        corporationId: corp._id,
        sectorId: sector._id,
        component: t.terms.component,
        lotsOrdered: t.terms.lots,
        lotsDelivered: 0,
        pricePerLot: bid.amount,
        allocationWindowId: t.allocationWindowId,
        allocatedLots: t.terms.lots,
        encumberedAmount: value,
        amountPaid: 0,
        productionCostPaid: 0,
        gradeCeiling: t.terms.grade,
        assignedFactories: slots,
        costBasis: "margin",
        status: "active",
        awardedTurn: t.awardedTurn ?? turn,
        updatedAt: now,
        ...(t.awardSelfDealing ? { selfDealing: t.awardSelfDealing } : {}),
      };
      await tenders(db).updateOne(
        {
          _id: t._id,
          status: "awarding",
          awardLeaseKey: t.awardLeaseKey,
          awardAttemptId: t.awardAttemptId,
          preparedDefence: { $exists: false },
        },
        {
          $set: {
            preparedDefence: prepared,
            preparedDefenseLine: defenseLine,
            preparedStateOwned: stateOwned,
          },
        }
      );
      const frozen = await tenders(db).findOne({ _id: t._id });
      if (
        !frozen?.preparedDefence ||
        frozen.awardLeaseKey !== t.awardLeaseKey ||
        frozen.awardAttemptId !== t.awardAttemptId
      )
        throw new ContractError(
          "A newer request owns the award preparation. Refresh before retrying."
        );
      prepared = frozen.preparedDefence;
      defenseLine = frozen.preparedDefenseLine;
      stateOwned = frozen.preparedStateOwned;
    } catch (e) {
      await releaseContractPlant(db, sectorId, t._id, t.awardLeaseKey ?? t._id);
      await resetUnconvertedAward(db, t);
      throw e;
    }
  }
  if (
    !(await convertDefenceReservation(
      db,
      t,
      bid.corporationId,
      prepared.encumberedAmount ?? 0,
      defenseLine ?? 0,
      stateOwned === true
    ))
  ) {
    await releaseContractPlant(db, sectorId, t._id, t.awardLeaseKey ?? t._id);
    await resetUnconvertedAward(db, t);
    throw new ContractError("The supplier allowance changed. Select another bid or retry.");
  }
  try {
    await col.insertOne(prepared);
  } catch (e) {
    if ((e as { code?: number }).code !== 11000) throw e;
  }
  await finishAward(db, t, prepared);
}
async function resetUnconvertedAward(db: Db, t: GovernmentTender) {
  await tenders(db).updateOne(
    { _id: t._id, status: "awarding", awardLeaseKey: t.awardLeaseKey },
    {
      $set: { status: "open" },
      $unset: {
        winningCorporationId: "",
        preparedDefence: "",
        preparedDefenseLine: "",
        preparedStateOwned: "",
        awardSelfDealing: "",
        awardAttemptId: "",
        awardReason: "",
        awardedBy: "",
        awardedTurn: "",
      },
    }
  );
}
async function finishAward(db: Db, t: GovernmentTender, contract: DefenceContract) {
  if (contract.selfDealing?.ministerCharacterId)
    await db.collection("characters").updateOne(
      {
        _id: contract.selfDealing.ministerCharacterId,
        governmentContractDisclosures: { $ne: t._id },
      },
      {
        $inc: { favorability: -contract.selfDealing.favorabilityPenalty },
        $addToSet: { governmentContractDisclosures: t._id },
      }
    );
  if (contract.selfDealing)
    await createSystemNewsPost(
      selfDealingDisclosure({
        basis: contract.selfDealing.basis,
        ministerName: contract.selfDealing.ministerName ?? "The defence minister",
        corporationName: t.bids[t.winningCorporationId ?? ""]?.corporationName ?? "the supplier",
        countryName: COUNTRY_CONFIGS[t.countryId].name,
        lots: contract.lotsOrdered,
        value: contract.pricePerLot * contract.lotsOrdered,
        stakeShare: contract.selfDealing.stakeShare,
      }),
      "executive",
      { title: "Defence contract awarded to minister's own company", id: contract._id, db }
    );
  await releaseContractPlant(db, contract.sectorId, t._id, t.awardLeaseKey ?? t._id);
}
