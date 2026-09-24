import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { customAlignmentPoleId } from "@/lib/constants/alignmentEras";

vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(77) }));
vi.mock("@/lib/internationalOrganizations/service", () => ({
  recordOrgHistoryEvent: vi.fn().mockResolvedValue(undefined),
}));

const { createInternationalOrganization } = await import("./createOrganization");

function makeDb(year = 1979) {
  const insertedOrg = vi.fn().mockResolvedValue({ acknowledged: true });
  const insertedMembership = vi.fn().mockResolvedValue({ acknowledged: true });
  const membershipFindOne = vi.fn().mockResolvedValue(null);
  const insertedLeadership = vi.fn().mockResolvedValue({ acknowledged: true });
  const alignmentUpdate = vi.fn().mockResolvedValue({ acknowledged: true, matchedCount: 1 });
  const alignmentReplace = vi.fn().mockResolvedValue({ acknowledged: true });
  const alignmentRow = {
    _id: new ObjectId(),
    entityId: "BR",
    eraKey: "cold-war",
    shares: { WEST: 50, EAST: 20 },
    nonAligned: 30,
    previous: null,
    turn: 76,
    updatedAt: new Date(),
  };

  const collection = vi.fn((name: string) => {
    if (name === "customInternationalOrganizations") {
      return {
        findOne: vi.fn().mockResolvedValue(null),
        find: vi.fn(() => ({
          project: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
        })),
        insertOne: insertedOrg,
        deleteOne: vi.fn().mockResolvedValue({ acknowledged: true }),
      };
    }
    if (name === "organizationMemberships") {
      return {
        findOne: membershipFindOne,
        insertOne: insertedMembership,
        deleteOne: vi.fn().mockResolvedValue({ acknowledged: true }),
      };
    }
    if (name === "organizationLeadership") {
      return {
        insertOne: insertedLeadership,
        deleteOne: vi.fn().mockResolvedValue({ acknowledged: true }),
      };
    }
    if (name === "countryAlignments") {
      return {
        findOne: vi.fn().mockResolvedValue(alignmentRow),
        updateOne: alignmentUpdate,
        replaceOne: alignmentReplace,
        deleteOne: vi.fn().mockResolvedValue({ acknowledged: true }),
      };
    }
    if (name === "gameState") {
      return {
        findOne: vi.fn().mockResolvedValue({
          _id: "current",
          currentYear: year,
          startingYear: year,
        }),
      };
    }
    throw new Error(`Unexpected collection ${name}`);
  });
  const db = { collection } as unknown as Db;

  return {
    db,
    collection,
    insertedOrg,
    insertedMembership,
    membershipFindOne,
    insertedLeadership,
    alignmentUpdate,
    alignmentReplace,
    alignmentRow,
  };
}

