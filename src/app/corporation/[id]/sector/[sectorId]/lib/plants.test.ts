import { describe, it, expect } from "vitest";
import { idleCauseMeta, TONE_FILL } from "./plants";

describe("bank capacity explanation", () => {
  it("explains the configured branch share and its deposit ceiling benefit", () => {
    const bank = idleCauseMeta("financial", 0.6).bank;
    expect(bank?.label).toBe("Reserved for your bank network");
    expect(bank.tone).toBe("info");
    expect(bank.help).toContain("60%");
    expect(bank.help).toContain("branch capacity share");
    expect(bank.help).toContain("deposit ceiling");
  });
});

describe("idle cause colours", () => {
  it("gives co-occurring warning causes distinct fills", () => {
    const meta = idleCauseMeta("extraction");
    const fills = [meta.inputs, meta.demand, meta.deposits].map((m) => TONE_FILL[m.tone]);
    // Waiting on inputs, Demand limited and Deposits ran short can all appear on
    // one meter; each must be a different shade or the legend lies.
    expect(new Set(fills).size).toBe(fills.length);
  });
});
