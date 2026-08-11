import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/admin/countryReadinessReport", () => ({
  buildCountryReadinessReport: vi.fn(),
}));

const { requireAdmin } = await import("@/lib/api/requireAdmin");
const { buildCountryReadinessReport } = await import("@/lib/admin/countryReadinessReport");

describe("GET /api/admin/country/[code]/readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true } as never);
  });

  it("returns 400 for an unknown country code (not in COUNTRY_CONFIGS)", async () => {
    const { GET } = await import("@/app/api/admin/country/[code]/readiness/route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ code: "xx" }),
    });
    expect(response.status).toBe(400);
  });

  it("returns 404 when the country has no expectations entry", async () => {
    vi.mocked(buildCountryReadinessReport).mockResolvedValueOnce(null);
    const { GET } = await import("@/app/api/admin/country/[code]/readiness/route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ code: "us" }),
    });
    expect(response.status).toBe(404);
  });

  it("returns the report when the country has expectations", async () => {
    vi.mocked(buildCountryReadinessReport).mockResolvedValueOnce({
      ready: true,
      summary: { ok: 11, warning: 0, missing: 0 },
      checks: [],
    });
    const { GET } = await import("@/app/api/admin/country/[code]/readiness/route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ code: "de" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ready).toBe(true);
    expect(buildCountryReadinessReport).toHaveBeenCalledWith(expect.anything(), "DE");
  });
});
