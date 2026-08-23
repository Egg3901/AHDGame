import { describe, expect, it } from "vitest";
import {
  DEFENCE_TERMINATION_CAUSE_TURNS,
  SUPPLIER_FAULT_REASONS,
  TERMINATION_CONFLICTED_MULTIPLIER,
  terminationBasis,
  terminationDisclosure,
  terminationFavorabilityPenalty,
  terminationFee,
  terminationNoticeToSupplier,
  undeliveredValue,
} from "./defenceTermination";
import { TARGET_SUPPLIER_MARGIN } from "./defenceLotEconomics";

describe("terminationBasis", () => {
  it("treats an unanswered offer as a withdrawal however long it has sat", () => {
    expect(terminationBasis({ status: "pending", supplierFaultTurns: 99 })).toBe("withdrawal");
  });

  it("is convenience while the supplier is still building", () => {
    expect(terminationBasis({ status: "active" })).toBe("convenience");
    expect(terminationBasis({ status: "active", supplierFaultTurns: 0 })).toBe("convenience");
  });

  it("is convenience until the fault streak is actually reached", () => {
    expect(
      terminationBasis({
        status: "active",
        supplierFaultTurns: DEFENCE_TERMINATION_CAUSE_TURNS - 1,
      })
    ).toBe("convenience");
  });

  it("is for cause once the plant has missed the full streak", () => {
    expect(
      terminationBasis({ status: "active", supplierFaultTurns: DEFENCE_TERMINATION_CAUSE_TURNS })
    ).toBe("cause");
  });
});

describe("SUPPLIER_FAULT_REASONS", () => {
  // The buyer running out of money must never buy the buyer a free cancellation, or the
  // cheapest way to tear up a rival's contract is to underfund your own appropriation.
  it("excludes the buyer's own funding failures", () => {
    expect(SUPPLIER_FAULT_REASONS.has("appropriation_short")).toBe(false);
    expect(SUPPLIER_FAULT_REASONS.has("turn_spend_cap")).toBe(false);
  });

  it("excludes a plant that is simply building slowly", () => {
    expect(SUPPLIER_FAULT_REASONS.has("sub_lot_output")).toBe(false);
    expect(SUPPLIER_FAULT_REASONS.has("order_remainder")).toBe(false);
  });

  it("includes the ways a supplier fails to build", () => {
    expect(SUPPLIER_FAULT_REASONS.has("no_output")).toBe(true);
    expect(SUPPLIER_FAULT_REASONS.has("supplier_ineligible")).toBe(true);
    expect(SUPPLIER_FAULT_REASONS.has("supplier_cannot_fund_loss")).toBe(true);
  });
});

describe("undeliveredValue", () => {
  it("prices only what the supplier has left to build", () => {
    expect(undeliveredValue({ lotsOrdered: 10, lotsDelivered: 4, pricePerLot: 500 })).toBe(3_000);
  });

  it("is zero on an order already filled", () => {
    expect(undeliveredValue({ lotsOrdered: 10, lotsDelivered: 10, pricePerLot: 500 })).toBe(0);
  });

  it("floors at zero rather than paying for over-delivery", () => {
    expect(undeliveredValue({ lotsOrdered: 10, lotsDelivered: 12, pricePerLot: 500 })).toBe(0);
  });
});

describe("terminationFee", () => {
  const order = { lotsOrdered: 10, lotsDelivered: 0, pricePerLot: 1_000 };

  it("pays the supplier the margin it was promised and nothing more", () => {
    expect(terminationFee({ ...order, basis: "convenience" })).toBe(
      Math.round(10_000 * TARGET_SUPPLIER_MARGIN)
    );
  });

  it("costs nothing to withdraw an offer nobody accepted", () => {
    expect(terminationFee({ ...order, basis: "withdrawal" })).toBe(0);
  });

  it("costs nothing to drop a supplier that stopped building", () => {
    expect(terminationFee({ ...order, basis: "cause" })).toBe(0);
  });

  // Terminating has to stay cheaper than letting the order run, or a country can never get
  // out of a contract it no longer needs.
  it("is cheaper than delivering the rest of the order", () => {
    const fee = terminationFee({ ...order, basis: "convenience" });
    expect(fee).toBeLessThan(undeliveredValue(order));
  });
});

