/**
 * Offer layer for the subsidiary outcome: the choice is stored on the offer,
 * surfaced in the Deals list, validated at propose time, and an AI-run
 * subsidiary of another corporation is never auto-resolved from under its owner.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { proposeAcquisitionOffer, listDealsForCorp } from "./acquisitionOffers";
import { executeAgreedAcquisition } from "./executeAgreedAcquisition";
import { checkSubsidiaryAcquisition } from "./subsidiaryOutcome";
import { createNotification } from "@/lib/notifications";

vi.mock("./executeAgreedAcquisition", () => ({ executeAgreedAcquisition: vi.fn() }));
vi.mock("./subsidiaryOutcome", () => ({ checkSubsidiaryAcquisition: vi.fn() }));
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

function corp(id: ObjectId, name: string, extra: Record<string, unknown> = {}) {
  return {
    _id: id,
    name,
    ceoType: "character",
    ceoId: new ObjectId(),
    userId: new ObjectId(),
    countryId: "US",
    sharePrice: 100,
    totalShares: 10_000,
    liquidCapital: 10_000_000_000,
    ...extra,
  } as unknown as Corporation;
}

function propose(target: Corporation, priceAnchor: number, outcome?: "merge" | "subsidiary") {
  db.collection("corporations").findOne.mockResolvedValue(target);
  return proposeAcquisitionOffer(db as unknown as Db, {
    acquirer: corp(ACQ, "AcquireCo"),
    target,
    priceAnchor,
    proposerCharacterId: new ObjectId(),
    proposerUserId: new ObjectId(),
    currentTurn: 200,
    ...(outcome ? { outcome } : {}),
  });
}

function inserted() {
  return db.collectionMocks.acquisitionOffers!.insertOne.mock.calls[0][0] as Record<
    string,
    unknown
  >;
}

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("acquisitionOffers");
  db.collection("corporations");
  db.collectionMocks.acquisitionOffers!.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
  vi.mocked(checkSubsidiaryAcquisition).mockResolvedValue({ ok: true });
  vi.mocked(executeAgreedAcquisition).mockResolvedValue({
    ok: true,
    sectorsMoved: 0,
    priceAnchor: 1_100_000,
    acquirerName: "AcquireCo",
    targetName: "TargetCo",
    bankCharterTransferred: false,
    outcome: "subsidiary",
  });
});

describe("proposeAcquisitionOffer outcome", () => {
  it("stores no outcome on a merge offer, keeping the legacy document shape", async () => {
    const r = await propose(corp(TGT, "TargetCo"), 500_000);
    expect(r.ok).toBe(true);
    expect("outcome" in inserted()).toBe(false);
    expect(checkSubsidiaryAcquisition).not.toHaveBeenCalled();
    expect(vi.mocked(createNotification).mock.calls[0][0].message).not.toMatch(/subsidiary/);
  });

  it("stores the subsidiary outcome and tells the target's CEO what is on offer", async () => {
    const r = await propose(corp(TGT, "TargetCo"), 500_000, "subsidiary");
    expect(r.ok).toBe(true);
    expect(inserted().outcome).toBe("subsidiary");
    expect(checkSubsidiaryAcquisition).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createNotification).mock.calls[0][0].message).toMatch(
      /keep it as a subsidiary/
    );
  });

  it("refuses with the eligibility reason before storing anything", async () => {
    vi.mocked(checkSubsidiaryAcquisition).mockResolvedValueOnce({
      ok: false,
      error: "That corporation controls other corporations, and subsidiaries cannot be chained.",
      status: 400,
    });
    const r = await propose(corp(TGT, "TargetCo"), 500_000, "subsidiary");
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(db.collectionMocks.acquisitionOffers!.insertOne).not.toHaveBeenCalled();
  });

  it("auto-resolves an AI-run target as a subsidiary and passes the outcome to the executor", async () => {
    // valuation 1_000_000, asking price 1_100_000
    const target = corp(TGT, "TargetCo", { ceoType: "npp", liquidCapital: 0 });
    const r = await propose(target, 1_100_000, "subsidiary");
    expect(r.ok).toBe(true);
    if (!r.ok || !r.autoAccepted) throw new Error("expected an auto-accepted offer");
    expect(r.outcome).toBe("subsidiary");
    const offerArg = vi.mocked(executeAgreedAcquisition).mock.calls[0][0].offer;
    expect(offerArg.outcome).toBe("subsidiary");
    // Same asking price as a merge: the outcome does not change the price gate.
    const low = await propose(target, 1_099_999, "subsidiary");
    expect(low.ok).toBe(false);
  });

  it("never auto-resolves an AI-run corporation that another corporation controls", async () => {
    const parent = new ObjectId();
    const target = corp(TGT, "TargetCo", {
      ceoType: "npp",
      liquidCapital: 0,
      shareholders: [{ corporationId: parent, shares: 10_000 }],
    });
    for (const outcome of ["merge", "subsidiary"] as const) {
      const r = await propose(target, 50_000_000, outcome);
      expect(r).toMatchObject({ ok: false, status: 400 });
      if (!r.ok) expect(r.error).toMatch(/controlled by another corporation/);
    }
    expect(db.collectionMocks.acquisitionOffers!.insertOne).not.toHaveBeenCalled();
    expect(executeAgreedAcquisition).not.toHaveBeenCalled();
  });
});

describe("listDealsForCorp outcome", () => {
  it("labels legacy offers as merges and new ones by their stored outcome", async () => {
    const base = {
      acquirerCorporationId: ACQ,
      targetCorporationId: TGT,
      priceAnchor: 1,
      targetValuationAnchor: 1,
      status: "pending",
      expiresAtTurn: 999,
      createdAt: new Date(),
    };
    const legacyId = new ObjectId();
    const subId = new ObjectId();
    db.collection("acquisitionOffers").find.mockReturnValue({
      sort: () => ({
        toArray: async () => [
          { _id: legacyId, ...base },
          { _id: subId, ...base, outcome: "subsidiary" },
        ],
      }),
    });
    db.collection("corporations").find.mockReturnValue({
      project: () => ({
        toArray: async () => [
          { _id: ACQ, name: "AcquireCo" },
          { _id: TGT, name: "TargetCo" },
        ],
      }),
    });
    const { outgoing } = await listDealsForCorp(db as unknown as Db, ACQ);
    expect(outgoing.map((o) => o.outcome)).toEqual(["merge", "subsidiary"]);
  });
});
