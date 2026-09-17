import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { proposeAcquisitionOffer } from "./acquisitionOffers";
import { executeAgreedAcquisition } from "./executeAgreedAcquisition";
import { createNotification } from "@/lib/notifications";

vi.mock("./executeAgreedAcquisition", () => ({ executeAgreedAcquisition: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/bonds/sectorExitBasis", () => ({
  sectorExitValueAnchor: vi.fn().mockReturnValue(0),
}));
vi.mock("@/lib/currency/corporationCapital", () => ({
  anchorToCorpLiquidCapital: (a: number) => a,
  corpLiquidCapitalToAnchor: (a: number) => a,
  getCorpFxRate: vi.fn().mockResolvedValue(1),
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map()),
  resolveCorpLiquidCurrencyCode: () => "USD",
}));
vi.mock("@/lib/market/featureFlag", () => ({
  getMarketSystemModeForDb: vi.fn().mockResolvedValue("baseline"),
  marketAtLeast: vi.fn().mockReturnValue(false),
}));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentYear: 1900 }),
}));
vi.mock("@/lib/currency/gdpAnchorRate", () => ({
  loadWorldEraUnitScale: vi.fn().mockResolvedValue(1),
}));

let db: MockDb;

const ACQ = new ObjectId();
const TGT = new ObjectId();

// sharePrice 100 x totalShares 10_000, no sectors, no cash: valuation 1_000_000,
// so the NPP asking price is 1_100_000.
function targetFixture(overrides: Record<string, unknown> = {}) {
  return {
    _id: TGT,
    name: "TargetCo",
    ceoType: "npp",
    ceoId: new ObjectId(),
    userId: new ObjectId(),
    countryId: "US",
    sharePrice: 100,
    totalShares: 10_000,
    liquidCapital: 0,
    ...overrides,
  } as unknown as Corporation;
}

function acquirerFixture(overrides: Record<string, unknown> = {}) {
  return {
    _id: ACQ,
    name: "AcquireCo",
    ceoType: "character",
    ceoId: new ObjectId(),
    userId: new ObjectId(),
    countryId: "US",
    liquidCapital: 10_000_000_000,
    ...overrides,
  } as unknown as Corporation;
}

