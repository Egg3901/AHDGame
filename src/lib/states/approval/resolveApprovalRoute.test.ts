import { describe, expect, it } from "vitest";
import { resolveApprovalRoute } from "./resolveApprovalRoute";

function mockDb(matches: { _id: string; countryId: string }[]) {
  return {
    collection: () => ({
      find: () => ({
        project: () => ({
          toArray: async () => matches,
        }),
      }),
    }),
  };
}

describe("resolveApprovalRoute", () => {
  it("resolves UK_ prefix routes", async () => {
    const result = await resolveApprovalRoute(mockDb([]) as never, "UK_SCO");
    expect(result).toEqual({ countryId: "UK", stateId: "SCO" });
  });

  it("resolves bare UK region IDs", async () => {
    const result = await resolveApprovalRoute(mockDb([]) as never, "wal");
    expect(result).toEqual({ countryId: "UK", stateId: "WAL" });
  });

  it("resolves a unique state ID via DB lookup", async () => {
    const result = await resolveApprovalRoute(
      mockDb([{ _id: "HD", countryId: "CN" }]) as never,
      "HD"
    );
    expect(result).toEqual({ countryId: "CN", stateId: "HD" });
  });

  it("returns null for unknown IDs", async () => {
    const result = await resolveApprovalRoute(mockDb([]) as never, "ZZZ");
    expect(result).toBeNull();
  });

  it("returns null when the ID is ambiguous across countries", async () => {
    const result = await resolveApprovalRoute(
      mockDb([
        { _id: "XX", countryId: "US" },
        { _id: "XX", countryId: "DE" },
      ]) as never,
      "XX"
    );
    expect(result).toBeNull();
  });
});
