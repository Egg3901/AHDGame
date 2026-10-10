import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { RESET_V2_SEED_REVISION } from "@/lib/resetVersions/rules";
import { resetActionsForSeat } from "@/lib/resetCabinet/catalog";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db/runRequiredTransaction", () => ({
  runRequiredTransaction: vi.fn(async (body) => body({ id: "session" })),
}));
const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const { POST } = await import("./route");

describe("POST Cabinet v2 action", () => {
  let db: MockDb;
  const holder = new ObjectId();
  let gameState: Record<string, unknown>;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { character: { _id: holder } },
    } as never);
    gameState = {
      _id: "current",
      currentTurn: 10,
      currentYear: 1991,
      resetWorldId: "world",
      metricsSystemVersion: "v2",
      cabinetSystemVersion: "v2",
      resetVersionSeeds: Object.fromEntries(
        ["metrics", "cabinet"].map((system) => [
          system,
          {
            worldId: "world",
            revision: RESET_V2_SEED_REVISION[system as "metrics" | "cabinet"],
            sourceTurn: 1,
            completedAt: "verified",
            verificationHash: "hash",
          },
        ])
      ),
    };
    db.collection("gameState").findOne.mockImplementation(async () => gameState);
    db.collection("cabinetMembers").findOne.mockResolvedValue({ characterId: holder });
    db.collection("resetCabinetActionStates").findOne.mockResolvedValue({
      _id: "JP",
      worldId: "world",
      sourceTurn: 1,
      updatedTurn: 1,
      actorStates: {},
      active: [],
      history: [],
    });
    db.collection("federalBudget").findOne.mockResolvedValue({ gdp: 1_000_000 });
  });

  const issue = (country = "JP", seat = "chief_cabinet_secretary", costClass = "Staff") => {
    const action = resetActionsForSeat(country as "JP", seat).find(
      (row) => row.costClass === costClass
    )!;
    return POST(
      new Request("http://localhost/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId: action.id }),
      }),
      { params: Promise.resolve({ code: country.toLowerCase(), positionId: seat }) }
    );
  };

  it("runs the reported Japan Staff action without a legislative account", async () => {
    const response = await issue();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ operatingDebit: 0, chargesRemaining: 3 });
    expect(db.collectionMocks.resetDepartmentAccounts.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.resetCabinetActionStates.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ worldId: "world" }),
      expect.anything(),
      expect.objectContaining({ session: expect.anything() })
    );
  });
  it("allows Staff work in a zero-authority ministry but blocks unfunded cash actions", async () => {
    const account = {
      _id: "US:justice",
      worldId: "world",
      annualAuthority: 0,
      balance: 0,
      encumbered: 0,
      externallySettled: false,
    };
    db.collection("resetDepartmentAccounts").find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([account]),
    });
    expect((await issue("US", "attorney_general")).status).toBe(200);
    const response = await issue("US", "attorney_general", "Ops");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "insufficient_funds" });
  });
  it("debits funded paid actions without spending encumbered money", async () => {
    db.collection("resetDepartmentAccounts").find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "US:justice",
          worldId: "world",
          annualAuthority: 0,
          balance: 100,
          encumbered: 30,
          externallySettled: false,
        },
      ]),
    });
    const response = await issue("US", "attorney_general", "Ops");
    expect(response.status).toBe(200);
    expect(db.collectionMocks.resetDepartmentAccounts.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ balance: 100, encumbered: 30, worldId: "world" }),
      { $inc: { balance: -10 } },
      expect.objectContaining({ session: expect.anything() })
    );
  });
  it("preserves the specialized intelligence budget while permitting Staff work", async () => {
    expect((await issue("US", "director_of_intelligence")).status).toBe(200);
    expect(db.collectionMocks.federalBudget.updateOne).not.toHaveBeenCalled();
  });
  it("rejects another player and a vacant office", async () => {
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({ characterId: new ObjectId() });
    expect((await issue()).status).toBe(403);
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue(null);
    expect((await issue()).status).toBe(403);
  });
  it("rejects inactive seats and unverified worlds without writes", async () => {
    const inactive = await issue("US", "secretary_of_homeland");
    expect(inactive.status).toBe(409);
    expect(await inactive.json()).toMatchObject({ error: "inactive_seat" });
    gameState.cabinetSystemVersion = "v1";
    expect((await issue()).status).toBe(409);
    expect(db.collectionMocks.resetCabinetActionStates.updateOne).not.toHaveBeenCalled();
  });
});
