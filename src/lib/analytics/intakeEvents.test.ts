import { afterEach, describe, expect, it, vi } from "vitest";

const posthog = vi.hoisted(() => ({ capture: vi.fn(), flush: vi.fn(async () => {}) }));
let configured = true;
vi.mock("./serverPosthog", () => ({
  getServerPosthogClient: () => (configured ? posthog : null),
}));

import {
  accountAgeBand,
  authProviderOf,
  captureIntakeEvent,
  sanitizeIntakeProperties,
} from "./intakeEvents";

afterEach(() => {
  vi.clearAllMocks();
  configured = true;
});

describe("sanitizeIntakeProperties", () => {
  it("keeps short lowercase tokens and booleans only", () => {
    expect(
      sanitizeIntakeProperties({
        auth_provider: "google",
        has_referral: true,
        email: "someone@example.com",
        account_id: "6ace8e10076f76a31679aee8XXXXXXXXXXXXXXXXXXXX",
        reason: "Has Spaces",
        count: 3,
        "Bad-Key": "x",
      })
    ).toEqual({ auth_provider: "google", has_referral: true });
  });
});

describe("captureIntakeEvent", () => {
  it("sends an anonymous event with no person profile and a fresh distinct id", async () => {
    await captureIntakeEvent("account_registered", { auth_provider: "email" });
    await captureIntakeEvent("account_registered", { auth_provider: "email" });
    const [first, second] = posthog.capture.mock.calls.map(([m]) => m);
    expect(first.event).toBe("account_registered");
    expect(first.properties).toMatchObject({
      auth_provider: "email",
      intake_anonymous: true,
      $process_person_profile: false,
      $geoip_disable: true,
    });
    expect(first.distinctId).toMatch(/^intake_/);
    expect(first.distinctId).not.toBe(second.distinctId);
    expect(posthog.flush).toHaveBeenCalled();
  });

  it("is a no-op without a PostHog key and never throws", async () => {
    configured = false;
    await expect(captureIntakeEvent("signup_viewed")).resolves.toBeUndefined();
    configured = true;
    posthog.capture.mockImplementationOnce(() => {
      throw new Error("sdk");
    });
    await expect(captureIntakeEvent("signup_viewed")).resolves.toBeUndefined();
  });
});

describe("authProviderOf", () => {
  it("prefers a real password, then the linked provider", () => {
    expect(authProviderOf({ password: "hash", googleId: "g" })).toBe("email");
    expect(authProviderOf({ password: "", googleId: "g" })).toBe("google");
    expect(authProviderOf({ password: "", discordId: "d" })).toBe("discord");
    expect(authProviderOf({ password: "", appleId: "a" })).toBe("apple");
    expect(authProviderOf(null)).toBe("unknown");
  });
});

describe("accountAgeBand", () => {
  const now = Date.parse("2026-10-14T12:00:00Z");
  it("buckets the time since account creation", () => {
    expect(accountAgeBand(new Date(now - 10 * 60_000), now)).toBe("under_1h");
    expect(accountAgeBand(new Date(now - 5 * 3_600_000), now)).toBe("under_24h");
    expect(accountAgeBand(new Date(now - 3 * 86_400_000), now)).toBe("days_1_6");
    expect(accountAgeBand(new Date(now - 30 * 86_400_000), now)).toBe("days_7_plus");
    expect(accountAgeBand(undefined, now)).toBe("unknown");
  });
});
