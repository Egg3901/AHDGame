import { describe, expect, it } from "vitest";
import { publicError } from "./errors";

describe("publicError", () => {
  it("returns a response with ok:false, the code, and the message", async () => {
    const res = publicError("NOT_FOUND", "Character not found", 404);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "Character not found", code: "NOT_FOUND" });
    expect(res.status).toBe(404);
  });

  it("includes ok:false for every error code", async () => {
    const codes = ["UNAUTHORIZED", "BAD_REQUEST", "RATE_LIMITED", "INTERNAL_ERROR"] as const;
    for (const code of codes) {
      const res = publicError(code, "msg", 400);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.code).toBe(code);
    }
  });
});
