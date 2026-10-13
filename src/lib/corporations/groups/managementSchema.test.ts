import { expect, it } from "vitest";
import { groupManagementSchema } from "./managementSchema";
it("accepts optional boolean primary-only mandates and rejects non-booleans", () => {
  const command = {
    action: "direction",
    memberId: "123456789012345678901234",
    objective: "balanced",
    regions: [],
    allowInvestment: true,
  };
  for (const primaryIndustryOnly of [undefined, false, true])
    expect(groupManagementSchema.safeParse({ ...command, primaryIndustryOnly }).success).toBe(true);
  for (const primaryIndustryOnly of ["true", 1, null, []])
    expect(groupManagementSchema.safeParse({ ...command, primaryIndustryOnly }).success).toBe(
      false
    );
});
it("accepts the agreement discount band and rejects malformed or out-of-band inputs", () => {
  for (const discount of [0, 0.025, 0.1, 0.2, 0.35])
    expect(groupManagementSchema.safeParse({ action: "discount", discount }).success).toBe(true);
  for (const discount of [-0.01, 0.350001, NaN, Infinity, "0.1", null, undefined])
    expect(groupManagementSchema.safeParse({ action: "discount", discount }).success).toBe(false);
  expect(
    groupManagementSchema.safeParse({ action: "discount", discount: 0.1, memberId: "other" })
      .success
  ).toBe(false);
});
