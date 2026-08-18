import type { Db, ObjectId } from "mongodb";
import type { CorporateSector, Corporation } from "@/lib/db/types/corporation";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";
import { rawLotsFromSector, militaryDivertedShare } from "@/lib/military/arsenal";
import {
  canSupply,
  resolveFillEligibility,
  deliveredGrade,
} from "@/lib/military/defenceFillEligibility";
import {
  contractLotsThisTurn,
  defaultFactoryAllocation,
  lotProductionCost,
  DEFENCE_FACTORY_SLOTS_PER_PLANT,
} from "@/lib/military/defenceLotEconomics";
import {
  listActiveContracts,
  advanceContract,
  stampDeliveryCarry,
  recordContractPayment,
  releaseContractEncumbrance,
} from "@/lib/db/collections/defenceContracts";
import { claimDefenceMoneyMove, deliveryClaimKey } from "@/lib/db/collections/defenceMoneyClaims";
import { depositLots, drawLots } from "@/lib/db/collections/nationalArsenal";
import {
  settleEncumbrance,
  unsettleEncumbrance,
  debitAppropriation,
  creditAppropriation,
  getDefenseAppropriation,
} from "@/lib/db/collections/defenseAppropriation";
import { emitTx } from "@/lib/financialTxLog/emit";

// `canSupply` moved to `@/lib/military/defenceFillEligibility`, which is now the ONE place
// fill eligibility is decided - the award picker, the award route, the CEO's accept and this
// sweep all ask it the same question so that awardable means deliverable. Re-exported because
// several callers already import it from here.
export { canSupply };

export interface DeliveryResult {
  lots: number;
  paid: number;
  /** Contracts that could not deliver — retooled plant, foreign supplier, currency mismatch. */
  stalled: number;
  /** Production cost the suppliers bore on what they delivered. */
  productionCost: number;
}

/**
 * Per-turn: every active contract delivers what its plant produced into the arsenal, paid for
 * out of the defence appropriation.
 *
 * Three caps apply, in this order:
 *   1. what the plant produced       — you cannot deliver what you did not build
 *   2. what remains on the order     — a contract never over-delivers what it was billed for
 *   3. what the appropriation covers — procurement has NO overdraft
 *
 * Cap 3 stalls rather than borrowing: C1 established the overdraft is for upkeep, an
 * obligation already incurred, never for new purchases. A country that cannot pay this turn
 * takes fewer lots and the contract waits.
 *
 * **Payment precedes recording, deliberately.** Recording first would need a rollback on a
 * failed debit, and `advanceContract` clamps negatives to zero — so the "rollback" would be a
 * silent no-op that left the buyer credited with materiel they never paid for. Debiting first
 * means every failure mode is an over-payment, and an over-payment is refundable — which the
 * unwind ladder around the deposit does, reclaiming lots and refunding only what the country
 * did not end up keeping.
 *
 * @param currentYear the world's game YEAR (not turn), which gates the tech decades a
 *   corporation may count toward its grade ceiling.
 * @param maxGrade era ceiling on delivered grade, mirroring the seeder's `MAX_TECH_TIER_BY_ERA`
 *   so a 1953 world cannot be handed modern kit through a contract either.
 */
