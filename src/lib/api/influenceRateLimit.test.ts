import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: vi.fn().mockResolvedValue({
    ok: true,
    user: { userId: "rate-limit-test-account", character: { countryId: "US" } },
  }),
}));
vi.mock("@/lib/db/partyLookup", async () => ({
  ...(await vi.importActual<object>("@/lib/db/partyLookup")),
  findPartyBySequentialId: vi.fn().mockResolvedValue(null),
}));

async function influence(regional: boolean) {
  const request = new Request("http://localhost/api/influence", {
    method: "POST",
    body: "{}",
    headers: { "Content-Type": "application/json" },
  });
  if (regional) {
    const { POST } =
      await import("@/app/api/country/[code]/region/[id]/party/[partyId]/influence/route");
    return POST(request, { params: Promise.resolve({ code: "us", id: "CA", partyId: "1" }) });
  }
  const { POST } = await import("@/app/api/country/[code]/parties/[id]/influence/route");
  return POST(request, { params: Promise.resolve({ code: "us", id: "1" }) });
}

describe("party influence rate-limit isolation", () => {
  beforeEach(() => vi.resetModules());

  it.each([false, true])(
    "does not charge unrelated requests to influence (regional=%s)",
    async (regional) => {
      const { checkRateLimit } = await import("./rateLimit");
      for (let i = 0; i < 20; i++) checkRateLimit("rate-limit-test-account", 30, 60000);
      const response = await influence(regional);
      expect(response.status).toBe(regional ? 400 : 404);
    }
  );

  it("retains one twenty-request budget across both influence surfaces", async () => {
    for (let i = 0; i < 20; i++) {
      expect((await influence(i % 2 === 0)).status).not.toBe(429);
    }
    const response = await influence(true);
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
