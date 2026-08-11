import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/extraction/featureFlag", () => ({ isContractIssuanceEnabled: vi.fn() }));
vi.mock("@/lib/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(100) }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));
vi.mock("@/lib/extraction/commands/acceptContractOffer", () => ({ acceptContractOffer: vi.fn() }));

const CONTRACT_ID = new ObjectId();

async function callAccept() {
  const { POST } = await import("./route");
  return POST(
    new Request(`http://localhost/api/contracts/extraction/${CONTRACT_ID}/accept`, {
      method: "POST",
    }),
    {
      params: Promise.resolve({ id: CONTRACT_ID.toString() }),
    }
  );
}

describe("POST /api/contracts/extraction/[id]/accept", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("extractionContracts");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as never);

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString() },
    } as never);

    const { isContractIssuanceEnabled } = await import("@/lib/extraction/featureFlag");
    vi.mocked(isContractIssuanceEnabled).mockResolvedValue(true);

    db.collectionMocks.extractionContracts.findOne.mockResolvedValue({
      _id: CONTRACT_ID,
      corporationId: new ObjectId(),
      status: "offered",
    });
  });

  it("returns 403 when the caller is not the corporation CEO", async () => {
    const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: { _id: new ObjectId() },
    } as never);
    vi.mocked(requireCeo).mockReturnValue(
      NextResponse.json({ error: "Only the CEO can perform this action" }, { status: 403 })
    );

    const res = await callAccept();
    expect(res.status).toBe(403);
    const { acceptContractOffer } = await import("@/lib/extraction/commands/acceptContractOffer");
    expect(acceptContractOffer).not.toHaveBeenCalled();
  });

  it("returns 403 when contract issuance is disabled", async () => {
    const { isContractIssuanceEnabled } = await import("@/lib/extraction/featureFlag");
    vi.mocked(isContractIssuanceEnabled).mockResolvedValue(false);
    const res = await callAccept();
    expect(res.status).toBe(403);
  });

  it("delegates to acceptContractOffer for the CEO and returns success", async () => {
    const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: { _id: new ObjectId() },
    } as never);
    vi.mocked(requireCeo).mockReturnValue(null);
    const { acceptContractOffer } = await import("@/lib/extraction/commands/acceptContractOffer");
    vi.mocked(acceptContractOffer).mockResolvedValue({
      ok: true,
      status: 200,
      activatedTurn: 100,
      expiresTurn: 148,
      signingFeeLocal: 100_000,
    } as never);

    const res = await callAccept();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.expiresTurn).toBe(148);
  });
});
