import { describe, it, expect } from "vitest";
import { loginBodySchema, registerBodySchema } from "./auth";

describe("auth schemas — fingerprintComponents", () => {
  it("accepts a login body with normalized components", () => {
    const parsed = loginBodySchema.safeParse({
      email: "a@b.com",
      password: "password123",
      fingerprint: "hash",
      fingerprintComponents: { canvas: "C", webglRenderer: "G", audio: "A", cores: 8 },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a login body without components (optional)", () => {
    const parsed = loginBodySchema.safeParse({ email: "a@b.com", password: "password123" });
    expect(parsed.success).toBe(true);
  });

  it("rejects components with the wrong field types", () => {
    const parsed = registerBodySchema.safeParse({
      email: "a@b.com",
      username: "alpha",
      password: "password123",
      ageConfirmed: true,
      fingerprintComponents: { cores: "eight" },
    });
    expect(parsed.success).toBe(false);
  });
});
