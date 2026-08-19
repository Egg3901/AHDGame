import { describe, expect, it } from "vitest";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import {
  DEFENCE_TURN_SPEND_BURST,
  defenceCountryTurnSpendCap,
  defenceProcurementAccrualPerTurn,
  defenceSupplierTurnSpendCap,
  lotsWithinTurnSpendCap,
} from "./defenceTurnSpendCap";
import { DEFENCE_CONTRACT_WINDOW_TURNS, defenceContractLotCaps } from "./defenceContractLimits";

/** The live US figures the cap was calibrated against (see the module docstring). */
const US_DEFENCE_LINE = 61_399_809_440;
const US_LOT_PRICE = 383_748_809;
/** Live Soviet figures: the 5-lot, 4.69bn single-turn burst on turn 214. */
const RU_DEFENCE_LINE = 41_725_719_333;
const RU_LOT_PRICE = 938_828_685;

describe("defenceProcurementAccrualPerTurn", () => {
  it("is the procurement half of the defence line, per turn", () => {
    expect(defenceProcurementAccrualPerTurn(48_000)).toBeCloseTo((48_000 * 0.45) / TURNS_PER_YEAR);
  });

  it("returns nothing for an unusable line rather than guessing", () => {
    expect(defenceProcurementAccrualPerTurn(0)).toBe(0);
    expect(defenceProcurementAccrualPerTurn(-1)).toBe(0);
    expect(defenceProcurementAccrualPerTurn(Number.NaN)).toBe(0);
  });

  // The one invariant that keeps the award quota and the payout cap from drifting: a whole
  // window's accrual IS the window's award notional.
  it("sums over a contracting window to exactly the window's procurement notional", () => {
    const { procurementNotional } = defenceContractLotCaps(US_DEFENCE_LINE, US_LOT_PRICE);
    const overWindow =
      defenceProcurementAccrualPerTurn(US_DEFENCE_LINE) * DEFENCE_CONTRACT_WINDOW_TURNS;
    expect(overWindow).toBeCloseTo(procurementNotional, 3);
  });
});

describe("the cap cannot cost a legitimate buyer lots across a window", () => {
  // This is the anti-wall proof. Ticket #1134 was a player who could not spend his budget; the
  // fix must not swap one wall for another. Over a full window the per-turn allowance is a
  // multiple of the award quota, so the binding constraint on TOTAL spend stays the award side.
  it("allows three times the country award quota over a window", () => {
    const { procurementNotional } = defenceContractLotCaps(US_DEFENCE_LINE, US_LOT_PRICE);
    const overWindow = defenceCountryTurnSpendCap(US_DEFENCE_LINE) * DEFENCE_CONTRACT_WINDOW_TURNS;
    expect(overWindow).toBeCloseTo(procurementNotional * DEFENCE_TURN_SPEND_BURST, 3);
    expect(overWindow).toBeGreaterThan(procurementNotional);
  });

  it("allows three times the supplier award quota over a window, private or state", () => {
    const { procurementNotional } = defenceContractLotCaps(US_DEFENCE_LINE, US_LOT_PRICE);
    for (const stateOwned of [false, true]) {
      const share = stateOwned ? 1 : 1 / 3;
      const overWindow =
        defenceSupplierTurnSpendCap(US_DEFENCE_LINE, stateOwned) * DEFENCE_CONTRACT_WINDOW_TURNS;
      expect(overWindow).toBeCloseTo(procurementNotional * share * DEFENCE_TURN_SPEND_BURST, 3);
    }
  });

  it("leaves the live US suppliers their full one lot a turn", () => {
    const lots = lotsWithinTurnSpendCap({
      pricePerLot: US_LOT_PRICE,
      countryTurnCap: defenceCountryTurnSpendCap(US_DEFENCE_LINE),
      supplierTurnCap: defenceSupplierTurnSpendCap(US_DEFENCE_LINE, false),
      countryPaidThisTurn: 0,
      supplierPaidThisTurn: 0,
    });
    expect(lots).toBeGreaterThanOrEqual(1);
  });

  it("lets several plants under one roof ship together up to the supplier cap", () => {
    const countryTurnCap = defenceCountryTurnSpendCap(US_DEFENCE_LINE);
    const supplierTurnCap = defenceSupplierTurnSpendCap(US_DEFENCE_LINE, false);
    // A cheap lot, which is what a multi-factory buyer ordering grade-0 mass actually has.
    const pricePerLot = 20_000_000;
    let shipped = 0;
    let paid = 0;
    for (let plant = 0; plant < 12; plant++) {
      const lots = lotsWithinTurnSpendCap({
        pricePerLot,
        countryTurnCap,
        supplierTurnCap,
        countryPaidThisTurn: paid,
        supplierPaidThisTurn: paid,
      });
      const take = Math.min(1, lots);
      shipped += take;
      paid += take * pricePerLot;
    }
    // Twelve plants, one lot each, all of them ship: the cap is nowhere near a one-plant wall.
    expect(shipped).toBe(12);
  });
});

