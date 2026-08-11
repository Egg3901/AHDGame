import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { STAT_KEYS, type CharacterStats } from "@/lib/stats/statsConstants";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireHumanSession: vi.fn() }));
vi.mock("@/lib/stats/featureFlag", () => ({ isRpgStatsEnabled: vi.fn() }));

const userId = new ObjectId();
const characterId = new ObjectId();

/** A legal 28-point build (4 in each of the seven stats). */
function legalBuild(): CharacterStats {
  return STAT_KEYS.reduce((acc, k) => {
    acc[k] = 4;
    return acc;
  }, {} as CharacterStats);
}

function makeRequest(stats: unknown): Request {
  return new Request("http://localhost/api/character/reallocate-stats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stats }),
  });
}

async function callRoute(request: Request) {
  const { POST } = await import("./route");
  return POST(request);
}

/** Seed users + characters findOne so loadActiveCharacter resolves `character`. */
function seedCharacter(db: MockDb, character: Record<string, unknown> | null) {
  const users = db.collection("users") as ReturnType<MockDb["collection"]>;
  users.findOne.mockResolvedValue({ _id: userId, activeCharacterId: characterId });
  const characters = db.collection("characters") as ReturnType<MockDb["collection"]>;
  characters.findOne.mockResolvedValue(character);
  return characters;
}

describe("POST /api/character/reallocate-stats", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireHumanSession } = await import("@/lib/api/requireAuth");
    vi.mocked(requireHumanSession).mockResolvedValue({
      ok: true,
      user: { userId: userId.toHexString() },
    } as Awaited<ReturnType<typeof requireHumanSession>>);

    const { isRpgStatsEnabled } = await import("@/lib/stats/featureFlag");
    vi.mocked(isRpgStatsEnabled).mockResolvedValue(true);
  });

  it("returns 403 when the stat system is disabled", async () => {
    const { isRpgStatsEnabled } = await import("@/lib/stats/featureFlag");
    vi.mocked(isRpgStatsEnabled).mockResolvedValue(false);

    const res = await callRoute(makeRequest(legalBuild()));
    expect(res.status).toBe(403);
  });

  it("returns 400 for an illegal allocation (wrong point total)", async () => {
    const bad = legalBuild();
    bad.charisma = 10; // total now 34, not 28
    const res = await callRoute(makeRequest(bad));
    expect(res.status).toBe(400);
  });

  it("returns 409 when stats were never allocated", async () => {
    seedCharacter(db, { _id: characterId, userId, statsAllocated: false });
    const res = await callRoute(makeRequest(legalBuild()));
    expect(res.status).toBe(409);
  });

  it("returns 409 when the free reallocation was already used", async () => {
    seedCharacter(db, {
      _id: characterId,
      userId,
      statsAllocated: true,
      statsReallocationUsed: true,
    });
    const res = await callRoute(makeRequest(legalBuild()));
    expect(res.status).toBe(409);
  });

  it("returns 409 when the atomic guard loses the race (matchedCount 0)", async () => {
    const characters = seedCharacter(db, {
      _id: characterId,
      userId,
      statsAllocated: true,
    });
    characters.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    const res = await callRoute(makeRequest(legalBuild()));
    expect(res.status).toBe(409);
  });

  it("resets the stat block and spends the free reallocation on success", async () => {
    const characters = seedCharacter(db, {
      _id: characterId,
      userId,
      statsAllocated: true,
      statXp: { charisma: 0.9 },
    });
    characters.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    const res = await callRoute(makeRequest(legalBuild()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    const [filter, update] = characters.updateOne.mock.calls[0];
    // Atomic guard only fires while the reallocation is still unused.
    expect(filter.statsAllocated).toBe(true);
    expect(filter.statsReallocationUsed).toEqual({ $ne: true });
    // Full reset: new spread, growth cleared, flag spent, decay anchor reset.
    expect(update.$set.stats).toEqual(legalBuild());
    expect(update.$set.statXp).toEqual({});
    expect(update.$set.statsReallocationUsed).toBe(true);
    expect(update.$set.debateDecayAnchor).toBeInstanceOf(Date);
  });
});
