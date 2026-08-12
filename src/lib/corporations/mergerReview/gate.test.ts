import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { MergerReview } from "@/lib/db/types/mergerReview";

vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn().mockResolvedValue({ currentYear: 1953 }) }));
vi.mock("@/lib/market/featureFlag", () => ({
  getMarketSystemModeForDb: vi.fn().mockResolvedValue("off"),
  marketAtLeast: () => false,
}));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/politicalLegislation/enactedLevels", () => ({ getEnactedLevel: vi.fn() }));
vi.mock("@/lib/economy/queries/commandEconomyMarketGate", () => ({
  loadCommandEconomyBlockedCountries: vi.fn(),
}));
vi.mock("./concentration", () => ({ computeMergerConcentration: vi.fn() }));
vi.mock("./authority", () => ({ resolveMergerAuthority: vi.fn() }));

import { getEnactedLevel } from "@/lib/politicalLegislation/enactedLevels";
import { loadCommandEconomyBlockedCountries } from "@/lib/economy/queries/commandEconomyMarketGate";
import { computeMergerConcentration } from "./concentration";
import { resolveMergerAuthority } from "./authority";
import { acquisitionsBarredByDivestiture, assertMergerClearance } from "./gate";

const ACQ = new ObjectId();
const TGT = new ObjectId();

function makeCorp(over: Partial<Corporation> = {}): Corporation {
  return {
    _id: ACQ,
    name: "AcquireCo",
    countryId: "US",
    ...over,
  } as Corporation;
}

function makeDb(existingReview: MergerReview | null = null) {
  const insertOne = vi.fn().mockResolvedValue({ acknowledged: true });
  const db = {
    collection: vi.fn((name: string) => {
      if (name === "mergerReviews")
        return { findOne: vi.fn().mockResolvedValue(existingReview), insertOne };
      return {};
    }),
  } as unknown as Db;
  return { db, insertOne };
}

const acquirer = () => makeCorp();
const target = () => makeCorp({ _id: TGT, name: "TargetCo", countryId: "US" });

describe("assertMergerClearance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadCommandEconomyBlockedCountries).mockResolvedValue(new Set());
    vi.mocked(getEnactedLevel).mockResolvedValue(2); // threshold 60
    vi.mocked(resolveMergerAuthority).mockResolvedValue({
      seatId: "attorney_general",
      seatName: "Attorney General",
      countryId: "US",
    });
    vi.mocked(computeMergerConcentration).mockResolvedValue({
      overlaps: [],
      leadSectorType: "manufacturing",
      combinedSharePercent: 70,
    } as never);
  });

  it("refers a deal at or above the threshold and opens exactly one review", async () => {
    const { db, insertOne } = makeDb();
    const r = await assertMergerClearance(db, acquirer(), target(), "agreedAcquisition", 100);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(r.review.status).toBe("pending");
      expect(r.review.thresholdPercent).toBe(60);
      expect(r.review.decideByTurn).toBeGreaterThan(100);
    }
    expect(insertOne).toHaveBeenCalledTimes(1);
  });

  it("lets a deal under the threshold through without opening a review", async () => {
    vi.mocked(computeMergerConcentration).mockResolvedValue({
      overlaps: [],
      leadSectorType: "manufacturing",
      combinedSharePercent: 59.99,
    } as never);
    const { db, insertOne } = makeDb();
    const r = await assertMergerClearance(db, acquirer(), target(), "agreedAcquisition", 100);
    expect(r.ok).toBe(true);
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("is inert at enforcement level 0 — no authority to refer to", async () => {
    vi.mocked(getEnactedLevel).mockResolvedValue(0);
    const { db, insertOne } = makeDb();
    const r = await assertMergerClearance(db, acquirer(), target(), "agreedAcquisition", 100);
    expect(r.ok).toBe(true);
    expect(insertOne).not.toHaveBeenCalled();
    // The expensive concentration rollup must not even run.
    expect(vi.mocked(computeMergerConcentration)).not.toHaveBeenCalled();
  });

  it("is inert in a command economy, without consulting any country list", async () => {
    vi.mocked(loadCommandEconomyBlockedCountries).mockResolvedValue(new Set(["US"]) as never);
    const { db, insertOne } = makeDb();
    const r = await assertMergerClearance(db, acquirer(), target(), "agreedAcquisition", 100);
    expect(r.ok).toBe(true);
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("is inert when either side is state-owned", async () => {
    const { db } = makeDb();
    const stateOwned = makeCorp({ _id: TGT, ownershipState: "stateOwned", countryId: "US" });
    expect((await assertMergerClearance(db, acquirer(), stateOwned, "agreedAcquisition", 100)).ok).toBe(
      true
    );
    const stateAcquirer = makeCorp({ countryOwnerId: "US" as never });
    expect(
      (await assertMergerClearance(db, stateAcquirer, target(), "agreedAcquisition", 100)).ok
    ).toBe(true);
  });

  it("blocks on a pending review instead of opening a second one", async () => {
    const pending = {
      status: "pending",
      decideByTurn: 106,
      countryId: "US",
    } as unknown as MergerReview;
    const { db, insertOne } = makeDb(pending);
    const r = await assertMergerClearance(db, acquirer(), target(), "hostileTakeover", 101);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("blocks permanently on a blocked review", async () => {
    const blocked = { status: "blocked", countryId: "US" } as unknown as MergerReview;
    const { db } = makeDb(blocked);
    const r = await assertMergerClearance(db, acquirer(), target(), "hostileTakeover", 101);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("passes a cleared pair straight through, carrying the clearance", async () => {
    const cleared = { status: "clearedWithRemedy", remedySectorType: "steel" } as unknown as MergerReview;
    const { db } = makeDb(cleared);
    const r = await assertMergerClearance(db, acquirer(), target(), "hostileTakeover", 101);
    expect(r.ok).toBe(true);
    expect(r.review?.remedySectorType).toBe("steel");
    // Durable clearance short-circuits the whole measurement.
    expect(vi.mocked(computeMergerConcentration)).not.toHaveBeenCalled();
  });
});

describe("acquisitionsBarredByDivestiture", () => {
  const obligation = {
    reviewId: new ObjectId(),
    sectorType: "steel" as const,
    dueTurn: 120,
    thresholdPercent: 60,
    countryId: "US",
  };

  it("does not bar while the order is still current", () => {
    expect(
      acquisitionsBarredByDivestiture({ pendingDivestiture: obligation } as never, 120)
    ).toBeNull();
  });

  it("bars once the deadline has passed", () => {
    const msg = acquisitionsBarredByDivestiture({ pendingDivestiture: obligation } as never, 121);
    expect(msg).toMatch(/overdue order to divest/i);
  });

  it("does not bar a corporation under no order", () => {
    expect(acquisitionsBarredByDivestiture({} as never, 999)).toBeNull();
  });
});