function propose(
  target: Corporation,
  priceAnchor: number,
  acquirer?: Corporation,
  freshOverride?: Corporation | null
) {
  // Default fresh read: control unchanged since search. Flip tests override.
  // `null` models a target deleted after search; `undefined` keeps the snapshot.
  db.collection("corporations").findOne.mockResolvedValue(
    freshOverride === undefined ? target : freshOverride
  );
  return proposeAcquisitionOffer(db as unknown as Db, {
    acquirer: acquirer ?? acquirerFixture(),
    target,
    priceAnchor,
    proposerCharacterId: new ObjectId(),
    proposerUserId: new ObjectId(),
    currentTurn: 200,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("acquisitionOffers");
  db.collection("corporations");
  vi.mocked(executeAgreedAcquisition).mockResolvedValue({
    ok: true,
    sectorsMoved: 2,
    priceAnchor: 1_100_000,
    acquirerName: "AcquireCo",
    targetName: "TargetCo",
    bankCharterTransferred: false,
  });
});

describe("proposeAcquisitionOffer against NPP targets (#217)", () => {
  it("auto-accepts at exactly the asking price with no human notification", async () => {
    const r = await propose(targetFixture(), 1_100_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.autoAccepted).toBe(true);
    if (!r.autoAccepted) return;
    expect(r.sectorsMoved).toBe(2);
    expect(r.targetValuationAnchor).toBe(1_000_000);

    const inserted = db.collectionMocks.acquisitionOffers!.insertOne.mock.calls[0][0] as {
      status: string;
    };
    expect(inserted.status).toBe("accepted");
    expect(vi.mocked(executeAgreedAcquisition)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createNotification)).not.toHaveBeenCalled();
    // Other pending offers touching the absorbed shell are withdrawn.
    expect(db.collectionMocks.acquisitionOffers!.updateMany).toHaveBeenCalled();
  });

  it("auto-rejects one unit below the asking price and records the rejection", async () => {
    const r = await propose(targetFixture(), 1_099_999);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
    expect(r.error).toMatch(/asking price/);
    expect(r.error).toMatch(/1,100,000/);

    const inserted = db.collectionMocks.acquisitionOffers!.insertOne.mock.calls[0][0] as {
      status: string;
      resolvedAtTurn: number;
    };
    expect(inserted.status).toBe("rejected");
    expect(inserted.resolvedAtTurn).toBe(200);
    expect(vi.mocked(executeAgreedAcquisition)).not.toHaveBeenCalled();
    expect(vi.mocked(createNotification)).not.toHaveBeenCalled();
  });

  it("surfaces executor guard failures and flips the offer to rejected", async () => {
    vi.mocked(executeAgreedAcquisition).mockResolvedValueOnce({
      ok: false,
      error:
        "The target has outstanding bonds; acquiring an indebted corporation is not yet supported (have it repay or refinance first).",
      status: 400,
    });
    const r = await propose(targetFixture(), 1_100_000);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/outstanding bonds/);
    expect(r.status).toBe(400);
    const sets = db.collectionMocks.acquisitionOffers!.updateOne.mock.calls.map((c) => c[1]);
    expect(sets.some((u) => (u as { $set: { status: string } }).$set.status === "rejected")).toBe(
      true
    );
  });

  it("keeps state-owned targets blocked", async () => {
    const r = await propose(targetFixture({ countryOwnerId: "US" }), 5_000_000);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/State-owned/);
    expect(db.collectionMocks.acquisitionOffers!.insertOne).not.toHaveBeenCalled();
  });

  it("keeps ownership-state nationalized targets blocked even without a country owner", async () => {
    const r = await propose(targetFixture({ ownershipState: "stateOwned" }), 5_000_000);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/State-owned/);
    expect(db.collectionMocks.acquisitionOffers!.insertOne).not.toHaveBeenCalled();
    expect(vi.mocked(executeAgreedAcquisition)).not.toHaveBeenCalled();
  });

  it("flips the accepted offer to rejected when the executor throws and rethrows", async () => {
    vi.mocked(executeAgreedAcquisition).mockRejectedValueOnce(new Error("payout failed"));
    await expect(propose(targetFixture(), 1_100_000)).rejects.toThrow("payout failed");
    const sets = db.collectionMocks.acquisitionOffers!.updateOne.mock.calls.map((c) => c[1]);
    expect(sets.some((u) => (u as { $set: { status: string } }).$set.status === "rejected")).toBe(
      true
    );
  });

  it("keeps self-acquisition, bad prices, divestiture bars, and duplicates blocked", async () => {
    const acquirer = acquirerFixture();
    const selfTarget = { ...targetFixture(), _id: ACQ } as unknown as Corporation;
    expect((await propose(selfTarget, 1_100_000, acquirer)).ok).toBe(false);
    expect((await propose(targetFixture(), 0)).ok).toBe(false);

    const barredAcquirer = acquirerFixture({
      pendingDivestiture: { sectorType: "steel", dueTurn: 100 },
    });
    const barred = await propose(targetFixture(), 1_100_000, barredAcquirer);
    expect(barred.ok).toBe(false);
    if (!barred.ok) expect(barred.status).toBe(403);

    db.collectionMocks.acquisitionOffers!.findOne.mockResolvedValueOnce({ _id: new ObjectId() });
    const dup = await propose(targetFixture(), 1_100_000);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.status).toBe(409);
  });
});

