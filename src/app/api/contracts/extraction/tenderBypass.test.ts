import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  accept: vi.fn(),
  decline: vi.fn(),
  resolve: vi.fn(),
}));
vi.mock("@/lib/mongodb", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireBasicAuth: async () => ({ ok: true, user: { userId: "a".repeat(24) } }),
}));
vi.mock("@/lib/extraction/featureFlag", () => ({
  loadContractIssuanceSettings: async () => ({ contractIssuanceEnabled: true }),
  isContractIssuanceEnabled: async () => true,
}));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: mocks.resolve,
  requireCeo: () => null,
}));
vi.mock("@/lib/extraction/commands/acceptContractOffer", () => ({
  acceptContractOffer: mocks.accept,
}));
vi.mock("@/lib/extraction/commands/declineContractOffer", () => ({
  declineContractOffer: mocks.decline,
}));
describe("legacy offer endpoints cannot bypass binding tender awards", () => {
  const id = new ObjectId();
  beforeEach(() => {
    vi.clearAllMocks();
    const db = createMockDb();
    db.collection("extractionContracts");
    db.collectionMocks.extractionContracts.findOne.mockResolvedValue({
      _id: id,
      tenderId: "t",
      status: "offered",
    });
    mocks.getDb.mockResolvedValue(db);
  });
  it.each(["accept", "decline"])(
    "refuses a separate %s for a tender settlement preparation",
    async (action) => {
      const route = await import(
        action === "accept" ? "./[id]/accept/route" : "./[id]/decline/route"
      );
      const response = await route.POST(
        new Request("http://localhost/api/contracts/extraction/" + id + "/" + action, {
          method: "POST",
        }),
        { params: Promise.resolve({ id: id.toHexString() }) }
      );
      expect(response.status).toBe(410);
      expect(mocks.accept).not.toHaveBeenCalled();
      expect(mocks.decline).not.toHaveBeenCalled();
      expect(mocks.resolve).not.toHaveBeenCalled();
    }
  );
});
