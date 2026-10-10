import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { buildOpeningMetricSnapshots1991 } from "./seedOpening1991";
import { RESET_V2_SEED_REVISION } from "@/lib/resetVersions/rules";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/stateTickRates", () => ({
  computeStateTickRates: vi.fn().mockResolvedValue({}),
  computeAllNationalMetricTickRates: vi.fn().mockResolvedValue({}),
}));
import { getDb } from "@/lib/mongodb";
import { getRegionalApprovalData } from "@/lib/states/approval/getRegionalApprovalData";
import { loadNationalMetrics } from "@/lib/country/nationalMetrics";
import { loadNationalApproval } from "@/lib/country/nationalApproval";
import { snapshotApprovalHistory } from "@/lib/utils/governmentApproval";
import { GET } from "@/app/api/country/[code]/region/[id]/metrics/route";
const boards = buildOpeningMetricSnapshots1991("surface-test", 1).filter(
  (board) => board.countryId === "UK"
);
const states = boards
  .filter((board) => board.regionId)
  .map((board) => ({
    _id: board.regionId!,
    name: board.regionId!,
    countryId: "UK",
    population: 100,
  }));
let db: ReturnType<typeof createMockDb>;
beforeEach(() => {
  db = createMockDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  db.collection("gameState").findOne.mockResolvedValue({
    _id: "current",
    currentTurn: 1,
    preset: "1991-default",
    currentYear: 1991,
    startingYear: 1991,
    metricsSystemVersion: "v2",
    resetWorldId: "surface-test",
    resetVersionSeeds: {
      metrics: {
        worldId: "surface-test",
        revision: RESET_V2_SEED_REVISION.metrics,
        sourceTurn: 1,
        completedAt: "2026-10-09T00:00:00Z",
        verificationHash: "verified",
      },
    },
  });
  db.collection("states").find().toArray.mockResolvedValue(states);
  db.collection("states").distinct.mockResolvedValue(states.map((state) => state._id));
  db.collection("states").findOne.mockResolvedValue(states.find((state) => state._id === "SCO"));
  const macro = states.map((state) => ({ _id: state._id, countryId: "UK", economic: {} }));
  db.collection("macroMetrics").find().toArray.mockResolvedValue(macro);
  db.collection("macroMetrics").findOne.mockImplementation(
    async (filter: { _id: string }) => macro.find((row) => row._id === filter._id) ?? null
  );
  db.collection("resetMetricSnapshots").find().toArray.mockResolvedValue(boards);
  db.collection("cabinetMembers").find().toArray.mockResolvedValue([{}]);
});
describe("Metrics v2 approval surface parity", () => {
  it("serves a complete stored national rating without requiring live boards", async () => {
    db.collection("governmentApprovals").findOne.mockResolvedValue({
      _id: "UK",
      approvalRating: 43,
      approvalBase: 50,
      history: [],
      activeRegionalModifiers: [],
      activeNationalModifiers: [{ id: "stored", label: "Stored", effect: -7 }],
    });
    db.collection("resetMetricSnapshots").find().toArray.mockResolvedValue([]);
    db.collectionMocks.resetMetricSnapshots!.find.mockClear();
    expect(await loadNationalApproval("UK")).toEqual({
      governmentApproval: 43,
      governmentApprovalBase: 50,
      history: [],
      modifiers: [{ id: "stored", label: "Stored", effect: -7 }],
      stateAverage: 50,
      nationalAdjustments: [{ id: "stored", label: "Stored", effect: -7 }],
    });
    expect(db.collectionMocks.resetMetricSnapshots!.find).not.toHaveBeenCalled();
  });
  it("regional hero, metrics API and country rankings consume the same conditions and base", async () => {
    const regional = await getRegionalApprovalData(db as unknown as Db, "UK", "SCO");
    const response = await GET(new Request("http://localhost/api/country/uk/region/SCO/metrics"), {
      params: Promise.resolve({ code: "uk", id: "SCO" }),
    });
    expect(response.status).toBe(200);
    const payload = await response.json();
    const national = await loadNationalMetrics("UK");
    const ranking = national!.stateApprovals.find((row) => row.stateId === "SCO")!;
    expect(payload.governmentApproval).toBe(regional!.approval);
    expect(payload.governmentApprovalBase).toBe(regional!.baseApproval);
    expect(payload.governmentApprovalModifiers).toEqual(regional!.modifiers);
    expect(ranking.approval).toBe(regional!.approval);
    expect(ranking.modifiers).toEqual(regional!.modifiers);
    expect(regional!.modifiers.length).toBeGreaterThan(0);
    expect(db.collectionMocks.politicalMetrics).toBeUndefined();
  });
  it("first turn snapshot agrees with the fresh-world national fallback and stores named conditions", async () => {
    const live = await loadNationalApproval("UK");
    db.collection("resetMetricSnapshots")
      .find()
      .toArray.mockResolvedValue(boards.map((board) => ({ ...board, asOfTurn: 2 })));
    await snapshotApprovalHistory(db as unknown as Db, "UK", 2);
    const stored = db.collectionMocks.governmentApprovals!.updateOne.mock.calls.at(-1)![1].$set;
    expect(stored.approvalRating).toBe(live.governmentApproval);
    expect(stored.approvalBase).toBe(live.governmentApprovalBase);
    expect(
      stored.activeRegionalModifiers.some(
        (modifier: { id: string }) => modifier.id === "regional_conditions"
      )
    ).toBe(false);
    expect(stored.activeRegionalModifiers.length).toBeGreaterThan(0);
    const summed = stored.activeRegionalModifiers.reduce(
      (sum: number, modifier: { effect: number }) => sum + modifier.effect,
      0
    );
    expect(stored.approvalBase + summed - 5).toBeCloseTo(stored.approvalRating, 1);
  });
});
