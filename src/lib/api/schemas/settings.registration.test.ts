import { describe, expect, it } from "vitest";
import { registrationBudgetSchema } from "./settings";

// Voter-registration drive budget (player suggestion #81). Mirrors the GOTV
// budget bounds (0-25%) but has no demographic target.
describe("registrationBudgetSchema (#81)", () => {
  it("accepts 0 through 25 percent", () => {
    for (const percent of [0, 1, 10, 25]) {
      const r = registrationBudgetSchema.safeParse({ registrationBudgetPercent: percent });
      expect(r.success, `rejected ${percent}`).toBe(true);
    }
  });

  it("coerces a numeric string", () => {
    const r = registrationBudgetSchema.safeParse({ registrationBudgetPercent: "10" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.registrationBudgetPercent).toBe(10);
  });

  it("rejects a percent above 25", () => {
    expect(registrationBudgetSchema.safeParse({ registrationBudgetPercent: 26 }).success).toBe(
      false
    );
  });

  it("rejects a negative percent", () => {
    expect(registrationBudgetSchema.safeParse({ registrationBudgetPercent: -1 }).success).toBe(
      false
    );
  });

  it("rejects a non-integer percent", () => {
    expect(registrationBudgetSchema.safeParse({ registrationBudgetPercent: 10.5 }).success).toBe(
      false
    );
  });
});
