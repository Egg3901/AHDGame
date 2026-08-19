import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { SEED_UPKEEP_TARGET_SHARE } from "@/lib/military/appropriation";
import { defenceSupplierCapShare } from "@/lib/military/defenceContractLimits";

/**
 * How fast the defence appropriation may be paid OUT to suppliers, per turn.
 *
 * ## The drain this closes
 *
 * A delivery credits the supplier `pricePerLot - productionCost` per lot. Measured on the live
 * world at turn 219, a US air lot was struck at 383,748,809 and cost 1,091 to build: the margin
 * is 99.9997% of the contract price. The price band is bounded at the top by the GDP anchor
 * (`lotPrice`), which sits five orders of magnitude above what a lot actually costs to make, so
 * a defence contract is very close to a pure transfer of national appropriation into one
 * corporation's cash balance. That is the "Lockheed drain", and a minister with a stake in the
 * supplier is the party who benefits.
 *
 * The award side already limits the TOTAL a supplier may be promised in a 12-turn contracting
 * window (`defenceContractLotCaps`). What it never limited is the RATE at which that promise
 * settles. On turn 214 a single Soviet contract delivered 5 lots at 938,828,685 and moved
 * 4,694,136,047 in one turn, which was the country's ENTIRE quarterly procurement window,
 * emptied in one tick. Throughput is the only thing that governed it, and giving state industry
 * every production line at award (ticket #1134) multiplies exactly that throughput by four.
 *
 * ## The cap
 *
 * Payout per turn is bounded by the appropriation's own procurement income:
 *
 *   accrual/turn  = defenceLine x (1 - SEED_UPKEEP_TARGET_SHARE) / TURNS_PER_YEAR
 *   country cap   = accrual/turn x DEFENCE_TURN_SPEND_BURST
 *   supplier cap  = country cap x defenceSupplierCapShare(stateOwned)
 *
 * ## Why this is not a new wall (ticket #1134)
 *
 * A contracting window is 12 turns, so over one full window the per-turn allowance sums to
 * `12 x 3 x notional/12 = 3 x notional`: THREE TIMES the total that window's award quota lets a
 * country commit in the first place, and three times the supplier quota for any one supplier,
 * whatever its share. The cap therefore cannot reduce what a legitimate buyer spends across a
 * window. It only stops the whole quota landing in one or two turns.
 *
 * Checked against real suppliers rather than asserted:
 *   US, defence line 61.4bn, accrual 575.6m/turn, country cap 1.727bn/turn.
 *     Private supplier cap 575.6m/turn = 1 lot/turn at 383.7m. The two live US suppliers were
 *     each taking exactly 1 lot/turn, so neither loses a single lot.
 *   RU, notional 4.694bn/window, accrual 391.2m/turn, country cap 1.174bn/turn.
 *     State industry takes the whole country cap. The 5-lot burst above now settles over four
 *     turns instead of one, and the window total is unchanged.
 *   UK, defence line 1.394bn, accrual 13.1m/turn, country cap 39.2m/turn = 4 lots/turn at
 *     9.29m. The live UK supplier ships 1 lot/turn.
 */

/**
 * Turns of procurement income the appropriation may pay out in a single turn.
 *
 * Three rather than one because a country that has been saving must be able to spend the
 * stockpile faster than it earned it, which is the whole point of holding a balance. Three
 * rather than twelve because at twelve the cap is the window quota again and bounds nothing.
 */
export const DEFENCE_TURN_SPEND_BURST = 3;

/**
 * The procurement half of one turn's defence income.
 *
 * Deliberately the same identity `defenceContractLotCaps` uses for a whole window, divided by
 * the window length, so the award quota and the payout cap can never drift apart: upkeep takes
 * `SEED_UPKEEP_TARGET_SHARE` and procurement gets the rest.
 */
export function defenceProcurementAccrualPerTurn(defenceLine: number): number {
  if (!(defenceLine > 0)) return 0;
  return (defenceLine * (1 - SEED_UPKEEP_TARGET_SHARE)) / TURNS_PER_YEAR;
}

/** Most the whole appropriation may pay suppliers this turn. */
export function defenceCountryTurnSpendCap(defenceLine: number): number {
  return defenceProcurementAccrualPerTurn(defenceLine) * DEFENCE_TURN_SPEND_BURST;
}

/**
 * Most ONE supplier may be paid this turn.
 *
 * Reuses the award side's share so the two caps say the same thing about who may take how
 * much: a third of the country for private industry, all of it for a National Corporation,
 * which has no player CEO to enrich (ticket #1134).
 */
export function defenceSupplierTurnSpendCap(defenceLine: number, stateOwned: boolean): number {
  return defenceCountryTurnSpendCap(defenceLine) * defenceSupplierCapShare(stateOwned);
}

/**
 * Lots this contract may settle now, given what the country and the supplier have already been
 * paid this turn.
 *
 * The one-lot floor is the anti-deadlock rule, and it is per COUNTRY per turn, not per
 * contract. A small country whose lot price exceeds its entire turn cap would otherwise never
 * ship anything at all - the exact one-plant wall ticket #1134 is about - while a per-contract
 * floor would hand the drain a new channel: award twenty contracts, ship twenty free lots.
 * Nothing has been paid yet when it applies, so it can never stack.
 */
export function lotsWithinTurnSpendCap(input: {
  pricePerLot: number;
  countryTurnCap: number;
  supplierTurnCap: number;
  countryPaidThisTurn: number;
  supplierPaidThisTurn: number;
}): number {
  const { pricePerLot, countryPaidThisTurn } = input;
  if (!(pricePerLot > 0)) return Number.POSITIVE_INFINITY;
  const remaining = Math.min(
    input.countryTurnCap - countryPaidThisTurn,
    input.supplierTurnCap - input.supplierPaidThisTurn
  );
  const lots = remaining > 0 ? Math.floor(remaining / pricePerLot) : 0;
  if (lots > 0) return lots;
  return countryPaidThisTurn <= 0 ? 1 : 0;
}
