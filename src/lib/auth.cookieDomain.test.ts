import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/db/collections", () => ({
  getUsersCollection: vi.fn(),
  getCharactersCollection: vi.fn(),
}));
vi.mock("@/lib/env", () => ({}));

describe("getAuthCookieOptions — Lakeside SSO cookie Domain", () => {
  const original = {
    railway: process.env.RAILWAY_ENVIRONMENT_NAME,
    vercel: process.env.VERCEL_ENV,
    base: process.env.NEXT_PUBLIC_BASE_URL,
  };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.RAILWAY_ENVIRONMENT_NAME;
    delete process.env.VERCEL_ENV;
    delete process.env.NEXT_PUBLIC_BASE_URL;
  });

  afterEach(() => {
    process.env.RAILWAY_ENVIRONMENT_NAME = original.railway;
    process.env.VERCEL_ENV = original.vercel;
    process.env.NEXT_PUBLIC_BASE_URL = original.base;
  });

  async function cookieDomain(headerGet: (name: string) => string | null) {
    const { headers } = await import("next/headers");
    vi.mocked(headers).mockResolvedValue({ get: headerGet } as never);
    const { getAuthCookieOptions } = await import("./auth");
    const opts = await getAuthCookieOptions();
    return opts.domain;
  }

  it("uses Host apex even when X-Forwarded-Host is a Railway hostname", async () => {
    expect(
      await cookieDomain((name) => {
        if (name === "host") return "ahousedividedgame.com";
        if (name === "x-forwarded-host") return "a-house-divided-production.up.railway.app";
        return null;
      })
    ).toBe(".ahousedividedgame.com");
  });

  it("scans X-Forwarded-Host list when Railway host is listed first", async () => {
    expect(
      await cookieDomain((name) => {
        if (name === "host") return "a-house-divided-production.up.railway.app";
        if (name === "x-forwarded-host") {
          return "a-house-divided-production.up.railway.app, ahousedividedgame.com";
        }
        return null;
      })
    ).toBe(".ahousedividedgame.com");
  });

  it("falls back to RAILWAY_ENVIRONMENT_NAME (not VERCEL_ENV) when hosts are non-AHD", async () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = "production";
    expect(await cookieDomain(() => "a-house-divided-production.up.railway.app")).toBe(
      ".ahousedividedgame.com"
    );
  });

  it("does not rely on VERCEL_ENV alone on Railway-shaped hosts", async () => {
    process.env.VERCEL_ENV = "production";
    // Still ok via VERCEL_ENV fallback for legacy, but Railway env is the intended signal.
    expect(await cookieDomain(() => "a-house-divided-production.up.railway.app")).toBe(
      ".ahousedividedgame.com"
    );
  });
});
