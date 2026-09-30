import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/utils/network", () => ({
  getBaseUrl: () => "https://ahousedividedgame.com",
  getClientIp: async () => "203.0.113.1",
}));

import { POST } from "./route";

describe("POST /api/auth/apple/callback", () => {
  it("bounces Apple's cross-site form_post to a same-site GET without touching state", async () => {
    const form = new URLSearchParams({
      code: "c.123",
      state: "abc",
      user: JSON.stringify({ name: { firstName: "Ada", lastName: "Lovelace" }, email: "x@y.z" }),
    });
    const response = await POST(
      new Request("https://ahousedividedgame.com/api/auth/apple/callback", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      })
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(
      "https://ahousedividedgame.com/api/auth/apple/callback"
    );
    expect(Object.fromEntries(location.searchParams)).toEqual({
      code: "c.123",
      state: "abc",
      name: "Ada Lovelace",
    });
  });

  it("forwards a cancelled authorization as an error", async () => {
    const response = await POST(
      new Request("https://ahousedividedgame.com/api/auth/apple/callback", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ error: "user_cancelled_authorize", state: "abc" }),
      })
    );
    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("error")).toBe("user_cancelled_authorize");
    expect(location.searchParams.has("code")).toBe(false);
  });
});
