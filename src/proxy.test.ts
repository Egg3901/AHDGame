import { describe, it, expect, vi } from "vitest";

// proxy() consults the DB for maintenance / public-viewing state. Stub those to
// safe defaults so we can exercise the pure routing behaviors (redirects,
// rewrites, header injection) that this test is about.
const mockMaintenanceStatus = vi.hoisted(() =>
  vi.fn(async (): Promise<{ mode: "off" | "partial" | "full"; enabled: boolean }> => ({
    mode: "off",
    enabled: false,
  }))
);
vi.mock("@/lib/maintenanceStatus", () => ({
  getCachedMaintenanceStatus: mockMaintenanceStatus,
  isMaintenanceBypassPath: () => false,
}));
vi.mock("@/lib/publicViewing", () => ({
  getCachedPublicViewingMode: vi.fn(async () => true),
  isPublicApiReadBypassPath: () => false,
}));
vi.mock("@/lib/auth/characterGate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/characterGate")>();
  // Force every page path to be "character-gated" so the gate branch is testable.
  return { ...actual, isCharacterGatedPath: () => true };
});

import { NextRequest } from "next/server";
import { proxy, config } from "./proxy";
import { AUTH_COOKIE_NAME } from "@/lib/authCookieName";
import { CHARACTER_GATE_COOKIE } from "@/lib/auth/characterGate";

function makeRequest(
  urlStr: string,
  opts: { host?: string; cookies?: Record<string, string> } = {}
): NextRequest {
  const headers = new Headers();
  if (opts.host) headers.set("host", opts.host);
  const req = new NextRequest(new URL(urlStr), { headers });
  for (const [k, v] of Object.entries(opts.cookies ?? {})) req.cookies.set(k, v);
  return req;
}

describe("proxy() — behaviors preserved from the deleted root middleware.ts", () => {
  it("301-redirects www → apex", async () => {
    const res = await proxy(
      makeRequest("https://www.ahousedividedgame.com/dashboard", {
        host: "www.ahousedividedgame.com",
      })
    );
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://ahousedividedgame.com/dashboard");
  });

  it("does NOT 301 a POST to www /api/* (301 would drop the body and break bot writes)", async () => {
    const req = new NextRequest(
      new URL("https://www.ahousedividedgame.com/api/discord-bot/tickets"),
      { method: "POST", headers: new Headers({ host: "www.ahousedividedgame.com" }) }
    );
    const res = await proxy(req);
    // Falls through to the API read-gate (not the canonical-host redirect), so
    // the POST reaches the route on www with its body intact.
    expect(res.status).not.toBe(301);
    expect(res.headers.get("location")).toBeNull();
  });

  it("rewrites a wiki-subdomain page path under /wiki", async () => {
    const res = await proxy(
      makeRequest("https://wiki.ahousedividedgame.com/elections/123", {
        host: "wiki.ahousedividedgame.com",
      })
    );
    expect(res.headers.get("x-middleware-rewrite")).toContain("/wiki/elections/123");
  });

  it("passes wiki well-known root files through without rewriting", async () => {
    const res = await proxy(
      makeRequest("https://wiki.ahousedividedgame.com/robots.txt", {
        host: "wiki.ahousedividedgame.com",
      })
    );
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("redirects a logged-in character-less user to /create-character on gated pages", async () => {
    const res = await proxy(
      makeRequest("https://ahousedividedgame.com/dashboard", {
        host: "ahousedividedgame.com",
        cookies: { [AUTH_COOKIE_NAME]: "token", [CHARACTER_GATE_COOKIE]: "1" },
      })
    );
    expect(res.headers.get("location")).toContain("/create-character");
  });

  it("does NOT redirect a user who already has a character", async () => {
    const res = await proxy(
      makeRequest("https://ahousedividedgame.com/dashboard", {
        host: "ahousedividedgame.com",
        cookies: { [AUTH_COOKIE_NAME]: "token" },
      })
    );
    expect(res.headers.get("location")).toBeNull();
  });

  it("stamps X-Robots-Tag: noindex on the raw Railway host", async () => {
    const res = await proxy(
      makeRequest("https://web-production-abc.up.railway.app/dashboard", {
        host: "web-production-abc.up.railway.app",
      })
    );
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("does not stamp X-Robots-Tag on the canonical host", async () => {
    const res = await proxy(
      makeRequest("https://ahousedividedgame.com/dashboard", {
        host: "ahousedividedgame.com",
      })
    );
    expect(res.headers.get("x-robots-tag")).toBeNull();
  });

  it("routes /api/* through the read-gate (no page redirect/rewrite)", async () => {
    const res = await proxy(
      makeRequest("https://ahousedividedgame.com/api/mail", {
        host: "ahousedividedgame.com",
      })
    );
    // public-viewing mocked on → read-gate allows through as a normal next()
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });
});

describe("proxy() — tri-state maintenance gating", () => {
  it("redirects a non-admin to /maintenance when mode is 'full'", async () => {
    mockMaintenanceStatus.mockResolvedValueOnce({ mode: "full", enabled: true });
    const res = await proxy(
      makeRequest("https://ahousedividedgame.com/dashboard", {
        host: "ahousedividedgame.com",
      })
    );
    expect(res.headers.get("location")).toContain("/maintenance");
  });

  it("does NOT redirect when mode is 'partial' — pages stay reachable", async () => {
    mockMaintenanceStatus.mockResolvedValueOnce({ mode: "partial", enabled: true });
    const res = await proxy(
      makeRequest("https://ahousedividedgame.com/dashboard", {
        host: "ahousedividedgame.com",
      })
    );
    expect(res.headers.get("location")).toBeNull();
  });

  it("does NOT redirect when mode is 'off'", async () => {
    mockMaintenanceStatus.mockResolvedValueOnce({ mode: "off", enabled: false });
    const res = await proxy(
      makeRequest("https://ahousedividedgame.com/dashboard", {
        host: "ahousedividedgame.com",
      })
    );
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("static region shards stay outside the maintenance gate", () => {
  // The proxy matcher decides what even reaches `proxy()`. A regex that lets a
  // .json through means the landing globe fetches HTML during a seal, so the
  // Germany split (and the union republics) silently vanish while the page
  // around them looks fine.
  const matcher = config.matcher[0];
  const matches = (pathname: string) => new RegExp(`^${matcher}$`).test(pathname);

  it("excludes the public map region shards", () => {
    for (const shard of [
      "/germany-regions.json",
      "/dd-regions.json",
      "/ru-regions.json",
      "/ua-regions.json",
      "/blr-regions.json",
      "/bal-regions.json",
    ]) {
      expect(matches(shard), `${shard} must bypass the proxy`).toBe(false);
    }
  });

  it("still gates ordinary pages", () => {
    for (const page of ["/dashboard", "/world", "/country/us"]) {
      expect(matches(page), `${page} must stay gated`).toBe(true);
    }
  });
});
