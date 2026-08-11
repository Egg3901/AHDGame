import { describe, it, expect, vi, beforeEach } from "vitest";

// Robust cursor: supports both `.find(...).toArray()` and
// `.find(...).project(...).toArray()`.
vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn().mockResolvedValue({
    collection: () => {
      const cursor: { toArray: () => Promise<unknown[]>; project: () => typeof cursor } = {
        toArray: async () => [],
        project: () => cursor,
      };
      return { find: () => cursor };
    },
  }),
}));
vi.mock("@/lib/map/partyOrgService", () => ({
  computePartyOrgMap: vi
    .fn()
    .mockResolvedValue({ NORTH_WEST: { leadColor: "#111", tooltip: ["x"] } }),
}));
vi.mock("@/lib/map/houseService", () => ({
  computeHouseMap: vi
    .fn()
    .mockResolvedValue({ NORTH_WEST: { leadColor: "#222", seats: 5, total: 10, tooltip: ["h"] } }),
}));
vi.mock("@/lib/map/senateService", () => ({ computeSenateMap: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/map/governorService", () => ({ computeGovernorMap: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/map/approvalService", () => ({ computeApprovalMap: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/map/leanService", () => ({
  computeLeanMap: vi.fn().mockResolvedValue({ NORTH_WEST: { color: "#333", label: "Centre" } }),
}));
vi.mock("@/lib/map/presidentialService", () => ({
  computePresidentialMap: vi.fn().mockResolvedValue({}),
}));

describe("GET /api/map/overview?countryId=NG", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the JP-shape overlay maps for NG (partyOrg/house/lean populated; senate/governor present)", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://t/api/map/overview?countryId=NG"));
    const body = await res.json();
    expect(body.partyOrg.NORTH_WEST).toBeDefined();
    expect(body.house.NORTH_WEST).toBeDefined();
    expect(body.lean.NORTH_WEST).toBeDefined();
    expect(body).toHaveProperty("senate");
    expect(body).toHaveProperty("governor");
    expect(body).toHaveProperty("presidential");
  });
});