export async function applyDefenceDeliveries(
  db: Db,
  countryId: string,
  currentYear: number,
  maxGrade = 3,
  currentTurn = 0
): Promise<DeliveryResult> {
  const contracts = await listActiveContracts(db, countryId);
  if (contracts.length === 0) return { lots: 0, paid: 0, stalled: 0, productionCost: 0 };

  let lots = 0;
  let paid = 0;
  let stalled = 0;
  let productionCost = 0;
  /** sectorId -> lots delivered this turn, summed across that plant's contracts. */
  const divertedBySector = new Map<string, { sector: CorporateSector; lots: number }>();

  for (const contract of contracts) {
    const [sector, corp] = await Promise.all([
      db.collection<CorporateSector>("corporateSectors").findOne({ _id: contract.sectorId }),
      db.collection<Corporation>("corporations").findOne({ _id: contract.corporationId }),
    ]);
    if (!sector || !corp) {
      stalled++;
      continue;
    }

    // ONE eligibility question, asked here exactly as the award picker and the routes ask it.
    // The component check inside it is the frozen-component rule: a CEO who re-tools mid
    // contract makes the order undeliverable rather than silently shipping tanks against an
    // order for submarines.
    const fill = resolveFillEligibility({
      corp,
      sector,
      countryId,
      currentYear,
      component: contract.component,
      assignedFactories: contract.assignedFactories,
    });
    const components = fill.components;
    if (!fill.eligible) {
      stalled++;
      await stampDeliveryCarry(
        db,
        contract._id as ObjectId,
        contract.deliveryCarry ?? 0,
        "supplier_ineligible",
        currentTurn
      );
      continue;
    }

    // Throughput is the plant's output scaled by the production lines the CONTRACTOR assigned
    // to this order (suggestion #281), not an even split across every contract it holds. The
    // old even split let two contracts on one plant each take its FULL per-component share, so
    // the plant was paid twice for materiel it built once.
    const assigned =
      contract.assignedFactories ??
      defaultFactoryAllocation(components.length, DEFENCE_FACTORY_SLOTS_PER_PLANT);
    const rawShare = contractLotsThisTurn(rawLotsFromSector(sector), assigned);
    const carried = contract.deliveryCarry ?? 0;
    const available = carried + rawShare;
    const produced = Math.floor(available);

    const remaining = Math.max(0, contract.lotsOrdered - contract.lotsDelivered);
    // The contract's OWN encumbrance is the funding envelope, not the whole pot: the money was
    // committed at award and this turn draws it down. Falling back to the uncommitted balance
    // keeps legacy contracts (awarded before encumbrance existed) delivering rather than
    // stalling forever on a reservation they never had.
    const appropriation = await getDefenseAppropriation(db, countryId);
    const funding =
      (contract.encumberedAmount ?? 0) > 0
        ? Math.min(contract.encumberedAmount ?? 0, Math.max(0, appropriation.balance))
        : Math.max(0, appropriation.balance - (appropriation.encumbered ?? 0));
    const affordable =
      contract.pricePerLot > 0 ? Math.floor(funding / contract.pricePerLot) : produced;

    const deliverable = Math.min(produced, remaining, affordable);
    // The carry banks everything the plant built and did NOT ship, whole lots included, capped
    // at what the order still needs. Banking only the sub-lot remainder destroyed finished lots:
    // a plant under one lot per turn spent ~10 turns accruing a lot, the appropriation could not
    // afford it that turn, and the whole lot was thrown away while the contract sat at zero
    // delivered forever (ticket #1099). Output already built waits in the yard for money; the
    // cap stops a stalled order stockpiling past what it was billed for.
    const bankFor = (shipped: number) =>
      Math.max(0, Math.min(available - shipped, remaining - shipped));
    // Every boundary now names itself. A contract that ships nothing must still say why, or
    // the CEO is back to watching a number sit still with no way to tell scarcity from a bug.
    const reasonFor = (shipped: number) => {
      if (available - shipped >= 1 && affordable <= shipped) return "appropriation_short" as const;
      if (remaining - shipped <= 0) return undefined;
      if (available - shipped > 0 && available - shipped < 1) {
        return rawShare > 0 ? ("sub_lot_output" as const) : ("no_output" as const);
      }
      if (available - shipped >= 1) return "order_remainder" as const;
      return rawShare > 0 ? undefined : ("no_output" as const);
    };

    const newCarry = bankFor(deliverable);
    if (deliverable <= 0) {
      await stampDeliveryCarry(db, contract._id as ObjectId, newCarry, reasonFor(0), currentTurn);
      continue;
    }

    const cost = deliverable * contract.pricePerLot;
    // Claim the key BEFORE the money moves. Mongo runs single-node here, so a delivery is
    // three writes with no transaction around them; a re-run turn would otherwise pay the same
    // contract twice. A claim taken after the transfer leaves precisely the window that makes
    // the retry unsafe.
    const claimKey = deliveryClaimKey(contract._id.toString(), currentTurn);
    const claimed =
      cost > 0
        ? await claimDefenceMoneyMove(db, claimKey, {
            countryId,
            contractId: contract._id.toString(),
            turn: currentTurn,
            amount: cost,
          })
        : true;
    if (!claimed) {
      await stampDeliveryCarry(
        db,
        contract._id as ObjectId,
        carried,
        "already_settled_this_turn",
        currentTurn
      );
      continue;
    }

    await stampDeliveryCarry(
      db,
      contract._id as ObjectId,
      newCarry,
      reasonFor(deliverable),
      currentTurn
    );

    // A contract that reserved money DRAWS ITS OWN COMMITMENT DOWN; one awarded before
    // encumbrance existed spends from the uncommitted balance the way it always did. Legacy
    // orders must keep delivering - retiring them on a reservation they were never given would
    // strand materiel players already paid politically for.
    const encumbered = (contract.encumberedAmount ?? 0) > 0;
    const payDelivery = (amount: number) =>
      encumbered
        ? settleEncumbrance(db, countryId, amount)
        : debitAppropriation(db, countryId, amount);
    const refundDelivery = async (amount: number) => {
      if (encumbered) await unsettleEncumbrance(db, countryId, amount);
      else await creditAppropriation(db, countryId, amount);
    };

    if (cost > 0 && !(await payDelivery(cost))) {
      // Lost the balance to a concurrent order between the read and the settlement. Nothing has
      // been recorded yet, so there is nothing to unwind - but the carry must go back to what
      // it was, or the lots this turn built would be written off against a shipment that never
      // happened.
      await stampDeliveryCarry(
        db,
        contract._id as ObjectId,
        bankFor(0),
        "appropriation_short",
        currentTurn
      );
      continue;
    }

    const recorded = await advanceContract(db, contract._id as ObjectId, deliverable);
    if (recorded < deliverable) {
      // The contract clamped below what was paid for (a concurrent delivery took the
      // remainder). Put the difference back on BOTH books - balance and commitment - rather
      // than keeping money for undelivered lots or quietly freeing a commitment still owed.
      await refundDelivery((deliverable - recorded) * contract.pricePerLot);
      // Those lots were built but never shipped, so they go back into the bank rather than
      // being destroyed by the carry stamped for the larger figure.
      await stampDeliveryCarry(
        db,
        contract._id as ObjectId,
        bankFor(recorded),
        reasonFor(recorded),
        currentTurn
      );
    }
    if (recorded <= 0) continue;

    const grade = deliveredGrade({
      corpGradeCeiling: fill.gradeCeiling,
      contractGradeCeiling: contract.gradeCeiling,
      eraMaxGrade: maxGrade,
    });
    const actualCost = recorded * contract.pricePerLot;
    // What the lots COST the supplier to build. Without this leg the whole contract price was
    // free cash: liquid capital rose one-for-one with the appropriation drained, which is both
    // an economy-wide money mint and a direct contaminant of the market-cap series. Payment is
    // margin, and a plant that took a bad price genuinely loses money on the order.
    const unitCost = lotProductionCost(sector.strategyId) ?? 0;
    const buildCost = Math.max(0, Math.round(unitCost * recorded));

    // The buyer's money has already left the pot, so from here every failure must unwind or
    // it is destroyed outright. Neither write is transactional with the debit, so the
    // handler reclaims what it can and refunds exactly the lots the country did not keep.
    let deposited = 0;
    try {
      await depositLots(db, countryId, contract.component, recorded, grade);
      deposited = recorded;
      // Net of the build cost, in ONE write. Crediting the price and debiting the cost
      // separately would leave a window where the supplier's balance carries the gross figure,
      // and that window is exactly when the market-cap snapshot runs.
      await db
        .collection<Corporation>("corporations")
        .updateOne({ _id: corp._id }, { $inc: { liquidCapital: actualCost - buildCost } });
      await recordContractPayment(db, contract._id as ObjectId, actualCost, buildCost);
      // Only NOW is the remaining commitment known. A finished order stops holding budget; the
      // residue is rounding (the encumbrance is struck in whole lots at a rounded price) but a
      // country running a hundred contracts would otherwise carry a hundred small permanent
      // commitments it can never spend again.
      if (contract.lotsDelivered + recorded >= contract.lotsOrdered) {
        await releaseContractEncumbrance(db, contract._id as ObjectId);
      }
      const currencyCode = resolveCorpLiquidCurrencyCode(corp);
      if (currencyCode) {
        await emitTx(db, {
          type: "defence_contract_payment",
          turn: currentTurn,
          createdAt: new Date(),
          subjectType: "corporation",
          subjectId: corp._id,
          subjectName: corp.name,
          amount: actualCost,
          currencyCode,
          counterpartyType: "system",
          counterpartyName: `${countryId} defence appropriation`,
          meta: {
            contractId: contract._id.toString(),
            countryId,
            sectorId: sector._id.toString(),
            component: contract.component,
            lots: recorded,
            pricePerLot: contract.pricePerLot,
            grade,
            productionCost: buildCost,
            netMargin: actualCost - buildCost,
          },
        });
      }
    } catch {
      // Pull back anything that landed before the failure. `drawLots` reports what it
      // actually took, so lots a concurrent order already consumed stay bought and paid for
      // rather than being refunded twice.
      const reclaimed =
        deposited > 0 ? await drawLots(db, countryId, contract.component, deposited) : 0;
      const unfunded = recorded - deposited + reclaimed;
      if (unfunded > 0) {
        await refundDelivery(unfunded * contract.pricePerLot);
      }
      // One broken contract must not take down the sweep for every other country.
      stalled++;
      continue;
    }

    lots += recorded;
    paid += actualCost;
    productionCost += buildCost;
    const key = sector._id.toString();
    const prior = divertedBySector.get(key);
    divertedBySector.set(key, {
      sector,
      lots: (prior?.lots ?? 0) + recorded,
    });
  }

  // Stamp what left the market. Output shipped to an arsenal must not also be sold to the
  // world, so this share is deducted from both the plant's revenue and its supply
  // contribution next turn. The turn stamp is what makes it expire on its own when a
  // contract completes or is cancelled — no sweep has to go and clear it.
  if (divertedBySector.size > 0) {
    await db.collection<CorporateSector>("corporateSectors").bulkWrite(
      [...divertedBySector.values()].map(({ sector, lots: delivered }) => ({
        updateOne: {
          filter: { _id: sector._id },
          update: {
            $set: {
              militaryDivertedFraction: militaryDivertedShare(sector, delivered),
              militaryDivertedTurn: currentTurn,
            },
          },
        },
      }))
    );
  }

  return { lots, paid, stalled, productionCost };
}