describe("the drain is capped", () => {
  // Turn 214 on the live world: one Soviet contract moved 4,694,136,047 into a single
  // supplier's cash in ONE turn, which was that country's entire quarterly procurement window.
  it("refuses to settle a whole contracting window in one turn", () => {
    const lots = lotsWithinTurnSpendCap({
      pricePerLot: RU_LOT_PRICE,
      countryTurnCap: defenceCountryTurnSpendCap(RU_DEFENCE_LINE),
      supplierTurnCap: defenceSupplierTurnSpendCap(RU_DEFENCE_LINE, true),
      countryPaidThisTurn: 0,
      supplierPaidThisTurn: 0,
    });
    expect(lots).toBeLessThan(5);
    expect(lots * RU_LOT_PRICE).toBeLessThan(4_694_136_047);
  });

  it("caps a high-throughput plant far below what it could build", () => {
    // Twenty lots a turn of plant output against a 383.7m lot: 7.7bn a turn uncapped.
    const lots = lotsWithinTurnSpendCap({
      pricePerLot: US_LOT_PRICE,
      countryTurnCap: defenceCountryTurnSpendCap(US_DEFENCE_LINE),
      supplierTurnCap: defenceSupplierTurnSpendCap(US_DEFENCE_LINE, false),
      countryPaidThisTurn: 0,
      supplierPaidThisTurn: 0,
    });
    expect(Math.min(20, lots)).toBeLessThan(20);
    expect(lots * US_LOT_PRICE).toBeLessThanOrEqual(
      defenceSupplierTurnSpendCap(US_DEFENCE_LINE, false)
    );
  });

  it("stops a supplier taking a second bite once it has used its turn allowance", () => {
    const supplierTurnCap = defenceSupplierTurnSpendCap(US_DEFENCE_LINE, false);
    expect(
      lotsWithinTurnSpendCap({
        pricePerLot: US_LOT_PRICE,
        countryTurnCap: defenceCountryTurnSpendCap(US_DEFENCE_LINE),
        supplierTurnCap,
        countryPaidThisTurn: supplierTurnCap,
        supplierPaidThisTurn: supplierTurnCap,
      })
    ).toBe(0);
  });

  // The anti-deadlock floor must not become the exploit. It is per country per turn, so a
  // minister cannot open twenty contracts and collect twenty free lots.
  it("grants the one-lot floor once per country per turn and never again", () => {
    const args = {
      pricePerLot: 10_000_000_000,
      countryTurnCap: defenceCountryTurnSpendCap(US_DEFENCE_LINE),
      supplierTurnCap: defenceSupplierTurnSpendCap(US_DEFENCE_LINE, false),
      supplierPaidThisTurn: 0,
    };
    expect(lotsWithinTurnSpendCap({ ...args, countryPaidThisTurn: 0 })).toBe(1);
    expect(lotsWithinTurnSpendCap({ ...args, countryPaidThisTurn: 1 })).toBe(0);
  });

  it("still ships one lot a turn for a country with no usable defence line", () => {
    expect(
      lotsWithinTurnSpendCap({
        pricePerLot: 5_000,
        countryTurnCap: defenceCountryTurnSpendCap(0),
        supplierTurnCap: defenceSupplierTurnSpendCap(0, false),
        countryPaidThisTurn: 0,
        supplierPaidThisTurn: 0,
      })
    ).toBe(1);
  });

  it("does not constrain a priceless contract, which the affordability cap already handles", () => {
    expect(
      lotsWithinTurnSpendCap({
        pricePerLot: 0,
        countryTurnCap: 1,
        supplierTurnCap: 1,
        countryPaidThisTurn: 0,
        supplierPaidThisTurn: 0,
      })
    ).toBe(Number.POSITIVE_INFINITY);
  });
});
