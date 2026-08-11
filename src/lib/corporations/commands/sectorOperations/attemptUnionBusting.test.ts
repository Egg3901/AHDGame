import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { attemptUnionBusting } from "./attemptUnionBusting";

// Standalone-Mongo simulation, matching src/lib/indexFunds/fundCron.test.ts's
// precedent — runs the sequential (non-transaction) fallback branch directly.
vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: vi
    .fn()
    .mockImplementation(async (_withSession: unknown, withoutSession: () => Promise<void>) => {
      return withoutSession();
    }),
}));

vi.mock("@/lib/corporations/sentimentEvents", () => ({
  fireUnionBustingSuccessPulse: vi.fn().mockResolvedValue(undefined),
  fireUnionBustingBackfirePulse: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/labour/unionBusting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/labour/unionBusting")>();
  return { ...actual, rollD100: vi.fn() };
});

function makeCorp(overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: new ObjectId(),
    type: "manufacturing",
    liquidCapital: 1_000_000,
    userId: new ObjectId(),
    ceoId: new ObjectId(),
    name: "TestCorp",
    countryId: "US",
    ...overrides,
  } as unknown as Corporation;
}

function makeSector(corpId: ObjectId, overrides: Partial<CorporateSector> = {}): CorporateSector {
  return {
    _id: new ObjectId(),
    corporationId: corpId,
    countryId: "US",
    sectorType: "manufacturing",
    revenue: 24_000, // daily gross 24k -> BUSTING_COST_REVENUE_FRACTION(0.5) * 24000 = 12000
    unionization: 0,
    bustingCooldownUntilTurn: null,
    ...overrides,
  } as unknown as CorporateSector;
}

