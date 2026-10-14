import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/db/sequentialId", () => ({ getNextSequentialId: vi.fn(async () => 100) }));
vi.mock("./nameGenerator", () => ({
  generateUniqueNPPNameAndGender: vi.fn(() => ({ name: "Test Politician", gender: "female" })),
}));
import { createNPP } from "./generator";

describe("runtime NPP creation respects party territory", () => {
  let mock: ReturnType<typeof createMockDb>;
  beforeEach(async () => {
    mock = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(mock as unknown as Db);
    mock.collection("states").find.mockReturnValue({
      toArray: async () => ["WA", "OR", "CA", "AZ", "NY"].map((_id) => ({ _id })),
    });
    mock.collection("characters").distinct.mockResolvedValue(["NY"]);
  });
  it("does not mint an out-of-frontier partisan CEO or justice", async () => {
    const npp = await createNPP(
      { state: "CA", countryId: "US", party: "7", targetOffice: null },
      { existingNames: new Set() }
    );
    expect(npp.party).toBe("independent");
    expect(mock.collection("npps").insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ party: "independent" })
    );
  });
  it("retains affiliation in an existing party region", async () => {
    const npp = await createNPP(
      { state: "NY", countryId: "US", party: "7", targetOffice: null },
      { existingNames: new Set() }
    );
    expect(npp.party).toBe("7");
  });
  it("normalizes numeric aliases before checking or persisting affiliation", async () => {
    for (const state of ["NY", "CA"]) {
      const npp = await createNPP(
        { state, countryId: "US", party: "07alias", targetOffice: null },
        { existingNames: new Set() }
      );
      expect(npp.party).toBe(state === "NY" ? "7" : "independent");
    }
  });
  it("allows connecting generation but not outward growth after fragmentation", async () => {
    mock.collection("characters").distinct.mockResolvedValue(["WA", "CA"]);
    expect(
      (
        await createNPP(
          { state: "AZ", countryId: "US", party: "7", targetOffice: null },
          { existingNames: new Set() }
        )
      ).party
    ).toBe("independent");
    expect(
      (
        await createNPP(
          { state: "OR", countryId: "US", party: "7", targetOffice: null },
          { existingNames: new Set() }
        )
      ).party
    ).toBe("7");
  });
});
