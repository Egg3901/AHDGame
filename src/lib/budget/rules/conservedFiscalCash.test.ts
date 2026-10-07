import { describe, expect, it } from "vitest";
import { checkBalancedTransfer } from "@/lib/banking/rules/invariants";
import {
  conservationResidual,
  conservedPoolFlowTransition,
  householdTaxTransition,
  planHouseholdTax,
  planPrimarySpending,
  playerTaxReceiptsByCountry,
  primarySpendingTransition,
  unfundedPlan,
} from "./conservedFiscalCash";

const target = {
  turn: 7,
  countryId: "US",
  budgetId: "US",
  currency: "USD",
  centralBankId: "US",
};

describe("conserved fiscal cash rules", () => {
  it("nets landed player tax out of the revenue slice and never claws back an excess", () => {
    expect(
      planHouseholdTax({
        revenueSlice: 1_000,
        playerTaxReceipts: 150,
        priorArrears: 0,
        householdCash: 10_000,
      })
    ).toEqual({
      currentDue: 850,
      priorArrears: 0,
      paid: 850,
      arrearsAfter: 0,
      playerTaxReceipts: 150,
    });
    expect(
      planHouseholdTax({
        revenueSlice: 100,
        playerTaxReceipts: 150,
        priorArrears: 0,
        householdCash: 10_000,
      }).paid
    ).toBe(0);
  });

  it("caps each flow at the payer's funded balance and carries the rest as arrears", () => {
    expect(
      planHouseholdTax({
        revenueSlice: 500,
        playerTaxReceipts: 0,
        priorArrears: 200,
        householdCash: 300,
      })
    ).toMatchObject({ currentDue: 500, priorArrears: 200, paid: 300, arrearsAfter: 400 });
    expect(
      planPrimarySpending({ spendingSlice: 400, priorArrears: 50, treasuryCash: 1_000 })
    ).toEqual({
      currentDue: 400,
      priorArrears: 50,
      paid: 450,
      arrearsAfter: 0,
    });
    expect(
      planPrimarySpending({ spendingSlice: 400, priorArrears: 0, treasuryCash: -5 }).paid
    ).toBe(0);
    expect(unfundedPlan({ currentDue: 400, priorArrears: 50, paid: 450, arrearsAfter: 0 })).toEqual(
      {
        currentDue: 400,
        priorArrears: 50,
        paid: 0,
        arrearsAfter: 450,
      }
    );
  });

  it("counts only landed treasury credits from player tax journals for the same turn", () => {
    const credit = (countryId: string, amount: number, applied = true) => ({
      kind: "credit",
      amount,
      applied,
      collection: "federalBudget",
      path: "treasuryCashLocal",
      filter: { countryId, _id: countryId },
    });
    const receipts = playerTaxReceiptsByCountry(
      [
        { kind: "corporate_tax_withholding", turn: 7, legs: [credit("US", 100), credit("UK", 40)] },
        { kind: "corporate_tax_arrears_payment", turn: 7, legs: [credit("US", 5)] },
        { kind: "corporate_tax_withholding", turn: 7, legs: [credit("US", 999, false)] },
        { kind: "corporate_tax_withholding", turn: 6, legs: [credit("US", 999)] },
        { kind: "treasury_funded_expense", turn: 7, legs: [credit("US", 999)] },
      ],
      7
    );
    expect(Object.fromEntries(receipts)).toEqual({ US: 105, UK: 40 });
  });

  it("builds balanced native-currency transitions with guarded payer debits", () => {
    const tax = householdTaxTransition(target, {
      currentDue: 850,
      priorArrears: 0,
      paid: 850,
      arrearsAfter: 0,
      playerTaxReceipts: 150,
    });
    expect(checkBalancedTransfer(tax.legs, tax.key)).toEqual([]);
    expect(tax.key).toBe("conserved-fiscal:7:US:tax");
    expect(tax.legs[0]).toMatchObject({
      kind: "debit",
      collection: "centralBanks",
      filter: { _id: "US", externalBroadMoney: { $gte: 850 } },
    });
    const spend = primarySpendingTransition(target, {
      currentDue: 400,
      priorArrears: 0,
      paid: 300,
      arrearsAfter: 100,
    });
    expect(checkBalancedTransfer(spend.legs, spend.key)).toEqual([]);
    expect(spend.legs[0].filter).toEqual({ _id: "US", treasuryCashLocal: { $gte: 300 } });
    expect(spend.projections[0].update).toMatchObject({
      $inc: { "conservedFiscalCash.primarySpendingArrearsLocal": 100 },
    });
    expect(
      householdTaxTransition(target, { currentDue: 0, priorArrears: 10, paid: 0, arrearsAfter: 10 })
        .legs
    ).toEqual([]);
    for (const direction of ["inflow", "sweep"] as const) {
      const flow = conservedPoolFlowTransition({
        turn: 7,
        currency: "USD",
        centralBankId: "US",
        direction,
        amount: 25,
      });
      expect(checkBalancedTransfer(flow.legs, flow.key)).toEqual([]);
      expect(flow.legs.some((leg) => leg.kind === "mint" || leg.kind === "burn")).toBe(false);
    }
  });

  it("reports a zero residual for a closed system and names an unexplained change", () => {
    const opening = { householdCash: 1_000, treasuryCash: 0, bondPoolCash: 0, otherHolderCash: 5 };
    const closing = {
      householdCash: 700,
      treasuryCash: 200,
      bondPoolCash: 100,
      otherHolderCash: 5,
    };
    expect(conservationResidual({ opening, closing, explicitMint: 0, explicitBurn: 0 })).toBe(0);
    expect(
      conservationResidual({
        opening,
        closing: { ...closing, treasuryCash: 250 },
        explicitMint: 0,
        explicitBurn: 0,
      })
    ).toBe(50);
  });
});
