/**
 * Regression test for ticket #0869 — past decades must never lane-lock,
 * regardless of what the corp committed while the decade was current. This
 * is confirmed intended behavior straight from the ticket thread: "that's
 * intended you can only pick one per active decade" and "Only the current
 * and previous decade apply effects" — a past decade's per-turn stat bonuses
 * are already inert (see getSectorTechEffectsForYear), so locking the
 * opposite lane there would only block a no-op. The actual ask in that
 * thread was a UI clarity fix (blur/label on inert history decades in
 * TechTab.tsx), not a lock-enforcement change.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({ resolveCorporation: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/corporations/techTree/featureFlag", () => ({
  isSectorTechTreesEnabled: vi.fn().mockResolvedValue(true),
}));

let db: MockDb;
const corpId = new ObjectId();

function makeCorp(overrides: Record<string, unknown> = {}) {
  return {
    _id: corpId,
    type: "financial",
    isPrivate: false,
    ceoVacant: false,
    userId: new ObjectId(),
    unlockedTechNodeIds: [],
    techDecadeLane: {},
    rdScore: 0,
    liquidCapital: 0,
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("corporateSectors").find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([]),
  });

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);

  const { getGameState } = await import("@/lib/gameState");
  // currentYear 2000 puts the 1979-1989 bracket well into the past.
  vi.mocked(getGameState).mockResolvedValue({
    currentTurn: 1,
    startingYear: 2000,
    currentYear: 2000,
  } as never);
});

describe("GET /api/corporation/[id]/tech", () => {
  it("does not lock either lane in a past decade the corp committed a lane in (ticket #0869)", async () => {
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: makeCorp({
        techDecadeLane: { "1979": "generic" },
        unlockedTechNodeIds: ["corp-1979-1"],
      }),
    } as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/corporation/x/tech"), {
      params: Promise.resolve({ id: corpId.toString() }),
    });
    const body = await res.json();

    const decade1979 = body.decades.find((d: { id: string }) => d.id === "1979");
    expect(decade1979).toBeDefined();
    // Past decades never surface a commitment — both lanes are free to browse.
    expect(decade1979.committedLane).toBeNull();
    expect(decade1979.autoGrantedDecade).toBe(true);

    const sectorRoot = decade1979.lanes.sector.find(
      (n: { id: string }) => n.id === "financial-1979-1"
    );
    expect(sectorRoot.laneLocked).toBe(false);

    const genericRoot = decade1979.lanes.generic.find(
      (n: { id: string }) => n.id === "corp-1979-1"
    );
    expect(genericRoot.laneLocked).toBe(false);
    expect(genericRoot.autoGranted).toBe(true);
  });

  it("does not lock either lane in a past decade the corp never touched", async () => {
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: makeCorp({ techDecadeLane: {}, unlockedTechNodeIds: [] }),
    } as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/corporation/x/tech"), {
      params: Promise.resolve({ id: corpId.toString() }),
    });
    const body = await res.json();

    const decade1979 = body.decades.find((d: { id: string }) => d.id === "1979");
    expect(decade1979.committedLane).toBeNull();
    expect(decade1979.autoGrantedDecade).toBe(true);

    const genericRoot = decade1979.lanes.generic.find(
      (n: { id: string }) => n.id === "corp-1979-1"
    );
    const sectorRoot = decade1979.lanes.sector.find(
      (n: { id: string }) => n.id === "financial-1979-1"
    );
    expect(genericRoot.laneLocked).toBe(false);
    expect(sectorRoot.laneLocked).toBe(false);
  });
});