describe("terminationFavorabilityPenalty", () => {
  it("is nothing when there was nothing left to cancel", () => {
    expect(
      terminationFavorabilityPenalty({ cancelledValue: 0, tranche: 1_000, conflicted: false })
    ).toBe(0);
  });

  it("barely registers for a token order", () => {
    const penalty = terminationFavorabilityPenalty({
      cancelledValue: 10,
      tranche: 1_000_000,
      conflicted: false,
    });
    expect(penalty).toBeGreaterThan(0);
    expect(penalty).toBeLessThan(1.5);
  });

  it("scales with how much of the quarter's procurement was torn up", () => {
    const small = terminationFavorabilityPenalty({
      cancelledValue: 100_000,
      tranche: 1_000_000,
      conflicted: false,
    });
    const whole = terminationFavorabilityPenalty({
      cancelledValue: 1_000_000,
      tranche: 1_000_000,
      conflicted: false,
    });
    expect(whole).toBeGreaterThan(small);
  });

  it("doubles when the minister owns a supplier competing for the same work", () => {
    const clean = terminationFavorabilityPenalty({
      cancelledValue: 500_000,
      tranche: 1_000_000,
      conflicted: false,
    });
    const conflicted = terminationFavorabilityPenalty({
      cancelledValue: 500_000,
      tranche: 1_000_000,
      conflicted: true,
    });
    expect(conflicted).toBeCloseTo(clean * TERMINATION_CONFLICTED_MULTIPLIER, 5);
  });

  it("does not divide by zero on a country with no procurement budget", () => {
    expect(
      terminationFavorabilityPenalty({ cancelledValue: 5_000, tranche: 0, conflicted: false })
    ).toBeGreaterThan(0);
  });
});

describe("terminationDisclosure", () => {
  const base = {
    ministerName: "Ren Todoroki",
    supplierName: "Northrop",
    countryName: "the United States",
    lots: 12,
    fee: 250_000,
  };

  it("names the minister, the company, and what the treasury now owes", () => {
    const line = terminationDisclosure(base);
    expect(line).toContain("Ren Todoroki");
    expect(line).toContain("Northrop");
    expect(line).toContain("250,000");
  });

  it("says so plainly when the minister has a stake in a competitor", () => {
    const line = terminationDisclosure({ ...base, competingSupplierName: "Todoroki Arms" });
    expect(line).toContain("Todoroki Arms");
    expect(line).toContain("competes");
  });

  it("stays quiet about competitors when there are none", () => {
    expect(terminationDisclosure(base)).not.toContain("competes");
  });
});

describe("terminationNoticeToSupplier", () => {
  it("tells a withdrawn supplier nothing was owed", () => {
    const msg = terminationNoticeToSupplier({
      basis: "withdrawal",
      countryName: "the United Kingdom",
      lots: 5,
      fee: 0,
    });
    expect(msg).toContain("withdrawn");
  });

  it("tells a supplier terminated for cause why it got nothing", () => {
    const msg = terminationNoticeToSupplier({
      basis: "cause",
      countryName: "the United Kingdom",
      lots: 5,
      fee: 0,
    });
    expect(msg).toContain(String(DEFENCE_TERMINATION_CAUSE_TURNS));
    expect(msg).toContain("no break");
  });

  it("tells a supplier terminated for convenience what it is paid", () => {
    const msg = terminationNoticeToSupplier({
      basis: "convenience",
      countryName: "the United Kingdom",
      lots: 5,
      fee: 42_000,
      feePaid: true,
    });
    expect(msg).toContain("42,000");
    expect(msg).toContain("paid");
    expect(msg).toContain("public wire");
  });

  // Telling a company it has been compensated when the money did not move is worse than
  // telling it nothing: it stops them chasing it.
  it("does not claim a supplier was paid when the fee has not landed", () => {
    const msg = terminationNoticeToSupplier({
      basis: "convenience",
      countryName: "the United Kingdom",
      lots: 5,
      fee: 42_000,
      feePaid: false,
    });
    expect(msg).toContain("owed");
    expect(msg).toContain("not yet reached");
    expect(msg).not.toContain("You are paid");
  });
});
