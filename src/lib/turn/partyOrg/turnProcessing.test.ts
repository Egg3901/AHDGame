// src/lib/turn/partyOrg/turnProcessing.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { processPartyOrgTurn } from "./turnProcessing";
import type { StatePartyOrg } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

describe("processPartyOrgTurn", () => {
  const mockBulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 1 });

  const createMockSpo = (overrides: Partial<StatePartyOrg> = {}): StatePartyOrg => ({
    _id: "CA_democrat",
    countryId: "US",
    stateId: "CA",
    partyId: "democrat",
    organization: 50,
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

  it("applies org decay when org > 0", async () => {
    const spo = createMockSpo({ organization: 50 });

    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "statePartyOrg") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnThis(),
              toArray: vi.fn().mockResolvedValue([spo]),
            }),
            bulkWrite: mockBulkWrite,
          };
        }
        return {};
      }),
    };

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    await processPartyOrgTurn();

    const updateOps = mockBulkWrite.mock.calls[0][0];
    const update = updateOps[0].updateOne.update.$set;
    // Org decays by 0.03125 per turn (unconditional)
    expect(update.organization).toBe(49.97);
  });

  it("applies decay regardless of presence flag", async () => {
    const spo = createMockSpo({ hasPresence: false, organization: 10 });

    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "statePartyOrg") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnThis(),
              toArray: vi.fn().mockResolvedValue([spo]),
            }),
            bulkWrite: mockBulkWrite,
          };
        }
        return {};
      }),
    };

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    await processPartyOrgTurn();

    const updateOps = mockBulkWrite.mock.calls[0][0];
    const update = updateOps[0].updateOne.update.$set;
    // Org decays from 10 to 9.96875 (rounded 9.97)
    expect(update.organization).toBe(9.97);
  });

  it("does not decay below zero", async () => {
    const spo = createMockSpo({ organization: 0 });

    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "statePartyOrg") {
          return {
            find: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnThis(),
              toArray: vi.fn().mockResolvedValue([spo]),
            }),
            bulkWrite: mockBulkWrite,
          };
        }
        return {};
      }),
    };

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    await processPartyOrgTurn();

    const updateOps = mockBulkWrite.mock.calls[0][0];
    const update = updateOps[0].updateOne.update.$set;
    expect(update.organization).toBe(0);
  });
});
