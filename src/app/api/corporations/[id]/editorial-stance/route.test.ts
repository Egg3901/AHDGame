import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

const {
  getDb,
  requireBasicAuth,
  requireCorporationActionsEnabled,
  checkRateLimit,
  resolveCorporation,
  requireCeo,
} = vi.hoisted(() => ({
  getDb: vi.fn(),
  requireBasicAuth: vi.fn(),
  requireCorporationActionsEnabled: vi.fn(),
  checkRateLimit: vi.fn(),
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));

vi.mock("@/lib/mongodb", () => ({ getDb }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth }));
vi.mock("@/lib/api/requireCorporationActions", () => ({ requireCorporationActionsEnabled }));
vi.mock("@/lib/api/rateLimit", () => ({ checkRateLimit, rateLimitResponse: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({ resolveCorporation, requireCeo }));

describe("PUT /api/corporations/[id]/editorial-stance", () => {
  const corporationId = new ObjectId("000000000000000000000010");
  const userId = "000000000000000000000001";
  const configFindOne = vi.fn();
  const mediaSectorFindOne = vi.fn();
  const updateOne = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    requireBasicAuth.mockResolvedValue({ ok: true, user: { userId } });
    requireCorporationActionsEnabled.mockResolvedValue(null);
    checkRateLimit.mockReturnValue({ ok: true });
    resolveCorporation.mockResolvedValue({
      ok: true,
      corporation: { _id: corporationId, userId: new ObjectId(userId) },
    });
    requireCeo.mockReturnValue(null);
    configFindOne.mockResolvedValue({ mediaEditorialEnabled: true });
    mediaSectorFindOne.mockResolvedValue({ _id: new ObjectId() });
    updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    getDb.mockResolvedValue({
      collection(name: string) {
        return name === "gameConfig"
          ? { findOne: configFindOne }
          : name === "corporateSectors"
            ? { findOne: mediaSectorFindOne }
            : { updateOne };
      },
    });
  });

  it("persists bounded public positions for a media CEO", async () => {
    const { PUT } = await import("./route");
    const response = await PUT(
      new Request("https://game.test/api/corporations/1/editorial-stance", {
        method: "PUT",
        body: JSON.stringify({ economic: 3, social: -2 }),
      }),
      { params: Promise.resolve({ id: "1" }) }
    );

    expect(response.status).toBe(200);
    expect(updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ userId: new ObjectId(userId), _id: corporationId }),
      { $set: { editorialStance: { economic: 3, social: -2 } } }
    );
    await expect(response.json()).resolves.toEqual({
      editorialStance: { economic: 3, social: -2 },
    });
  });

  it("refuses to read or write a stance while the gate is off", async () => {
    configFindOne.mockResolvedValue({ mediaEditorialEnabled: false });
    const { PUT } = await import("./route");
    const response = await PUT(
      new Request("https://game.test/api/corporations/1/editorial-stance", {
        method: "PUT",
        body: JSON.stringify({ economic: 0, social: 0 }),
      }),
      { params: Promise.resolve({ id: "1" }) }
    );

    expect(response.status).toBe(404);
    expect(resolveCorporation).not.toHaveBeenCalled();
    expect(mediaSectorFindOne).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
  });
});
