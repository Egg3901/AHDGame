import { describe, expect, it } from "vitest";
import type { BankCharter } from "@/lib/db/types/bank";
import { isDepositTakingCharter, isLendingCharter } from "../charterKinds";

const charter = (over: Partial<BankCharter>): BankCharter =>
  ({ type: "retail", status: "active", currency: "USD", ...over }) as BankCharter;

describe("charter kinds", () => {
  it("lets retail and universal charters take deposits", () => {
    expect(isDepositTakingCharter(charter({ type: "retail" }))).toBe(true);
    expect(isDepositTakingCharter(charter({ type: "universal" }))).toBe(true);
  });

  it("keeps investment charters out of deposits", () => {
    // They run a proprietary book instead. This is the rule that decides who
    // may hold player money.
    expect(isDepositTakingCharter(charter({ type: "investment" }))).toBe(false);
  });

  it("requires the charter to be ACTIVE", () => {
    // The half most likely to be dropped by a copy. Without it a revoked bank
    // would keep taking deposits on one code path while every other path
    // treated it as closed.
    expect(isDepositTakingCharter(charter({ status: "revoked" }))).toBe(false);
    expect(isDepositTakingCharter(charter({ status: "failed" }))).toBe(false);
  });

  it("is false for a corporation with no charter at all", () => {
    expect(isDepositTakingCharter(undefined)).toBe(false);
    expect(isLendingCharter(undefined)).toBe(false);
  });

  it("keeps lending and deposit-taking in lockstep", () => {
    // Separate names for one charter distinction today. If they ever diverge,
    // it must be a deliberate change to this file, not drift between copies.
    for (const type of ["retail", "universal", "investment"] as const) {
      for (const status of ["active", "revoked"] as const) {
        const c = charter({ type, status });
        expect(isLendingCharter(c)).toBe(isDepositTakingCharter(c));
      }
    }
  });
});