/** Mock db: corporateSectors.findOne/updateOne, corporations.updateOne, gameState.findOne (not processing by default). */
function mockDb({
  sector,
  sectorUpdateModifiedCount = 1,
  corpUpdateModifiedCount = 1,
  isProcessing = false,
}: {
  sector: CorporateSector;
  sectorUpdateModifiedCount?: number;
  corpUpdateModifiedCount?: number;
  isProcessing?: boolean;
}) {
  const sectorUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: sectorUpdateModifiedCount });
  const corpUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: corpUpdateModifiedCount });
  const db = {
    collection: (name: string) => {
      if (name === "corporateSectors") {
        return {
          findOne: vi.fn().mockResolvedValue(sector),
          updateOne: sectorUpdateOne,
        };
      }
      if (name === "corporations") {
        return { updateOne: corpUpdateOne };
      }
      // Union-ban gate (player suggestion #93): no ban in these scenarios.
      if (name === "federalBudget") {
        return { findOne: vi.fn().mockResolvedValue({ unionsBanned: false }) };
      }
      if (name === "gameState") {
        return {
          findOne: vi
            .fn()
            .mockResolvedValue(
              isProcessing
                ? { isProcessing: true, processingHeartbeatAt: new Date() }
                : { isProcessing: false }
            ),
        };
      }
      // The cash cost now resolves the market tier: below plants the base is
      // `sector.revenue` exactly as before, at/above plants it is
      // max(revenue, capacity nameplate) so a MOTHBALLED sector (revenue 0)
      // cannot be busted for free. Null ⇒ default mode ⇒ legacy basis, which is
      // what every assertion in this file is written against.
      if (name === "gameConfig") {
        return { findOne: vi.fn().mockResolvedValue(null) };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  } as unknown as Db;
  return { db, sectorUpdateOne, corpUpdateOne };
}

describe("attemptUnionBusting", () => {
  it("returns 404 for a nonexistent sector", async () => {
    const corp = makeCorp();
    const db = {
      collection: (name: string) => {
        if (name === "corporateSectors") return { findOne: vi.fn().mockResolvedValue(null) };
        if (name === "gameState")
          return { findOne: vi.fn().mockResolvedValue({ isProcessing: false }) };
        return { updateOne: vi.fn() };
      },
    } as unknown as Db;

    const result = await attemptUnionBusting(db, corp, new ObjectId().toString(), 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });

  it("returns 409 when the sector is still in a busting cooldown", async () => {
    const corp = makeCorp();
    const sector = makeSector(corp._id, { bustingCooldownUntilTurn: 20 });
    const { db } = mockDb({ sector });

    const result = await attemptUnionBusting(db, corp, sector._id.toString(), 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("returns 402 when the corp cannot afford the attempt", async () => {
    const corp = makeCorp({ liquidCapital: 100 }); // well below the 12,000 cost
    const sector = makeSector(corp._id);
    const { db } = mockDb({ sector });

    const result = await attemptUnionBusting(db, corp, sector._id.toString(), 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(402);
  });

  it("on success: drops unionization, deducts cash, sets cooldown", async () => {
    const { rollD100 } = await import("@/lib/labour/unionBusting");
    vi.mocked(rollD100).mockReturnValue(1); // guaranteed success (finalChance >= 20)

    const corp = makeCorp();
    const sector = makeSector(corp._id, { unionization: 50 });
    const { db, sectorUpdateOne, corpUpdateOne } = mockDb({ sector });

    const result = await attemptUnionBusting(db, corp, sector._id.toString(), 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.success).toBe(true);
    expect(result.unionization).toBeLessThan(50);

    const [sectorFilter, sectorUpdate] = sectorUpdateOne.mock.calls[0];
    expect(sectorFilter._id).toStrictEqual(sector._id);
    expect(sectorUpdate.$set.bustingCooldownUntilTurn).toBe(10 + 12); // BUSTING_COOLDOWN_TURNS
    expect(corpUpdateOne).toHaveBeenCalledTimes(1);
    const [corpFilter, corpUpdate] = corpUpdateOne.mock.calls[0];
    expect(corpFilter._id).toStrictEqual(corp._id);
    expect(corpUpdate.$inc.liquidCapital).toBeLessThan(0);
  });

  it("on backfire: raises unionization instead of dropping it", async () => {
    const { rollD100 } = await import("@/lib/labour/unionBusting");
    vi.mocked(rollD100).mockReturnValue(100); // guaranteed failure

    const corp = makeCorp();
    const sector = makeSector(corp._id, { unionization: 50 });
    const { db } = mockDb({ sector });

    const result = await attemptUnionBusting(db, corp, sector._id.toString(), 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.success).toBe(false);
    expect(result.unionization).toBeGreaterThan(50);
  });

  it("compensates the corp debit when the sector write races (cooldown set concurrently)", async () => {
    const { rollD100 } = await import("@/lib/labour/unionBusting");
    vi.mocked(rollD100).mockReturnValue(1);

    const corp = makeCorp();
    const sector = makeSector(corp._id);
    const { db, sectorUpdateOne } = mockDb({ sector, sectorUpdateModifiedCount: 0 });

    const result = await attemptUnionBusting(db, corp, sector._id.toString(), 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    // Only the guarded (failed) update should have run — no compensation needed
    // since the sector write is attempted before the cash debit.
    expect(sectorUpdateOne).toHaveBeenCalledTimes(1);
  });

  it("rejects while a turn is actively processing (avoids the clobber race with the corp turn's bulk write)", async () => {
    const corp = makeCorp();
    const sector = makeSector(corp._id);
    const { db, sectorUpdateOne, corpUpdateOne } = mockDb({ sector, isProcessing: true });

    const result = await attemptUnionBusting(db, corp, sector._id.toString(), 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    expect(sectorUpdateOne).not.toHaveBeenCalled();
    expect(corpUpdateOne).not.toHaveBeenCalled();
  });

  it("a successful bust also ends an active strike (clears strikeStartedAtTurn, sets strikeCooldownUntilTurn)", async () => {
    const { rollD100 } = await import("@/lib/labour/unionBusting");
    vi.mocked(rollD100).mockReturnValue(1); // guaranteed success

    const corp = makeCorp();
    const sector = makeSector(corp._id, {
      unionization: 50,
      strikeStartedAtTurn: 8,
      strikeCooldownUntilTurn: null,
    });
    const { db, sectorUpdateOne } = mockDb({ sector });

    const result = await attemptUnionBusting(db, corp, sector._id.toString(), 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.success).toBe(true);

    const [, sectorUpdate] = sectorUpdateOne.mock.calls[0];
    expect(sectorUpdate.$set.strikeStartedAtTurn).toBeNull();
    expect(sectorUpdate.$set.strikeCooldownUntilTurn).toBe(10 + 12); // STRIKE_COOLDOWN_TURNS
  });

  it("a backfired bust leaves an active strike untouched", async () => {
    const { rollD100 } = await import("@/lib/labour/unionBusting");
    vi.mocked(rollD100).mockReturnValue(100); // guaranteed failure

    const corp = makeCorp();
    const sector = makeSector(corp._id, {
      unionization: 50,
      strikeStartedAtTurn: 8,
      strikeCooldownUntilTurn: null,
    });
    const { db, sectorUpdateOne } = mockDb({ sector });

    const result = await attemptUnionBusting(db, corp, sector._id.toString(), 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.success).toBe(false);

    const [, sectorUpdate] = sectorUpdateOne.mock.calls[0];
    expect(sectorUpdate.$set.strikeStartedAtTurn).toBeUndefined();
    expect(sectorUpdate.$set.strikeCooldownUntilTurn).toBeUndefined();
  });
});

describe("attemptUnionBusting — union ban gate (player suggestion #93)", () => {
  it("returns 403 while the sector's country has unionsBanned (busting is moot)", async () => {
    const corp = makeCorp();
    const sector = makeSector(corp._id, { unionization: 60 });
    const sectorUpdateOne = vi.fn();
    const db = {
      collection: (name: string) => {
        if (name === "corporateSectors")
          return { findOne: vi.fn().mockResolvedValue(sector), updateOne: sectorUpdateOne };
        if (name === "federalBudget")
          return { findOne: vi.fn().mockResolvedValue({ unionsBanned: true }) };
        if (name === "gameState")
          return { findOne: vi.fn().mockResolvedValue({ isProcessing: false }) };
        throw new Error(`unexpected collection ${name}`);
      },
    } as unknown as Db;

    const result = await attemptUnionBusting(db, corp, sector._id.toString(), 10);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.error).toMatch(/banned under current law/i);
    }
    expect(sectorUpdateOne).not.toHaveBeenCalled();
  });
});
