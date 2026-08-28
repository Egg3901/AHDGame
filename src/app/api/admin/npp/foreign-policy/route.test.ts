import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

function cursor(rows: unknown[]) {
  return {
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(rows),
  };
}

describe("admin autonomous foreign policy ledger", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { username: "tester" },
    } as never);
  });

  it("returns bounded decision, trade, embargo, and conflict telemetry", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 200,
      nppForeignPolicyMode: "active",
      nppForeignPolicyStage: "trade",
    });
    db.collection("nppForeignPolicyDecisions").find.mockReturnValue(
      cursor([
        {
          countryId: "FR",
          turn: 199,
          selected: { type: "vote_org_no", score: 60, targetCountryId: "RU", reasons: [] },
          acted: true,
          executionStatus: "executed",
          executionNote: "Cast an organization no vote.",
        },
      ])
    );
    db.collection("tradeEmbargoes").find.mockReturnValue(
      cursor([
        {
          sourceCountry: "FR",
          targetCountry: "RU",
          createdTurn: 190,
          expiresTurn: 210,
        },
      ])
    );
    db.collection("tradeFlowSnapshots").find.mockReturnValue(
      cursor([
        { turn: 200, world: { grossVolume: 110 } },
        { turn: 199, world: { grossVolume: 100 } },
      ])
    );
    db.collection("conflicts").countDocuments.mockResolvedValue(2);
    const { GET } = await import("./route");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      currentTurn: 200,
      fromTurn: 81,
      rollout: { mode: "active", stage: "trade" },
      summary: { totals: { decisions: 1, acted: 1, vetoes: 1 } },
      embargoes: { active: 1, activePairs: 1, averageTemporaryDurationTurns: 20 },
      trade: { grossVolume: 110, previousGrossVolume: 100, changePercent: 10 },
      activeConflictCount: 2,
    });
  });
});
