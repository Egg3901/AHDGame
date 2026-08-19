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
  normalizeGrade,
  DEFENCE_FACTORY_SLOTS_PER_PLANT,
  GRADE_PRICE_SCALE,
} from "@/lib/military/defenceLotEconomics";
import {
  listActiveContracts,
  advanceContract,
  reverseContractDelivery,
  stampDeliveryCarry,
  recordContractPayment,
  releaseContractEncumbrance,
} from "@/lib/db/collections/defenceContracts";
import { depositLots } from "@/lib/db/collections/nationalArsenal";
import {
  drawDownEncumbrance,
  getDefenseAppropriation,
} from "@/lib/db/collections/defenseAppropriation";
import { applyMoneyMove, MONEY_MOVE_COLLECTION, type MoneyMoveLeg } from "@/lib/banking/moneyMove";
import { loadDefencePriceRatios } from "@/lib/military/defencePriceRatios";
import {
  defenceCountryTurnSpendCap,
  defenceSupplierTurnSpendCap,
  lotsWithinTurnSpendCap,
} from "@/lib/military/defenceTurnSpendCap";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { resolveDefenseLine } from "@/lib/turn/defenseEnvelope";
import { emitTx } from "@/lib/financialTxLog/emit";

/**
 * Idempotency key for one contract's settlement in one turn.
 *
 * A contract settles at most once per turn, forever. Same key means the same move, so a re-run
 * turn (a crashed sweep, an operator repeat, two overlapping turn processes) replays instead of
 * paying twice.
 */
