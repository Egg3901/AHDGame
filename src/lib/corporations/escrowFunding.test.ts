import { describe, it, expect } from "vitest";
import {
  computeEscrowFundingTransfer,
  evaluateEscrowWithdrawal,
  ESCROW_WITHDRAW_COOLDOWN_TURNS,
  computeBondShortfallEscrowCover,
  splitBondPaymentWithEscrow,
  shouldWarnEscrowFunding,
} from "./escrowFunding";

describe("computeEscrowFundingTransfer", () => {
  it("transfers the full rate when affordable", () => {
    expect(computeEscrowFundingTransfer({ fundingPerTurn: 300, liquidCapital: 1000 })).toBe(300);
  });
  it("caps at available liquidCapital", () => {
    expect(computeEscrowFundingTransfer({ fundingPerTurn: 300, liquidCapital: 120 })).toBe(120);
  });
  it("is zero when rate is zero/negative/absent", () => {
    expect(computeEscrowFundingTransfer({ fundingPerTurn: 0, liquidCapital: 1000 })).toBe(0);
    expect(computeEscrowFundingTransfer({ fundingPerTurn: -5, liquidCapital: 1000 })).toBe(0);
    expect(computeEscrowFundingTransfer({ liquidCapital: 1000 })).toBe(0);
  });
  it("is zero when liquidCapital is non-positive", () => {
    expect(computeEscrowFundingTransfer({ fundingPerTurn: 300, liquidCapital: 0 })).toBe(0);
    expect(computeEscrowFundingTransfer({ fundingPerTurn: 300, liquidCapital: -50 })).toBe(0);
  });
  it("is zero for non-finite inputs", () => {
    expect(computeEscrowFundingTransfer({ fundingPerTurn: Number.NaN, liquidCapital: 1000 })).toBe(
      0
    );
    expect(
      computeEscrowFundingTransfer({ fundingPerTurn: 300, liquidCapital: Number.POSITIVE_INFINITY })
    ).toBe(0);
  });
});

describe("evaluateEscrowWithdrawal", () => {
  it("allows a withdrawal within the positive balance and off cooldown", () => {
    expect(
      evaluateEscrowWithdrawal({ escrowBalance: 1000, amount: 400, currentTurn: 100 })
    ).toEqual({ ok: true });
  });

  it("allows when exactly at the cooldown boundary", () => {
    const res = evaluateEscrowWithdrawal({
      escrowBalance: 1000,
      amount: 400,
      currentTurn: 100,
      lastWithdrawalTurn: 100 - ESCROW_WITHDRAW_COOLDOWN_TURNS,
    });
    expect(res.ok).toBe(true);
  });

  it("rejects a non-positive amount", () => {
    const res = evaluateEscrowWithdrawal({ escrowBalance: 1000, amount: 0, currentTurn: 100 });
    expect(res).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects when escrow is zero or negative", () => {
    expect(evaluateEscrowWithdrawal({ escrowBalance: 0, amount: 50, currentTurn: 100 }).ok).toBe(
      false
    );
    expect(evaluateEscrowWithdrawal({ escrowBalance: -200, amount: 50, currentTurn: 100 }).ok).toBe(
      false
    );
  });

  it("rejects an amount exceeding the positive balance (cannot go negative)", () => {
    const res = evaluateEscrowWithdrawal({ escrowBalance: 1000, amount: 5000, currentTurn: 100 });
    expect(res).toMatchObject({ ok: false, status: 400 });
    if (!res.ok) expect(res.error).toContain("at most");
  });

  it("rejects within the cooldown window and reports remaining turns", () => {
    const res = evaluateEscrowWithdrawal({
      escrowBalance: 1000,
      amount: 400,
      currentTurn: 100,
      lastWithdrawalTurn: 90, // 10 < 24
    });
    expect(res).toMatchObject({ ok: false, status: 400 });
    if (!res.ok) expect(res.error).toContain(`${ESCROW_WITHDRAW_COOLDOWN_TURNS - 10} turns`);
  });
});

