import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/extraction/featureFlag", () => ({
  isContractIssuanceEnabled: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn() }));

/**
 * GET /api/contracts/extraction `status` query param:
 *   absent  → active-only (legacy filter, unchanged)
 *   offered → pending non-revoked offers only
 *   all     → no status/revoked filter (full history)
 */
describe("GET /api/contracts/extraction status filter", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("extractionContracts");
    db.collection("corporations");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as never);
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue(null as never);
  });

  async function call(query: string) {
    const { GET } = await import("./route");
    return GET(new Request(`http://localhost/api/contracts/extraction${query}`));
  }

  it("defaults to the active-contract filter when status is absent", async () => {
    const res = await call("?stateId=TX");
    expect(res.status).toBe(200);
    const filter = db.collectionMocks.extractionContracts.find.mock.calls[0][0];
    expect(filter).toMatchObject({
      stateId: "TX",
      revokedTurn: { $exists: false },
      status: { $nin: ["offered", "declined"] },
    });
  });

  it("returns pending offers (with terms) for status=offered", async () => {
    const offered = {
      _id: new ObjectId(),
      stateId: "TX",
      countryId: "US",
      corporationId: new ObjectId(),
      resource: "oil",
      share: 0.4,
      status: "offered",
      offerExpiresTurn: 124,
      signingFeeAnchor: 100_000,
      royaltyRatePerTurn: 0.01,
      termTurns: 48,
    };
    db.collectionMocks.extractionContracts.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([offered]),
    });
    db.collectionMocks.corporations.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const res = await call("?countryId=US&status=offered");
    expect(res.status).toBe(200);
    const filter = db.collectionMocks.extractionContracts.find.mock.calls[0][0];
    expect(filter).toMatchObject({
      countryId: "US",
      status: "offered",
      revokedTurn: { $exists: false },
    });
    const json = await res.json();
    expect(json.contracts).toHaveLength(1);
    expect(json.contracts[0]).toMatchObject({
      status: "offered",
      offerExpiresTurn: 124,
      signingFeeAnchor: 100_000,
      royaltyRatePerTurn: 0.01,
      termTurns: 48,
    });
    expect(json.contractIssuanceEnabled).toBe(true);
  });

  it("returns the full history for status=all", async () => {
    const res = await call("?corporationId=507f1f77bcf86cd799439011&status=all");
    expect(res.status).toBe(200);
    const filter = db.collectionMocks.extractionContracts.find.mock.calls[0][0];
    expect(filter.status).toBeUndefined();
    expect(filter.revokedTurn).toBeUndefined();
    expect(filter.corporationId).toBeInstanceOf(ObjectId);
  });

  it("rejects an unknown status value", async () => {
    const res = await call("?status=declined");
    expect(res.status).toBe(400);
  });

  describe("missedPayments projection", () => {
    const OWNER_ID = new ObjectId();
    const CORP_ID = new ObjectId();

    function primeContract() {
      db.collectionMocks.extractionContracts.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: new ObjectId(),
            stateId: "TX",
            countryId: "US",
            corporationId: CORP_ID,
            resource: "oil",
            share: 0.4,
            status: "active",
            missedPayments: 2,
            royaltyRatePerTurn: 0.01,
          },
        ]),
      });
      db.collectionMocks.corporations.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: CORP_ID, name: "Acme", userId: OWNER_ID }]),
      });
    }

    it("hides missedPayments from anonymous and unrelated viewers", async () => {
      primeContract();
      const res = await call("?stateId=TX&status=all");
      const json = await res.json();
      expect(json.contracts[0].missedPayments).toBeUndefined();
      // Public contract terms stay visible.
      expect(json.contracts[0].royaltyRatePerTurn).toBe(0.01);
    });

    it("keeps missedPayments for the corp's CEO", async () => {
      primeContract();
      const { getAuthUser } = await import("@/lib/auth");
      vi.mocked(getAuthUser).mockResolvedValue({
        userId: OWNER_ID.toString(),
        isAdmin: false,
      } as never);
      const res = await call("?stateId=TX&status=all");
      const json = await res.json();
      expect(json.contracts[0].missedPayments).toBe(2);
    });

    it("keeps missedPayments for admins", async () => {
      primeContract();
      const { getAuthUser } = await import("@/lib/auth");
      vi.mocked(getAuthUser).mockResolvedValue({
        userId: new ObjectId().toString(),
        isAdmin: true,
      } as never);
      const res = await call("?stateId=TX&status=all");
      const json = await res.json();
      expect(json.contracts[0].missedPayments).toBe(2);
    });
  });
});