describe("createInternationalOrganization", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a custom Bloc pole and commits its founder to it", async () => {
    const { db, insertedOrg, insertedMembership, insertedLeadership, alignmentUpdate } = makeDb();
    const result = await createInternationalOrganization({
      db,
      countryId: "BR",
      actor: { characterId: new ObjectId(), characterName: "Foreign Minister" },
      input: {
        id: "andes-pact",
        name: "Andes Pact",
        shortName: "AP",
        description: "A regional Bloc.",
        charter: "Members coordinate foreign policy and collective security.",
        leadershipTitle: "Secretary-General",
        category: "bloc",
        alignmentAccentToken: "warning",
      },
    });

    const poleId = customAlignmentPoleId("andes-pact");
    expect(result).toEqual({ ok: true, organizationId: "andes-pact" });
    expect(insertedOrg).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "andes-pact",
        category: "bloc",
        alignment: { poleId, accentToken: "warning" },
      })
    );
    expect(insertedMembership).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "andes-pact", countryId: "BR" })
    );
    expect(insertedLeadership).toHaveBeenCalled();
    expect(alignmentUpdate).toHaveBeenCalledWith(
      { _id: expect.any(ObjectId), updatedAt: expect.any(Date) },
      expect.objectContaining({
        $set: expect.objectContaining({
          shares: expect.objectContaining({ [poleId]: 60 }),
          joinReadySince: expect.objectContaining({ [poleId]: 77 }),
        }),
      }),
      { upsert: false }
    );
  });

  it("rejects a Bloc without a color before writing", async () => {
    const { db, insertedOrg } = makeDb();
    const result = await createInternationalOrganization({
      db,
      countryId: "BR",
      actor: { characterId: new ObjectId(), characterName: "Foreign Minister" },
      input: {
        id: "andes-pact",
        name: "Andes Pact",
        shortName: "AP",
        description: "A regional Bloc.",
        charter: "Members coordinate foreign policy and collective security.",
        leadershipTitle: "Secretary-General",
        category: "bloc",
      },
    });

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(insertedOrg).not.toHaveBeenCalled();
  });

  it("refuses to found a Bloc while its creator belongs to a rival", async () => {
    const { db, membershipFindOne, insertedOrg } = makeDb();
    membershipFindOne.mockResolvedValue({ organizationId: "NATO" });
    const result = await createInternationalOrganization({
      db,
      countryId: "BR",
      actor: { characterId: new ObjectId(), characterName: "Foreign Minister" },
      input: {
        id: "andes-pact",
        name: "Andes Pact",
        shortName: "AP",
        description: "A regional Bloc.",
        charter: "Members coordinate foreign policy.",
        leadershipTitle: "Secretary-General",
        category: "bloc",
        alignmentAccentToken: "warning",
      },
    });

    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(insertedOrg).not.toHaveBeenCalled();
  });

  it("crosses the founder's old era shares before reserving the new pole", async () => {
    const { db, alignmentUpdate } = makeDb(2019);
    const result = await createInternationalOrganization({
      db,
      countryId: "BR",
      actor: { characterId: new ObjectId(), characterName: "Foreign Minister" },
      input: {
        id: "andes-pact",
        name: "Andes Pact",
        shortName: "AP",
        description: "A regional Bloc.",
        charter: "Members coordinate foreign policy and collective security.",
        leadershipTitle: "Secretary-General",
        category: "bloc",
        alignmentAccentToken: "warning",
      },
    });

    expect(result.ok).toBe(true);
    const written = alignmentUpdate.mock.calls[0]?.[1].$set;
    expect(written.eraKey).toBe("post-cold-war");
    expect(written.shares).toMatchObject({
      WASHINGTON: 20,
      MOSCOW: 8,
      [customAlignmentPoleId("andes-pact")]: 60,
    });
    expect(written.nonAligned).toBe(12);
    expect(written.shares.WEST).toBeUndefined();
  });

  it("does not load alignment data for an ordinary custom organization", async () => {
    const { db, collection, alignmentUpdate } = makeDb();
    const result = await createInternationalOrganization({
      db,
      countryId: "BR",
      actor: { characterId: new ObjectId(), characterName: "Foreign Minister" },
      input: {
        id: "andes-forum",
        name: "Andes Forum",
        shortName: "AF",
        description: "A regional forum.",
        charter: "Members coordinate diplomacy.",
        leadershipTitle: "Secretary-General",
        category: "political",
      },
    });

    expect(result.ok).toBe(true);
    expect(collection).not.toHaveBeenCalledWith("gameState");
    expect(collection).not.toHaveBeenCalledWith("countryAlignments");
    expect(alignmentUpdate).not.toHaveBeenCalled();
  });

  it("rolls back only its own alignment write if founding fails", async () => {
    const { db, alignmentUpdate, alignmentReplace, alignmentRow } = makeDb();
    alignmentUpdate.mockRejectedValue(new Error("alignment write failed"));

    await expect(
      createInternationalOrganization({
        db,
        countryId: "BR",
        actor: { characterId: new ObjectId(), characterName: "Foreign Minister" },
        input: {
          id: "andes-pact",
          name: "Andes Pact",
          shortName: "AP",
          description: "A regional Bloc.",
          charter: "Members coordinate foreign policy.",
          leadershipTitle: "Secretary-General",
          category: "bloc",
          alignmentAccentToken: "warning",
        },
      })
    ).rejects.toThrow("alignment write failed");

    const attempted = alignmentUpdate.mock.calls[0]?.[1].$set;
    expect(alignmentReplace).toHaveBeenCalledWith(
      { _id: alignmentRow._id, updatedAt: attempted.updatedAt },
      alignmentRow
    );
  });

  it("returns a conflict instead of overwriting a newer alignment row", async () => {
    const { db, alignmentUpdate, alignmentReplace, insertedOrg } = makeDb();
    alignmentUpdate.mockResolvedValue({ acknowledged: true, matchedCount: 0 });

    const result = await createInternationalOrganization({
      db,
      countryId: "BR",
      actor: { characterId: new ObjectId(), characterName: "Foreign Minister" },
      input: {
        id: "andes-pact",
        name: "Andes Pact",
        shortName: "AP",
        description: "A regional Bloc.",
        charter: "Members coordinate foreign policy.",
        leadershipTitle: "Secretary-General",
        category: "bloc",
        alignmentAccentToken: "warning",
      },
    });

    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(insertedOrg).toHaveBeenCalled();
    expect(alignmentReplace).not.toHaveBeenCalled();
  });
});
