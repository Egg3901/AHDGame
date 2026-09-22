import { describe, expect, it } from "vitest";
import {
  TreasuryExecutionUncertainError,
  isTreasuryExecutionUncertain,
} from "./executionUncertain";

describe("isTreasuryExecutionUncertain", () => {
  it("recognises the error itself", () => {
    expect(isTreasuryExecutionUncertain(new TreasuryExecutionUncertainError("debited"))).toBe(true);
  });

  it("recognises a structurally identical copy", () => {
    // The check is by property, not `instanceof`, so an error that has
    // been re-thrown across a realm or reconstructed from a serialised
    // copy still stops the caller from unwinding. Getting this wrong
    // reopens a pending row whose money is already gone.
    expect(isTreasuryExecutionUncertain({ treasuryStateUncertain: true })).toBe(true);
  });

  it("does not treat an ordinary error as uncertain", () => {
    // Ordinary failures MUST stay unwindable: the approve route hands
    // the approval back for these, and treating them as uncertain would
    // strand every refused transaction as `executing`.
    expect(isTreasuryExecutionUncertain(new Error("mongo exploded"))).toBe(false);
  });

  it("does not match a merely truthy discriminator", () => {
    expect(isTreasuryExecutionUncertain({ treasuryStateUncertain: "yes" })).toBe(false);
  });

  it("tolerates null and undefined", () => {
    expect(isTreasuryExecutionUncertain(null)).toBe(false);
    expect(isTreasuryExecutionUncertain(undefined)).toBe(false);
  });

  it("carries the triggering failure as its cause", () => {
    const cause = new Error("refund failed");
    const err = new TreasuryExecutionUncertainError("debited, not refunded", { cause });
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("TreasuryExecutionUncertainError");
  });
});
