import { describe, it, expect, vi, beforeEach } from "vitest";
import { updatePartyPresence } from "./presence";

// Mock the database
vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

describe("checkPartyPresence", () => {
  const mockDb = {
    collection: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(mockDb as never);
  });

  it("returns true when player characters exist", async () => {
    mockDb.collection.mockImplementation((name: string) => {
      if (name === "characters") {
        return { countDocuments: vi.fn().mockResolvedValue(1) };
      }
      return { countDocuments: vi.fn().mockResolvedValue(0) };
    });

    const { checkPartyPresence } = await import("./presence");
    const result = await checkPartyPresence(mockDb as any, "CA", "democrat");
    expect(result).toBe(true);
  });

  it("returns true when elected officials exist", async () => {
    mockDb.collection.mockImplementation((name: string) => {
      if (name === "characters") {
        return { countDocuments: vi.fn().mockResolvedValue(0) };
      }
      if (name === "electedOfficials") {
        return { countDocuments: vi.fn().mockResolvedValue(1) };
      }
      return { countDocuments: vi.fn().mockResolvedValue(0) };
    });

    const { checkPartyPresence } = await import("./presence");
    const result = await checkPartyPresence(mockDb as any, "CA", "democrat");
    expect(result).toBe(true);
  });

  it("returns true when an active NPP exists (no player or official)", async () => {
    mockDb.collection.mockImplementation((name: string) => {
      if (name === "npps") {
        return { countDocuments: vi.fn().mockResolvedValue(1) };
      }
      // No players, no elected officials.
      return { countDocuments: vi.fn().mockResolvedValue(0) };
    });

    const { checkPartyPresence } = await import("./presence");
    const result = await checkPartyPresence(mockDb as any, "PA", "3");
    expect(result).toBe(true);
  });

  it("only counts active NPPs (filters on retiredAt: null)", async () => {
    const nppCount = vi.fn().mockResolvedValue(0);
    mockDb.collection.mockImplementation((name: string) => {
      if (name === "npps") {
        return { countDocuments: nppCount };
      }
      return { countDocuments: vi.fn().mockResolvedValue(0) };
    });

    const { checkPartyPresence } = await import("./presence");
    const result = await checkPartyPresence(mockDb as any, "PA", "3");

    expect(result).toBe(false);
    // Retired NPPs must be excluded from the presence count.
    expect(nppCount).toHaveBeenCalledWith(
      expect.objectContaining({ party: "3", homeState: "PA", retiredAt: null })
    );
  });

  it("returns false when no characters, officials, or active NPPs", async () => {
    mockDb.collection.mockReturnValue({
      countDocuments: vi.fn().mockResolvedValue(0),
    });

    const { checkPartyPresence } = await import("./presence");
    const result = await checkPartyPresence(mockDb as any, "CA", "democrat");
    expect(result).toBe(false);
  });
});

describe("updatePartyPresence", () => {
  const mockDb = {
    collection: vi.fn(),
  };

  const mockUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets hasPresence to true when presence exists", async () => {
    mockDb.collection.mockImplementation((name: string) => {
      if (name === "characters") {
        return { countDocuments: vi.fn().mockResolvedValue(1) };
      }
      if (name === "statePartyOrg") {
        return { updateOne: mockUpdateOne };
      }
      if (name === "partyBudget") {
        return { updateOne: vi.fn() };
      }
      return { countDocuments: vi.fn().mockResolvedValue(0) };
    });

    await updatePartyPresence(mockDb as any, "CA", "democrat");

    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: "CA_democrat" },
      expect.objectContaining({
        $set: expect.objectContaining({ hasPresence: true }),
      })
    );
  });

  it("resets orgBuildingPercent when presence is lost", async () => {
    const mockBudgetUpdate = vi.fn().mockResolvedValue({ modifiedCount: 1 });

    mockDb.collection.mockImplementation((name: string) => {
      if (name === "characters") {
        return { countDocuments: vi.fn().mockResolvedValue(0) };
      }
      if (name === "electedOfficials") {
        return { countDocuments: vi.fn().mockResolvedValue(0) };
      }
      if (name === "statePartyOrg") {
        return { updateOne: mockUpdateOne };
      }
      if (name === "partyBudget") {
        return { updateOne: mockBudgetUpdate };
      }
      return { countDocuments: vi.fn().mockResolvedValue(0) };
    });

    await updatePartyPresence(mockDb as any, "CA", "democrat");

    expect(mockBudgetUpdate).toHaveBeenCalledWith(
      { partyId: "democrat", scope: "state", stateId: "CA" },
      expect.objectContaining({
        $set: expect.objectContaining({ orgBuildingPercent: 0 }),
      })
    );
  });
});
