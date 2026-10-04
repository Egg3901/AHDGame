/**
 * Investment banks fund sovereign primary offers from spendable vault cash.
 * The reviewed maximum cost, original epoch and live unplaced units bound the
 * fill. The existing cash floor and equity leverage limit remain authoritative.
 */
import type { BankCharter } from "@/lib/db/types/bank";
import type { Bond } from "@/lib/db/types/bond";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { mayDistribute } from "./balanceSheet";
import { charterMay } from "./capabilities";
import { computePropEquityBase, PROP_LEVERAGE_MULTIPLE } from "./propLeverage";

export function quoteSovereignPrimaryBankPurchase(input: {
  charter: BankCharter;
  bond: Pick<
    Bond,
    | "issuerType"
    | "countryId"
    | "currencyCode"
    | "maturityTurn"
    | "matured"
    | "defaulted"
    | "unsoldUnits"
    | "couponRate"
    | "sovereignMaturityClaim"
  >;
  turn: number;
  requestedUnits: number;
  askPerUnit: number;
  bidPerUnit: number;
  maxCostLocal: number;
  floorLocal: number;
  playerDepositsAreLiabilities: boolean;
}):
  | { ok: true; units: number; cost: number; face: number; annualCoupon: number }
  | { ok: false; error: string } {
  const { charter, bond } = input;
  const cashReserves = charter.cashReserves ?? Number.NaN;
  if (!charterMay(charter, "proprietaryTrading"))
    return { ok: false, error: "An active investment or universal charter is required" };
  if (charter.capitalStanding && !mayDistribute(charter.capitalStanding))
    return { ok: false, error: "The bank must restore its supervisory capital before subscribing" };
  if (
    bond.issuerType !== "sovereign" ||
    !bond.countryId ||
    bond.currencyCode !== charter.currency ||
    bond.matured ||
    bond.defaulted ||
    bond.sovereignMaturityClaim ||
    bond.maturityTurn <= input.turn
  )
    return { ok: false, error: "Only live same-currency sovereign offers are eligible" };
  if (
    !Number.isSafeInteger(input.requestedUnits) ||
    input.requestedUnits <= 0 ||
    !Number.isSafeInteger(bond.unsoldUnits) ||
    !(bond.unsoldUnits! > 0) ||
    ![
      input.askPerUnit,
      input.bidPerUnit,
      input.maxCostLocal,
      input.floorLocal,
      charter.cashReserves,
      bond.couponRate,
    ].every(Number.isFinite) ||
    input.askPerUnit <= 0 ||
    input.bidPerUnit < 0 ||
    input.maxCostLocal <= 0 ||
    input.floorLocal < 0 ||
    bond.couponRate < 0
  )
    return { ok: false, error: "No valid executable sovereign primary quote is available" };
  const units = Math.min(
    input.requestedUnits,
    bond.unsoldUnits!,
    Math.floor(Math.max(0, cashReserves - input.floorLocal) / input.askPerUnit)
  );
  const cost = Math.round(units * input.askPerUnit * 100) / 100;
  if (units <= 0) return { ok: false, error: "No cash is available above the bank treasury floor" };
  if (cost > input.maxCostLocal + 1e-9)
    return { ok: false, error: "Cash quote changed; review the sovereign offer again" };
  const mark = units * input.bidPerUnit;
  const nextTreasuryMark = Math.max(0, charter.sovereignTreasuryMarkValue ?? 0) + mark;
  const equity = computePropEquityBase(
    cashReserves - cost,
    { ...charter, sovereignTreasuryMarkValue: nextTreasuryMark },
    undefined,
    { playerDepositsAreLiabilities: input.playerDepositsAreLiabilities }
  );
  if (
    !(equity > 0) ||
    nextTreasuryMark + Math.max(0, charter.propBookMarkValue ?? 0) >
      PROP_LEVERAGE_MULTIPLE * equity + 1e-9
  )
    return { ok: false, error: "Subscription would breach the bank equity leverage limit" };
  const face = units * BOND_UNIT_FACE_VALUE;
  return { ok: true, units, cost, face, annualCoupon: (face * bond.couponRate) / 100 };
}
