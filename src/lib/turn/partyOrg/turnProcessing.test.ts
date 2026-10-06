// src/lib/turn/partyOrg/turnProcessing.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { processPartyOrgTurn } from "./turnProcessing";
import type { StatePartyOrg } from "@/lib/db/types";
import { ORG_DECAY_GRACE_TURNS } from "@/lib/constants/partyOrg";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

describe("processPartyOrgTurn", () => {
  const mockBulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 1 });

  const createMockSpo = (overrides: Partial<StatePartyOrg> = {}): StatePartyOrg => ({
    _id: "CA_1",
    countryId: "US",
    stateId: "CA",
    partyId: "1",
    organization: 50,
    organizationUnits: 50,
    lastOrganizationBuildTurn: 100,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    treasury: 10000,
    stateTaxRate: 0,
    politicalStrength: 0,
    hasPresence: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockRows(rows: StatePartyOrg[]) {
    const project = vi.fn().mockReturnThis();
    const toArray = vi.fn().mockResolvedValue(rows);
    const mockDb = {
      collection: vi.fn().mockReturnValue({
        find: vi.fn().mockReturnValue({ project, toArray }),
        bulkWrite: mockBulkWrite,
      }),
    };
    return mockDb;
  }

  it("does not decay a recently active party", async () => {
    const mockDb = mockRows([createMockSpo({ organization: 33.3333 })]);

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    await processPartyOrgTurn(100 + ORG_DECAY_GRACE_TURNS - 1);

    expect(mockBulkWrite).not.toHaveBeenCalled();
  });

  it("decays units after the inactivity grace period and derives Org share", async () => {
    const mockDb = mockRows([createMockSpo({ lastOrganizationBuildTurn: 0 })]);

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    await processPartyOrgTurn(ORG_DECAY_GRACE_TURNS, new Date("2026-10-04T12:00:00Z"));

    const update = mockBulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(update.organizationUnits).toBe(49.5);
    expect(update.organization).toBeCloseTo(33.1104, 4);
    expect(update.lastOrganizationBuildTurn).toBe(0);
  });

  it("bootstraps legacy rows without immediately decaying them", async () => {
    const mockDb = mockRows([
      createMockSpo({
        organization: 25,
        organizationUnits: undefined,
        lastOrganizationBuildTurn: undefined,
      }),
    ]);

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    await processPartyOrgTurn(900);

    const update = mockBulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(update).toMatchObject({
      organization: 25,
      organizationUnits: 33.333333,
      lastOrganizationBuildTurn: 900,
    });
  });

  it("recomputes every party share when one inactive balance decays", async () => {
    const mockDb = mockRows([
      createMockSpo({
        _id: "CA_1",
        partyId: "1",
        organizationUnits: 80,
        lastOrganizationBuildTurn: 0,
      }),
      createMockSpo({
        _id: "CA_2",
        partyId: "2",
        organizationUnits: 80,
        lastOrganizationBuildTurn: ORG_DECAY_GRACE_TURNS,
      }),
    ]);

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    await processPartyOrgTurn(ORG_DECAY_GRACE_TURNS);

    const operations = mockBulkWrite.mock.calls[0][0];
    expect(operations).toHaveLength(2);
    expect(operations[0].updateOne.update.$set.organization).toBeCloseTo(30.5556, 4);
    expect(operations[1].updateOne.update.$set.organization).toBeCloseTo(30.8642, 4);
  });
});
