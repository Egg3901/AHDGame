import { beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.hoisted(() => vi.fn(async () => {}));
const ua = vi.hoisted(() => ({ value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" }));
vi.mock("@/lib/analytics/intakeEvents", () => ({ captureIntakeEvent: capture }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": ua.value }),
}));
vi.mock("@/lib/utils/network", () => ({ getClientIp: async () => "203.0.113.9" }));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/analytics/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  capture.mockClear();
  ua.value = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
});

describe("POST /api/analytics/intake", () => {
  it("forwards an allowed event with enumerated properties and the device class", async () => {
    const res = await post({ event: "signup_started", surface: "register", method: "google" });
    expect(res.status).toBe(204);
    expect(capture).toHaveBeenCalledWith("signup_started", {
      surface: "register",
      method: "google",
      device_class: "mobile",
    });
  });

  it("refuses server-only completion events from the browser", async () => {
    const res = await post({ event: "account_registered" });
    expect(res.status).toBe(400);
    expect(capture).not.toHaveBeenCalled();
  });

  it("refuses free-form property values", async () => {
    const res = await post({ event: "intake_blocked", reason: "user@example.com" });
    expect(res.status).toBe(400);
    expect(capture).not.toHaveBeenCalled();
  });

  it("drops bot traffic silently", async () => {
    ua.value = "Googlebot/2.1 (+http://www.google.com/bot.html)";
    const res = await post({ event: "signup_viewed", surface: "register" });
    expect(res.status).toBe(204);
    expect(capture).not.toHaveBeenCalled();
  });
});
