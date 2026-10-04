import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const { live, autonomy, context } = vi.hoisted(() => ({
  live: vi.fn(),
  autonomy: vi.fn(),
  context: vi.fn(),
}));
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/turn/perpetualElections/shared", () => ({
  countryElectionsLive: live,
  ensureRegionalDelegateElections: vi.fn(),
  ensureRegionalGovernorElections: vi.fn(),
  seatsFromRegionField: vi.fn(),
}));
vi.mock("@/lib/nppAutonomy/featureFlag", () => ({ isNppAutonomyActive: autonomy }));
vi.mock("@/lib/turn/perpetualElections/engine", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/turn/perpetualElections/engine")>()),
  getCurrentTurnAndCtx: context,
}));
import { ensureBRPresidentialElection } from "./perpetual";

let mock: MockDb;
const now = new Date("2026-10-04T03:00:00Z");
beforeEach(async () => {
  vi.clearAllMocks();
  mock = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(mock as unknown as Db);
  live.mockResolvedValue(false);
  autonomy.mockResolvedValue(true);
  context.mockResolvedValue({
    currentTurn: 1,
    ctx: { preset: "1991-default", startingYear: 1991 },
  });
});

describe("Brazil ordinary presidential spawning", () => {
  it("opens successive ordinary cycles in an autonomous background country and retains era rules", async () => {
    await ensureBRPresidentialElection(now, 1);
    const first = mock.collection("elections").updateOne.mock.calls[0][1].$setOnInsert;
    expect(first).toMatchObject({
      countryId: "BR",
      electionType: "president",
      cycle: 1,
      endTurn: 192,
      brazilPresidentialMode: "majority",
    });
    mock
      .collection("elections")
      .findOne.mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...first,
        _id: new ObjectId(),
        status: "resolved",
        updatedAt: now,
      });
    await ensureBRPresidentialElection(new Date(now.getTime() + 3600000), 193);
    const second = mock.collection("elections").updateOne.mock.calls[1][1].$setOnInsert;
    expect(second.cycle).toBe(2);
    expect(second.endTurn - first.endTurn).toBe(192);
    expect(second.brazilPresidentialMode).toBe("majority");
  });
  it("keeps an in-progress first round or runoff as the only active presidency race", async () => {
    mock
      .collection("elections")
      .findOne.mockResolvedValue({ status: "active", brazilPresidentialRound: 2 });
    await ensureBRPresidentialElection(now, 200);
    expect(mock.collection("elections").updateOne).not.toHaveBeenCalled();
  });
  it("pins the 1979 congressional selection independently of the US calendar", async () => {
    context.mockResolvedValue({
      currentTurn: 1,
      ctx: { preset: "1979-default", startingYear: 1979 },
    });
    await ensureBRPresidentialElection(now, 1);
    expect(mock.collection("elections").updateOne.mock.calls[0][1].$setOnInsert).toMatchObject({
      endTurn: 336,
      brazilPresidentialMode: "indirect",
    });
  });
  it("leaves a non-enabled country without autonomy inactive", async () => {
    autonomy.mockResolvedValue(false);
    await ensureBRPresidentialElection(now, 1);
    expect(context).not.toHaveBeenCalled();
    expect(mock.collection("elections").updateOne).not.toHaveBeenCalled();
  });
});
