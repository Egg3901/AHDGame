import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/publicApi/middleware", () => ({ publicApiGuard: vi.fn() }));
vi.mock("@/lib/publicApi/corporation", () => ({ queryCorporation: vi.fn() }));

describe("GET /api/public/v1/corporation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function allowGuard() {
    const { publicApiGuard } = await import("@/lib/publicApi/middleware");
    vi.mocked(publicApiGuard).mockResolvedValue({
      ok: true,
      headers: { "X-RateLimit-Limit": "100" },
    } as never);
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({} as never);
  }

  it("refuses a request the guard rejects", async () => {
    const { publicApiGuard } = await import("@/lib/publicApi/middleware");
    vi.mocked(publicApiGuard).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ ok: false }), { status: 401 }),
    } as never);

    const res = await GET(new Request("http://t/api/public/v1/corporation?id=1"));
    expect(res.status).toBe(401);
  });

  it("rejects a request with neither name nor id", async () => {
    await allowGuard();
    const res = await GET(new Request("http://t/api/public/v1/corporation"));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("BAD_REQUEST");
  });

  it("404s when the corporation is not found", async () => {
    await allowGuard();
    const { queryCorporation } = await import("@/lib/publicApi/corporation");
    vi.mocked(queryCorporation).mockResolvedValue(null as never);

    const res = await GET(new Request("http://t/api/public/v1/corporation?id=999"));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("NOT_FOUND");
  });

  it("returns the realized-revenue financials the query produced", async () => {
    await allowGuard();
    const { queryCorporation } = await import("@/lib/publicApi/corporation");
    // Nameplate would have been 1000; realized is 250. The route must pass
    // through whatever `corpFinancials` produced, unmodified.
    vi.mocked(queryCorporation).mockResolvedValue({
      found: true,
      id: "abc",
      name: "Acme Corp",
      financials: {
        totalRevenue: 250,
        operatingIncome: 100,
        operatingCosts: 150,
        dividendRate: 0,
      },
    } as never);

    const res = await GET(new Request("http://t/api/public/v1/corporation?name=Acme"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.financials.totalRevenue).toBe(250);
    expect(body.financials.operatingCosts).toBe(
      body.financials.totalRevenue - body.financials.operatingIncome
    );
  });
});
