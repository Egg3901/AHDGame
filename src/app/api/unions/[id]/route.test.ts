import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import { isUnionsBanned } from "@/lib/labour/unionLaws";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { GET } from "./route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/labour/featureFlag", () => ({ isLabourFullMode: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/unions/unionReconciliation", () => ({ reconcileUnionOwnerCache: vi.fn() }));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 100 }),
}));
vi.mock("@/lib/labour/unionLaws", () => ({ isUnionsBanned: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/auth", () => ({ getAuthUserWithCharacter: vi.fn().mockResolvedValue(null) }));

beforeEach(() => {
  vi.mocked(isUnionsBanned).mockResolvedValue(false);
  vi.mocked(getAuthUserWithCharacter).mockResolvedValue(null);
});

describe("GET banned union underground visibility", () => {
  it.each([
    ["anonymous", null, false, false],
    ["foreign", "GB", false, false],
    ["unrelated domestic", "US", false, true],
    ["domestic organizer", "US", true, true],
    ["domestic leader", "US", true, true],
  ])("limits the cell snapshot for %s visitors", async (role, countryId, canSee, canOrganize) => {
    const memory = createInMemoryDb();
    const id = new ObjectId();
    const characterId = new ObjectId();
    memory.seed("unions", [
      {
        _id: id,
        name: "Test Union",
        countryId: "US",
        sectorType: "manufacturing",
        ownerId: role === "domestic leader" ? characterId : new ObjectId(),
        treasury: 0,
        suspended: true,
        undergroundStrength: 24,
        heat: 76,
        exposedUntilTurn: 105,
      },
    ]);
    if (role === "domestic organizer")
      memory.seed("unionOrganizers", [
        {
          _id: new ObjectId(),
          unionId: id,
          characterId,
          undergroundStrength: 4,
        },
      ]);
    vi.mocked(getDb).mockResolvedValue(memory as unknown as Db);
    vi.mocked(getAuthUserWithCharacter).mockResolvedValue(
      countryId ? ({ character: { _id: characterId, countryId } } as never) : null
    );
    vi.mocked(isUnionsBanned).mockResolvedValue(true);
    const response = await GET(new Request("http://localhost/api/unions/test"), {
      params: Promise.resolve({ id: id.toString() }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.union.suspended).toBe(true);
    if (canSee) {
      expect(body.union.underground).toMatchObject({ strength: 24, status: "exposed" });
    } else if (canOrganize) {
      expect(body.union.underground).toMatchObject({
        strength: null,
        status: null,
        heatText: null,
      });
    } else {
      expect(body.union.underground).toBeNull();
    }
    if (!canSee) expect(JSON.stringify(body.union.underground)).not.toContain("24");
  });
});

describe("GET union paid service entitlement", () => {
  it.each([false, true])("keeps selected and paid services separate, banned=%s", async (banned) => {
    const memory = createInMemoryDb();
    const id = new ObjectId();
    memory.seed("unions", [
      {
        _id: id,
        name: "Test Union",
        countryId: "US",
        sectorType: "manufacturing",
        ownerId: new ObjectId(),
        treasury: 0,
        activeServices: ["training"],
        serviceReceipts: [
          { turn: 100, services: ["healthFund"] },
          { turn: 101, services: ["training"] },
        ],
      },
    ]);
    vi.mocked(getDb).mockResolvedValue(memory as unknown as Db);
    vi.mocked(isUnionsBanned).mockResolvedValue(banned);
    const response = await GET(new Request("http://localhost/api/unions/test"), {
      params: Promise.resolve({ id: id.toString() }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.union.activeServices).toEqual(["training"]);
    expect(body.union.paidServices).toEqual(banned ? [] : ["healthFund"]);
  });
});
