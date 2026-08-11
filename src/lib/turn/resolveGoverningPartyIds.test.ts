import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { resolveGoverningPartyIdsFromDocuments } from "./parliamentaryGovernment";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("resolveGoverningPartyIdsFromDocuments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty set when no governing party", async () => {
    const mockDb = { collection: vi.fn() };
    const ids = await resolveGoverningPartyIdsFromDocuments(
      mockDb as unknown as Db,
      "JP",
      null,
      null
    );
    expect(ids.size).toBe(0);
  });

  it("uses coalitionPartyIds from governmentFormations when present", async () => {
    const mockDb = { collection: vi.fn() };
    const ids = await resolveGoverningPartyIdsFromDocuments(
      mockDb as unknown as Db,
      "JP",
      {
        governingPartyId: "1",
        coalitionPartyIds: ["2", "3"],
        coalitionId: null,
      },
      null
    );
    expect([...ids].sort()).toEqual(["1", "2", "3"]);
  });

  it("loads coalition members when coalitionPartyIds is empty but coalitionId is set", async () => {
    const mockDb = {
      collection: vi.fn((name: string) => {
        if (name === "coalitions") {
          return {
            findOne: vi.fn().mockResolvedValue({
              sequentialId: 5,
              countryId: "JP",
              members: [
                { partySequentialId: 1 },
                { partySequentialId: 4 },
                { partySequentialId: 7 },
              ],
            }),
          };
        }
        return { findOne: vi.fn() };
      }),
    };

    const ids = await resolveGoverningPartyIdsFromDocuments(
      mockDb as unknown as Db,
      "JP",
      {
        governingPartyId: "1",
        coalitionPartyIds: null,
        coalitionId: 5,
      },
      null
    );
    expect([...ids].sort()).toEqual(["1", "4", "7"]);
  });

  it("falls back to governing party only when coalitionId resolves to no members", async () => {
    const mockDb = {
      collection: vi.fn((name: string) => {
        if (name === "coalitions") {
          return {
            findOne: vi.fn().mockResolvedValue(null),
            find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
          };
        }
        return { findOne: vi.fn() };
      }),
    };

    const ids = await resolveGoverningPartyIdsFromDocuments(
      mockDb as unknown as Db,
      "UK",
      {
        governingPartyId: "10",
        coalitionPartyIds: null,
        coalitionId: 99,
      },
      null
    );
    expect([...ids]).toEqual(["10"]);
  });

  it("includes members of the coalition led by the governing party when the formation records no coalition (minority backed by a coalition)", async () => {
    // Live IE scenario: a 'minority' government (coalitionId/coalitionPartyIds
    // null) whose governing party leads a coalition in the coalitions
    // collection. The coalition partners back the government and must NOT be
    // treated as opposition.
    const mockDb = {
      collection: vi.fn((name: string) => {
        if (name === "coalitions") {
          return {
            findOne: vi.fn().mockResolvedValue(null),
            find: vi.fn(() => ({
              toArray: vi.fn().mockResolvedValue([
                {
                  sequentialId: 2,
                  countryId: "IE",
                  // Lead member (members[0]) is the governing party.
                  members: [
                    { partySequentialId: 3 },
                    { partySequentialId: 6 },
                    { partySequentialId: 4 },
                    { partySequentialId: 5 },
                  ],
                },
              ]),
            })),
          };
        }
        return { findOne: vi.fn() };
      }),
    };

    const ids = await resolveGoverningPartyIdsFromDocuments(
      mockDb as unknown as Db,
      "IE",
      {
        governingPartyId: "3",
        coalitionPartyIds: null,
        coalitionId: null,
      },
      null
    );
    expect([...ids].sort()).toEqual(["3", "4", "5", "6"]);
  });

  it("ignores coalitions not led by the governing party (e.g. an opposition coalition)", async () => {
    const mockDb = {
      collection: vi.fn((name: string) => {
        if (name === "coalitions") {
          return {
            findOne: vi.fn().mockResolvedValue(null),
            find: vi.fn(() => ({
              toArray: vi.fn().mockResolvedValue([
                {
                  sequentialId: 9,
                  countryId: "IE",
                  // Lead member is party 6, NOT the governing party (3).
                  members: [{ partySequentialId: 6 }, { partySequentialId: 7 }],
                },
              ]),
            })),
          };
        }
        return { findOne: vi.fn() };
      }),
    };

    const ids = await resolveGoverningPartyIdsFromDocuments(
      mockDb as unknown as Db,
      "IE",
      {
        governingPartyId: "3",
        coalitionPartyIds: null,
        coalitionId: null,
      },
      null
    );
    expect([...ids]).toEqual(["3"]);
  });
});
