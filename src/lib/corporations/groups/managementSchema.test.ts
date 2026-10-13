import { expect, it } from "vitest";
import { groupManagementSchema } from "./managementSchema";
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
