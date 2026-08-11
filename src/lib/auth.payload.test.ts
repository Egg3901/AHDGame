import { describe, expect, it } from "vitest";
import { userPayloadSchema } from "./auth";

describe("userPayloadSchema", () => {
  it("accepts a well-formed session payload", () => {
    const parsed = userPayloadSchema.safeParse({
      userId: "507f1f77bcf86cd799439011",
      email: "a@b.com",
      username: "player",
      role: "user",
      isAdmin: false,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.userId).toBe("507f1f77bcf86cd799439011");
    }
  });

  it("rejects payloads missing required claims", () => {
    const parsed = userPayloadSchema.safeParse({
      userId: "507f1f77bcf86cd799439011",
      email: "a@b.com",
    });
    expect(parsed.success).toBe(false);
  });
});
