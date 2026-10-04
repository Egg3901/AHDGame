import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDbMock, requireBasicAuthMock, resolveMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  requireBasicAuthMock: vi.fn(),
  resolveMock: vi.fn(),
}));

vi.mock("@/lib/mongodb", () => ({ getDb: getDbMock }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: requireBasicAuthMock }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: resolveMock,
  requireCeo: vi.fn(() => null),
}));

describe("POST /api/corporations/[id]/media-products/[projectId]/retire", () => {
  const corporationId = new ObjectId("507f1f77bcf86cd799439011");
  const corporation = { _id: corporationId, userId: "user-1" };
  let updateOne: ReturnType<typeof vi.fn>;
  let findOne: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    findOne = vi.fn().mockResolvedValue({
      marketSystemMode: "clearing",
      mediaOperatingModelsEnabled: true,
      mediaProductSlatesEnabled: true,
      brandLoyaltyEnabled: true,
      brandLoyaltySliceEnabled: true,
      qualityPremiumPricingEnabled: true,
    });
    updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    getDbMock.mockResolvedValue({
      collection: vi.fn((name: string) => (name === "gameConfig" ? { findOne } : { updateOne })),
    });
    requireBasicAuthMock.mockResolvedValue({ ok: true, user: { userId: "user-1" } });
    resolveMock.mockResolvedValue({ ok: true, corporation });
  });

  it("retires only an active development title owned by the CEO", async () => {
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "1", projectId: "project-1" }),
    });

    expect(response.status).toBe(200);
    expect(updateOne).toHaveBeenCalledWith(
      {
        _id: "project-1",
        corporationId: corporationId.toString(),
        activeDevelopmentCorporationId: corporationId.toString(),
        stage: "development",
      },
      { $set: { stage: "retired" }, $unset: { activeDevelopmentCorporationId: "" } }
    );
  });

  it("does not access or mutate product documents when the feature is off", async () => {
    findOne.mockResolvedValue({ marketSystemMode: "clearing" });
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "1", projectId: "project-1" }),
    });

    expect(response.status).toBe(409);
    expect(updateOne).not.toHaveBeenCalled();
  });
});