describe("proposeAcquisitionOffer stale-snapshot control flips (#217)", () => {
  beforeEach(() => {
    db.collectionMocks.acquisitionOffers!.insertOne.mockResolvedValue({
      insertedId: new ObjectId(),
    });
  });

  it("falls back to the pending human flow when a caretaker takes control after search", async () => {
    const snapshot = targetFixture();
    const fresh = targetFixture({ caretakerCeo: { displacedCeoId: new ObjectId() } });
    const r = await propose(snapshot, 50_000_000, undefined, fresh);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.autoAccepted).toBe(false);

    const inserted = db.collectionMocks.acquisitionOffers!.insertOne.mock.calls[0][0] as {
      status: string;
    };
    expect(inserted.status).toBe("pending");
    expect(vi.mocked(executeAgreedAcquisition)).not.toHaveBeenCalled();
    expect(vi.mocked(createNotification)).toHaveBeenCalledTimes(1);
  });

  it("falls back to pending when the CEO flips to player-run, even below the asking price", async () => {
    const snapshot = targetFixture();
    const fresh = targetFixture({ ceoType: "character" });
    const r = await propose(snapshot, 500_000, undefined, fresh);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.autoAccepted).toBe(false);
    expect(vi.mocked(executeAgreedAcquisition)).not.toHaveBeenCalled();
    expect(vi.mocked(createNotification)).toHaveBeenCalledTimes(1);
  });

  it("returns 404 with no execution when the target was deleted after search", async () => {
    const r = await propose(targetFixture(), 1_100_000, undefined, null);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(404);
    expect(r.error).toMatch(/no longer exists/);
    expect(db.collectionMocks.acquisitionOffers!.insertOne).not.toHaveBeenCalled();
    expect(vi.mocked(executeAgreedAcquisition)).not.toHaveBeenCalled();
  });

  it("blocks a target nationalized after search, with no execution", async () => {
    const snapshot = targetFixture();
    const fresh = targetFixture({ ownershipState: "stateOwned" });
    const r = await propose(snapshot, 5_000_000, undefined, fresh);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
    expect(r.error).toMatch(/State-owned/);
    expect(db.collectionMocks.acquisitionOffers!.insertOne).not.toHaveBeenCalled();
    expect(vi.mocked(executeAgreedAcquisition)).not.toHaveBeenCalled();
  });
});

describe("proposeAcquisitionOffer human flow regression", () => {
  beforeEach(() => {
    db.collectionMocks.acquisitionOffers!.insertOne.mockResolvedValue({
      insertedId: new ObjectId(),
    });
  });

  it("leaves player-run targets pending with a CEO notification and no execution", async () => {
    const target = targetFixture({ ceoType: "character" });
    const r = await propose(target, 500_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.autoAccepted).toBe(false);

    const inserted = db.collectionMocks.acquisitionOffers!.insertOne.mock.calls[0][0] as {
      status: string;
    };
    expect(inserted.status).toBe("pending");
    expect(vi.mocked(executeAgreedAcquisition)).not.toHaveBeenCalled();
    expect(vi.mocked(createNotification)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createNotification)).toHaveBeenCalledWith(
      expect.objectContaining({ userId: target.userId })
    );
  });

  it("keeps caretaker-run player corps on the human flow, never auto-resolving", async () => {
    const target = targetFixture({ caretakerCeo: { displacedCeoId: new ObjectId() } });
    const r = await propose(target, 50_000_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.autoAccepted).toBe(false);

    const inserted = db.collectionMocks.acquisitionOffers!.insertOne.mock.calls[0][0] as {
      status: string;
    };
    expect(inserted.status).toBe("pending");
    expect(vi.mocked(executeAgreedAcquisition)).not.toHaveBeenCalled();
    expect(vi.mocked(createNotification)).toHaveBeenCalledTimes(1);
  });

  it("leaves imperial targets on the pending flow", async () => {
    const r = await propose(targetFixture({ ceoType: "imperial" }), 50_000_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.autoAccepted).toBe(false);
    expect(vi.mocked(executeAgreedAcquisition)).not.toHaveBeenCalled();
  });
});
