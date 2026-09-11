import { beforeEach, describe, expect, it } from "vitest";
import { jwtVerify } from "jose";
import {
  PROVIDER_LINK_CONTEXT_TTL_SECONDS,
  providerLinkContextCookieName,
  sealProviderLinkContext,
  verifyProviderLinkContext,
  type LinkContextSealInput,
} from "./providerLinkContext";

const SECRET = "test-only-provider-link-secret-value";
const NOW_MS = 1_780_000_000_000;
const binding = {
  provider: "google" as const,
  userId: "user-a",
  iat: 1_780_000_000,
  state: "state-1",
};

function sealNow(
  overrides: Partial<LinkContextSealInput> = {},
  options: { nowMs?: number; ttlSeconds?: number } = {}
) {
  return sealProviderLinkContext({ ...binding, ...overrides }, { nowMs: NOW_MS, ...options });
}

function checkNow(token: string | null | undefined, overrides: Partial<LinkContextSealInput> = {}) {
  return verifyProviderLinkContext(token, { ...binding, ...overrides }, { nowMs: NOW_MS });
}

describe("provider link context", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = SECRET;
  });

  it("round-trips a sealed binding with real cryptography", () => {
    expect(checkNow(sealNow())).toEqual({ ok: true });
  });

  it("uses per-provider cookie names", () => {
    expect(providerLinkContextCookieName("google")).toBe("google_oauth_link_ctx");
    expect(providerLinkContextCookieName("discord")).toBe("discord_oauth_link_ctx");
  });

  it("rejects a missing or empty envelope", () => {
    expect(checkNow(null)).toEqual({ ok: false, reason: "missing" });
    expect(checkNow(undefined)).toEqual({ ok: false, reason: "missing" });
    expect(checkNow("")).toEqual({ ok: false, reason: "missing" });
  });

  it("rejects tampered envelopes without distinguishing the edit", () => {
    const sealed = sealNow();
    const [version, body, sig] = sealed.split(".");
    const tamperedBody = body.slice(0, -1) + (body.endsWith("A") ? "B" : "A");
    expect(checkNow(`${version}.${tamperedBody}.${sig}`).ok).toBe(false);
    const tamperedSig = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
    expect(checkNow(`${version}.${body}.${tamperedSig}`).ok).toBe(false);
    expect(checkNow("not-an-envelope")).toEqual({ ok: false, reason: "malformed" });
    expect(checkNow(`${version}.${body}`).ok).toBe(false);
  });

  it("rejects envelopes sealed with a different secret", () => {
    const sealed = sealNow();
    process.env.AUTH_SECRET = "a-different-test-secret";
    expect(checkNow(sealed).ok).toBe(false);
  });

  it("expires after the short TTL", () => {
    const sealed = sealNow();
    expect(
      verifyProviderLinkContext(sealed, binding, {
        nowMs: NOW_MS + PROVIDER_LINK_CONTEXT_TTL_SECONDS * 1000,
      })
    ).toEqual({ ok: false, reason: "expired" });
    const stale = sealNow({}, { ttlSeconds: 1 });
    expect(verifyProviderLinkContext(stale, binding, { nowMs: NOW_MS + 2000 })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("binds the provider", () => {
    const discordSealed = sealNow({ provider: "discord" });
    expect(checkNow(discordSealed)).toEqual({ ok: false, reason: "wrong_provider" });
  });

  it("binds the CSRF state", () => {
    expect(checkNow(sealNow({ state: "state-2" }))).toEqual({
      ok: false,
      reason: "wrong_state",
    });
  });

  it("detects a swapped browser account", () => {
    expect(checkNow(sealNow({ userId: "user-a" }), { userId: "user-b" })).toEqual({
      ok: false,
      reason: "account_mismatch",
    });
  });

  it("detects a rotated session", () => {
    expect(checkNow(sealNow({ iat: 1_780_000_000 }), { iat: 1_780_000_100 })).toEqual({
      ok: false,
      reason: "session_mismatch",
    });
  });

  it("has no default secret and fails closed without one", () => {
    const sealed = sealNow();
    delete process.env.AUTH_SECRET;
    expect(() => sealProviderLinkContext(binding, { nowMs: NOW_MS })).toThrow();
    expect(checkNow(sealed)).toEqual({ ok: false, reason: "malformed" });
    process.env.AUTH_SECRET = SECRET;
    expect(checkNow(sealed)).toEqual({ ok: true });
  });

  it("bounds binding field and envelope lengths", () => {
    expect(() => sealNow({ userId: "u".repeat(257) })).toThrow();
    expect(() => sealNow({ state: "s".repeat(1025) })).toThrow();
    expect(checkNow("x".repeat(8193))).toEqual({ ok: false, reason: "malformed" });
  });

  it("is not interpretable as a game session token", async () => {
    const sealed = sealNow();
    // The AUTH_COOKIE verifier runs HS256 jwtVerify against AUTH_SECRET: the
    // envelope header is not JSON, so verification must reject it outright.
    await expect(
      jwtVerify(sealed, new TextEncoder().encode(SECRET), { algorithms: ["HS256"] })
    ).rejects.toThrow();
    const payload = JSON.parse(
      Buffer.from(sealed.split(".")[1], "base64url").toString("utf8")
    ) as Record<string, unknown>;
    // Even if decoded, the payload carries none of the session claims the auth
    // payload schema requires.
    expect(payload).not.toHaveProperty("email");
    expect(payload).not.toHaveProperty("username");
    expect(payload).not.toHaveProperty("role");
  });
});