describe("computeBondShortfallEscrowCover", () => {
  it("covers the full negative balance when escrow is ample", () => {
    expect(computeBondShortfallEscrowCover({ liquidCapital: -300, escrowBalance: 1000 })).toBe(300);
  });
  it("caps the cover at the positive escrow balance", () => {
    expect(computeBondShortfallEscrowCover({ liquidCapital: -1000, escrowBalance: 250 })).toBe(250);
  });
  it("returns 0 when liquidCapital is non-negative (nothing to cover)", () => {
    expect(computeBondShortfallEscrowCover({ liquidCapital: 50, escrowBalance: 1000 })).toBe(0);
  });
  it("returns 0 when escrow is zero or negative (never uses a debt)", () => {
    expect(computeBondShortfallEscrowCover({ liquidCapital: -300, escrowBalance: 0 })).toBe(0);
    expect(computeBondShortfallEscrowCover({ liquidCapital: -300, escrowBalance: -500 })).toBe(0);
  });
});

describe("splitBondPaymentWithEscrow", () => {
  it("pays entirely from liquidCapital when sufficient", () => {
    expect(
      splitBondPaymentWithEscrow({ liquidCapital: 1000, escrowBalance: 500, amountDue: 400 })
    ).toEqual({ fromLiquid: 400, fromEscrow: 0, covered: true });
  });
  it("tops up the shortfall from positive escrow", () => {
    expect(
      splitBondPaymentWithEscrow({ liquidCapital: 300, escrowBalance: 500, amountDue: 700 })
    ).toEqual({ fromLiquid: 300, fromEscrow: 400, covered: true });
  });
  it("is not covered when liquidCapital + positive escrow falls short", () => {
    const r = splitBondPaymentWithEscrow({
      liquidCapital: 300,
      escrowBalance: 100,
      amountDue: 700,
    });
    expect(r).toMatchObject({ fromLiquid: 300, fromEscrow: 100, covered: false });
  });
  it("treats negative liquidCapital as 0 contribution and ignores negative escrow", () => {
    const r = splitBondPaymentWithEscrow({
      liquidCapital: -50,
      escrowBalance: -100,
      amountDue: 500,
    });
    expect(r).toEqual({ fromLiquid: 0, fromEscrow: 0, covered: false });
  });
});

describe("shouldWarnEscrowFunding", () => {
  it("warns when funding/turn exceeds recent net income", () => {
    expect(
      shouldWarnEscrowFunding({ fundingPerTurn: 100_000_000, recentNetIncome: 1_300_000 })
    ).toBe(true);
  });
  it("does not warn when funding is at or below income", () => {
    expect(shouldWarnEscrowFunding({ fundingPerTurn: 1_000_000, recentNetIncome: 1_300_000 })).toBe(
      false
    );
    expect(shouldWarnEscrowFunding({ fundingPerTurn: 1_300_000, recentNetIncome: 1_300_000 })).toBe(
      false
    );
  });
  it("does not warn when income is unknown / zero / negative (avoid false alarms)", () => {
    expect(shouldWarnEscrowFunding({ fundingPerTurn: 500, recentNetIncome: 0 })).toBe(false);
    expect(shouldWarnEscrowFunding({ fundingPerTurn: 500, recentNetIncome: -10 })).toBe(false);
  });
  it("does not warn when funding is zero/negative", () => {
    expect(shouldWarnEscrowFunding({ fundingPerTurn: 0, recentNetIncome: 1_000 })).toBe(false);
    expect(shouldWarnEscrowFunding({ fundingPerTurn: -5, recentNetIncome: 1_000 })).toBe(false);
  });
  it("does not warn on non-finite inputs", () => {
    expect(shouldWarnEscrowFunding({ fundingPerTurn: Number.NaN, recentNetIncome: 1_000 })).toBe(
      false
    );
    expect(
      shouldWarnEscrowFunding({ fundingPerTurn: 500, recentNetIncome: Number.POSITIVE_INFINITY })
    ).toBe(false);
  });
});