export function defenceDeliveryMoveKey(contractId: string, turn: number): string {
  return `defence-delivery:${contractId}:${turn}`;
}

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
 * Four caps apply, in this order:
 *   1. what the plant produced       — you cannot deliver what you did not build
 *   2. what remains on the order     — a contract never over-delivers what it was billed for
 *   3. what the appropriation covers — procurement has NO overdraft
 *   4. what the appropriation may pay THIS TURN: procurement has no overdraft and no
 *      floodgate either, so a whole contracting window cannot settle in one tick
 *
 * Cap 3 stalls rather than borrowing: C1 established the overdraft is for upkeep, an
 * obligation already incurred, never for new purchases. A country that cannot pay this turn
 * takes fewer lots and the contract waits.
 *
 * **Recording precedes payment, and that is a REVERSAL of the old order.** It used to pay
 * first, because `advanceContract` clamps and a rollback after a failed debit would have been a
 * silent no-op leaving the buyer credited with materiel they never paid for. That reasoning
 * held only while the debit was a bare guarded `$inc` that could half-land. The money now goes
 * through `applyMoneyMove`, which claims its key before anything moves, guards the debit inside
 * the write, and reports a refused move having touched NOTHING - so a payment that does not
 * land leaves exactly one thing to unwind, the lot record, and `reverseContractDelivery` undoes
 * it exactly. One unwind beats the old three-step ladder of refund, reclaim and re-bank.
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

  // ONE read of each per country per turn, replacing a read inside the per-contract loop.
  //
  // Safe precisely because the read is only used to PLAN. Every debit is guarded inside its own
  // write by `applyMoneyMove`, so the authoritative "is the money there" question is still
  // asked at the moment of payment; the projection below just keeps the plan honest as the
  // sweep spends, so a country with ten contracts does not plan all ten against the same
  // opening balance and then have nine of them refused into the repair queue.
  const opening = await getDefenseAppropriation(db, countryId);
  const priceRatios = await loadDefencePriceRatios(db);
  // The payout speed limit. ONE read of the defence line per country per turn, alongside the
  // appropriation read above, because the cap is a rate against that line and nothing in the
  // loop can move it. See `defenceTurnSpendCap` for the drain this bounds and the arithmetic
  // showing it cannot cost a legitimate buyer a lot across a contracting window.
  const defenceLine = await resolveDefenseLine(db, countryId);
  const countryTurnCap = defenceCountryTurnSpendCap(defenceLine);
  let countryPaidThisTurn = 0;
  /** corporationId -> local currency already paid to that supplier this turn. */
  const supplierPaidThisTurn = new Map<string, number>();
  let projectedBalance = opening.balance;
  let projectedEncumbered = opening.encumbered ?? 0;
  const moveRecords = db.collection<{ _id: string }>(MONEY_MOVE_COLLECTION);

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
    const funding =
      (contract.encumberedAmount ?? 0) > 0
        ? Math.min(contract.encumberedAmount ?? 0, Math.max(0, projectedBalance))
        : Math.max(0, projectedBalance - projectedEncumbered);
    const affordable =
      contract.pricePerLot > 0 ? Math.floor(funding / contract.pricePerLot) : produced;

    // Cap 4: how fast the appropriation may be DRAINED, as opposed to how much of it is there.
    // Caps 1 to 3 all say "you may have this much money"; none of them says "not this fast", and
    // the whole contracting window settling in a single turn is what made procurement a cash tap
    // worth freezing.
    const supplierKey = contract.corporationId.toString();
    const withinTurnCap = lotsWithinTurnSpendCap({
      pricePerLot: contract.pricePerLot,
      countryTurnCap,
      supplierTurnCap: defenceSupplierTurnSpendCap(defenceLine, isStateOwned(corp)),
      countryPaidThisTurn,
      supplierPaidThisTurn: supplierPaidThisTurn.get(supplierKey) ?? 0,
    });

    const deliverable = Math.min(produced, remaining, affordable, withinTurnCap);
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
      if (available - shipped >= 1 && withinTurnCap <= shipped) return "turn_spend_cap" as const;
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

    const moveKey = defenceDeliveryMoveKey(contract._id.toString(), currentTurn);
    // Cheap pre-check on the claim record. `applyMoneyMove` is authoritative and will replay a
    // known key without moving a penny, but it claims the key INSIDE itself, and by then the
    // lot record has already been written. Reading first catches the ordinary re-run turn
    // before any work is done; a genuine race still loses the insert below and unwinds.
    if (await moveRecords.findOne({ _id: moveKey }, { projection: { _id: 1 } })) {
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

    // The lot ledger goes FIRST now. It clamps to what the order still has outstanding, so it
    // can never over-record, and it yields the authoritative count the money is then moved for.
    // Paying for `deliverable` and discovering the contract only accepted `recorded` was the
    // source of the old refund-and-re-bank ladder; there is nothing to refund if nothing has
    // been paid yet.
    const recorded = await advanceContract(db, contract._id as ObjectId, deliverable);
    if (recorded < deliverable) {
      // A concurrent delivery took part of the remainder. Those lots were built but not
      // shipped, so they go back into the bank rather than being written off.
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
    // What the lots COST the supplier to build, at LIVE input prices. Without this leg the
    // whole contract price was free cash: liquid capital rose one-for-one with the
    // appropriation drained, which is both an economy-wide money mint and a direct contaminant
    // of the market-cap series. Payment is margin, and a plant that took a bad price genuinely
    // loses money on the order - which is now a thing the commodity market can cause.
    // Build cost scales with the DELIVERED grade, mirroring the band the contract was priced
    // in (lotPriceBand grades productionCost by GRADE_PRICE_SCALE). Charging ungraded cost
    // here made every grade-0 contract underwater from turn one even at the band floor
    // (floor 0.784x cost vs cost 1.0x), and over-credited grade-3 deliveries by the 1.25x
    // the band charged but the build never paid.
    // Costed off the CONTRACT's stored `pricePerLot`, never the live anchor. Cost is a share
    // of price (ticket #1134), so a signed order keeps the margin it was struck at even if the
    // country's GDP has moved since - which is the same promise `pricePerLot` itself makes.
    const unitCost = lotProductionCost(sector.strategyId, contract.pricePerLot, priceRatios) ?? 0;
    const gradedUnitCost = unitCost * GRADE_PRICE_SCALE[normalizeGrade(grade)];
    const buildCost = Math.max(0, Math.round(gradedUnitCost * recorded));
    const margin = actualCost - buildCost;

    // Live input prices mean a contract CAN go underwater after it was signed: the band's floor
    // held on the day it was struck, and steel moved. That is a real outcome, not an error, so
    // it is modelled rather than clamped away - but a supplier that cannot fund the loss must
    // not deliver into a debit that would strand the move half-applied. Checked here, before
    // anything moves, so the refusal is a clean stall with a reason the CEO can act on.
    if (margin < 0 && (corp.liquidCapital ?? 0) < -margin) {
      await reverseContractDelivery(db, contract._id as ObjectId, recorded);
      await stampDeliveryCarry(
        db,
        contract._id as ObjectId,
        bankFor(0),
        "supplier_cannot_fund_loss",
        currentTurn
      );
      stalled++;
      continue;
    }

    // A contract that reserved money draws its OWN commitment down; one awarded before
    // encumbrance existed spends from the uncommitted appropriation the way it always did.
    // Legacy orders must keep delivering - retiring them on a reservation they were never
    // given would strand materiel players already paid politically for.
    const hasEncumbrance = (contract.encumberedAmount ?? 0) > 0;
    const legs: MoneyMoveLeg[] = [
      {
        kind: "debit",
        amount: actualCost,
        collection: "federalBudget",
        // The primitive adds its own `$gte` on the path, which is the no-overdraft rule. The
        // `$expr` here is the SECOND guard and the one that matters for a legacy contract: it
        // keeps a spend out of appropriation another contract has already committed. An
        // encumbered contract is exempt because the money it is spending IS its own commitment,
        // so measuring it against uncommitted budget would refuse every settlement it makes.
        filter: hasEncumbrance
          ? { countryId }
          : {
              countryId,
              $expr: {
                $gte: [
                  {
                    $subtract: [
                      { $ifNull: ["$defenseAppropriation.balance", 0] },
                      { $ifNull: ["$defenseAppropriation.encumbered", 0] },
                    ],
                  },
                  actualCost,
                ],
              },
            },
        path: "defenseAppropriation.balance",
        note: `${countryId} defence appropriation pays for ${recorded} lots`,
      },
      // Margin, or the loss when input prices have overtaken the struck price. Same leg, and
      // the sign is the leg KIND's job rather than a negative amount the primitive would filter
      // out and then refuse for not netting to zero.
      margin >= 0
        ? {
            kind: "credit" as const,
            amount: margin,
            collection: "corporations",
            filter: { _id: corp._id },
            path: "liquidCapital",
            note: "supplier receives the margin on the delivery",
          }
        : {
            kind: "debit" as const,
            amount: -margin,
            collection: "corporations",
            filter: { _id: corp._id },
            path: "liquidCapital",
            note: "supplier funds the loss on a contract input prices have overtaken",
          },
      {
        // The materiel genuinely consumed inputs. Burning the build cost is what makes the
        // legs net to zero honestly instead of the supplier pocketing the gross price, and it
        // is the same statement the physical P&L makes when a plant buys commodities.
        kind: "burn",
        amount: buildCost,
        note: "commodity inputs and overhead consumed building the lots",
      },
    ];

    // A throwing collection must stall ONE contract, not the country. `applyMoneyMove` leaves
    // its record at `partial` when a leg throws mid-move, which is exactly the visible,
    // finishable state the repair queue exists for, so the throw is caught rather than allowed
    // to abort every remaining contract in the sweep.
    const move = await applyMoneyMove(db, {
      key: moveKey,
      kind: "defence_contract_delivery",
      turn: currentTurn,
      legs,
    }).catch(
      () =>
        ({
          status: "partial",
          applied: [],
          error: "a leg threw mid-move",
        }) as Awaited<ReturnType<typeof applyMoneyMove>>
    );

    if (move.status !== "applied") {
      // Nothing to reclaim from the arsenal: the lots have not been deposited yet. The one
      // thing written is the lot record, and it comes straight back off.
      //
      // A `partial` means the appropriation leg landed and the supplier's did not. That is
      // recorded in the repair queue with the legs that applied, which is the whole reason the
      // shared primitive exists - a half-applied move is visible and finishable rather than
      // silent money loss. The lot record still reverses either way: the country has not
      // received the materiel.
      await reverseContractDelivery(db, contract._id as ObjectId, recorded);
      await stampDeliveryCarry(
        db,
        contract._id as ObjectId,
        bankFor(0),
        move.status === "replayed" ? "already_settled_this_turn" : "appropriation_short",
        currentTurn
      );
      if (move.status === "partial") stalled++;
      continue;
    }

    projectedBalance -= actualCost;
    countryPaidThisTurn += actualCost;
    supplierPaidThisTurn.set(
      supplierKey,
      (supplierPaidThisTurn.get(supplierKey) ?? 0) + actualCost
    );

    // The MEMO leg. The cash has moved; this only discharges the reservation against it. It is
    // not part of the money move because nothing enters or leaves the world when a commitment
    // is discharged, and the primitive rightly refuses legs that do not net to zero. Failing
    // here leaves the commitment too high, so the country under-spends until it is reconciled:
    // the safe direction. Releasing before the cash moved would let the same money be committed
    // twice, which is the exploit itself.
    if (hasEncumbrance) {
      await drawDownEncumbrance(db, countryId, actualCost);
      projectedEncumbered = Math.max(0, projectedEncumbered - actualCost);
    }
    await recordContractPayment(db, contract._id as ObjectId, actualCost, buildCost);
    // Only NOW is the remaining commitment known. A finished order stops holding budget; the
    // residue is rounding (the encumbrance is struck in whole lots at a rounded price) but a
    // country running a hundred contracts would otherwise carry a hundred small permanent
    // commitments it can never spend again.
    if (contract.lotsDelivered + recorded >= contract.lotsOrdered) {
      const released = await releaseContractEncumbrance(db, contract._id as ObjectId);
      projectedEncumbered = Math.max(0, projectedEncumbered - released);
    }

    // The money is settled and the lots are recorded; the arsenal deposit is the last step and
    // the only one left that can fail. It is retried by nothing, so a failure reverses the lot
    // record and refunds through a paired money move rather than being swallowed.
    try {
      await depositLots(db, countryId, contract.component, recorded, grade);
    } catch {
      // depositLots is a single atomic $inc, so a throw means nothing landed. Drawing lots
      // back out here reclaimed from whatever the arsenal ALREADY held of this component:
      // a country with pre-existing stock lost `recorded` lots of it and was refunded the
      // contract on top. Nothing was deposited, so nothing is drawn; the reversal and the
      // paired refund below fully unwind the delivery.
      await reverseContractDelivery(db, contract._id as ObjectId, recorded);
      await recordContractPayment(db, contract._id as ObjectId, -actualCost, -buildCost);
      await applyMoneyMove(db, {
        key: `${moveKey}:refund`,
        kind: "defence_contract_delivery_refund",
        turn: currentTurn,
        legs: [
          // The exact mirror of the forward move's supplier leg, whichever way it ran. A refund
          // that always debited would credit a loss-making supplier twice.
          margin >= 0
            ? {
                kind: "debit" as const,
                amount: margin,
                collection: "corporations",
                filter: { _id: corp._id },
                path: "liquidCapital",
                note: "supplier returns the margin on materiel that never landed",
              }
            : {
                kind: "credit" as const,
                amount: -margin,
                collection: "corporations",
                filter: { _id: corp._id },
                path: "liquidCapital",
                note: "supplier is made whole for a loss on materiel that never landed",
              },
          {
            kind: "credit",
            amount: actualCost,
            collection: "federalBudget",
            filter: { countryId },
            path: "defenseAppropriation.balance",
            note: `${countryId} defence appropriation refunded`,
          },
          {
            kind: "mint",
            amount: buildCost,
            note: "inputs the supplier is no longer out of pocket for",
          },
        ],
      });
      projectedBalance += actualCost;
      // The refund gives the turn allowance back too, or a delivery that never landed would
      // still count against every later contract in the same sweep.
      countryPaidThisTurn = Math.max(0, countryPaidThisTurn - actualCost);
      supplierPaidThisTurn.set(
        supplierKey,
        Math.max(0, (supplierPaidThisTurn.get(supplierKey) ?? 0) - actualCost)
      );
      // One broken contract must not take down the sweep for every other country.
      stalled++;
      continue;
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
          netMargin: margin,
          moveKey,
        },
      });
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
