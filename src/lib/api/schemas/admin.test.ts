import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { adminResourcesGrantSchema, moderatorResourcesGrantSchema } from "./admin";

describe("resource grant schemas", () => {
  const characterIds = [new ObjectId().toString()];

  it("allows admins to grant a Positions Update Voucher by itself", () => {
    expect(
      adminResourcesGrantSchema.safeParse({ characterIds, positionUpdateVoucher: true }).success
    ).toBe(true);
  });

  it("does not expose Positions Update Vouchers through the moderator route", () => {
    expect(
      moderatorResourcesGrantSchema.safeParse({
        characterIds,
        positionUpdateVoucher: true,
      }).success
    ).toBe(false);

    const compatibleRequest = moderatorResourcesGrantSchema.safeParse({
      characterIds,
      actions: 1,
      positionUpdateVoucher: true,
    });
    expect(compatibleRequest.success).toBe(true);
    if (compatibleRequest.success) {
      expect(compatibleRequest.data).not.toHaveProperty("positionUpdateVoucher");
    }
  });
});
