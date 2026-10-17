import { describe, it, expect } from "vitest";
import { idleCauseMeta } from "./plants";

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
