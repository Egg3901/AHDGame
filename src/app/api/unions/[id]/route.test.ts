import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import { isUnionsBanned } from "@/lib/labour/unionLaws";
import { GET } from "./route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/labour/featureFlag", () => ({ isLabourFullMode: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/unions/unionReconciliation", () => ({ reconcileUnionOwnerCache: vi.fn() }));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 100 }),
}));
vi.mock("@/lib/labour/unionLaws", () => ({ isUnionsBanned: vi.fn().mockResolvedValue(false) }));

beforeEach(() => vi.mocked(isUnionsBanned).mockResolvedValue(false));

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
