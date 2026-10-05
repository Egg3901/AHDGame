import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/stateTickRates", () => ({
  computeAllNationalMetricTickRates: vi.fn().mockResolvedValue({}),
}));
const { bases } = vi.hoisted(() => ({ bases: vi.fn() }));
vi.mock("@/lib/politicalLegislation/politicalApprovalProvider", async (original) => ({
  ...(await original<typeof import("@/lib/politicalLegislation/politicalApprovalProvider")>()),
  loadPoliticalApprovalBases: bases,
}));
import { getDb } from "@/lib/mongodb";
import { loadNationalApproval } from "./nationalApproval";
import { loadNationalMetrics } from "./nationalMetrics";
let db: MockDb;
beforeEach(() => {
  db = createMockDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  db.collection("states")
    .find()
    .toArray.mockResolvedValue([
      { _id: "LON", countryId: "UK", name: "London", population: 900 },
      { _id: "NEE", countryId: "UK", name: "North East", population: 100 },
    ]);
  db.collection("macroMetrics")
    .find()
    .toArray.mockResolvedValue([
      { _id: "LON", countryId: "UK", economic: { gdpGrowth: { value: 1 } } },
      { _id: "NEE", countryId: "UK", economic: { gdpGrowth: { value: -1 } } },
    ]);
  db.collection("gameState").findOne.mockResolvedValue({
    _id: "current",
    currentYear: 1991,
    startingYear: 1991,
    currentTurn: 1,
    eraSystemEnabled: true,
    preset: "1991-default",
  });
  bases.mockResolvedValue({
    national: 50,
    byRegion: new Map([
      ["LON", 50],
      ["NEE", 50],
    ]),
  });
});
describe("national approval reader parity", () => {
  it("matches population-weighted regional approval on a fresh world", async () => {
    const card = await loadNationalApproval("UK");
    const metrics = await loadNationalMetrics("UK");
    expect(card.governmentApproval).toBe(44.9);
    expect(metrics?.governmentApproval).toBe(card.governmentApproval);
    expect(metrics?.governmentApprovalModifiers).toEqual(card.modifiers);
    expect(metrics?.governmentApprovalBase).toBe(card.governmentApprovalBase);
  });
  it("keeps old snapshots without invented national modifier chips", async () => {
    db.collection("governmentApprovals").findOne.mockResolvedValue({
      _id: "UK",
      approvalRating: 42.1,
      history: [{ turn: 5, approval: 42.1, net: -15.8 }],
    });
    const card = await loadNationalApproval("UK");
    const metrics = await loadNationalMetrics("UK");
    expect(card.governmentApproval).toBe(42.1);
    expect(metrics?.governmentApproval).toBe(42.1);
    expect(metrics?.governmentApprovalModifiers).toEqual(card.modifiers);
    expect(card.modifiers.some((modifier) => modifier.id === "public_expectations")).toBe(false);
  });
  it("both readers prefer the canonical snapshot, including the applied modifiers", async () => {
    db.collection("governmentApprovals").findOne.mockResolvedValue({
      _id: "UK",
      countryId: "UK",
      approvalRating: 51,
      approvalBase: 49,
      history: [{ turn: 1, approval: 51, net: 2 }],
      activeRegionalModifiers: [],
      activeNationalModifiers: [{ id: "speech", label: "Address", effect: 2 }],
    });
    const card = await loadNationalApproval("UK");
    const metrics = await loadNationalMetrics("UK");
    expect(card.governmentApproval).toBe(51);
    expect(metrics?.governmentApproval).toBe(51);
    expect(metrics?.governmentApprovalModifiers).toEqual(card.modifiers);
    expect(metrics?.governmentApprovalBase).toBe(49);
  });
});
