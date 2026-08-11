import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { clearCabinetOnTransition } from "./cabinetTransition";

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));

import { createNotifications } from "@/lib/notifications";

function makeMockDb({
  members = [] as {
    _id?: ObjectId;
    positionId: string;
    characterId: ObjectId;
    characterName?: string;
  }[],
  characters = [] as {
    _id: ObjectId;
    userId?: ObjectId;
    currentOffice?: { type: string; positionId?: string; state?: string };
  }[],
  seats = [] as { characterId: ObjectId; officeType: string; state: string }[],
} = {}) {
  const memberCol = {
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(members) }),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: members.length }),
  };
  const nominationCol = {
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
  };
  const characterCol = {
    findOne: vi
      .fn()
      .mockImplementation(({ _id }: { _id: ObjectId }) =>
        Promise.resolve(characters.find((c) => c._id.equals(_id)) ?? null)
      ),
    find: vi.fn().mockImplementation((filter: { _id: { $in: ObjectId[] } }) => ({
      toArray: vi
        .fn()
        .mockResolvedValue(characters.filter((c) => filter._id.$in.some((id) => id.equals(c._id)))),
    })),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const electedOfficialsCol = {
    find: vi.fn().mockImplementation((filter: { characterId: { $in: ObjectId[] } }) => ({
      toArray: vi
        .fn()
        .mockResolvedValue(
          seats.filter((s) => filter.characterId.$in.some((id) => id.equals(s.characterId)))
        ),
    })),
  };
  const cabinetSettingsCol = {
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
  };
  const ministerialOrdersCol = {
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
  };
  const db = {
    collection: vi.fn().mockImplementation((name: string) => {
      if (name === "cabinetMembers") return memberCol;
      if (name === "cabinetNominations") return nominationCol;
      if (name === "characters") return characterCol;
      if (name === "electedOfficials") return electedOfficialsCol;
      if (name === "cabinetSettings") return cabinetSettingsCol;
      if (name === "ministerialOrders") return ministerialOrdersCol;
      throw new Error(`Unexpected collection: ${name}`);
    }),
  };
  return {
    db,
    memberCol,
    nominationCol,
    characterCol,
    electedOfficialsCol,
    cabinetSettingsCol,
    ministerialOrdersCol,
  };
}

describe("clearCabinetOnTransition", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes US cabinet members matching US positionIds", async () => {
    const { db, memberCol } = makeMockDb();
    await clearCabinetOnTransition(db as any, "US");

    expect(memberCol.deleteMany).toHaveBeenCalledWith({
      positionId: { $in: expect.arrayContaining(["secretary_of_state", "attorney_general"]) },
    });
    // UK positions must NOT be in the set
    const call = memberCol.deleteMany.mock.calls[0][0];
    expect(call.positionId.$in).not.toContain("chancellor");
  });

  it("deletes UK cabinet members from the unified cabinetMembers collection", async () => {
    const { db, memberCol } = makeMockDb();
    await clearCabinetOnTransition(db as any, "UK");

    expect(memberCol.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        countryId: "UK",
        positionId: { $in: expect.arrayContaining(["chancellor"]) },
      })
    );
  });

  it("deletes IE cabinet members from the unified cabinetMembers collection", async () => {
    const { db, memberCol } = makeMockDb();
    await clearCabinetOnTransition(db as any, "IE");

    expect(memberCol.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        countryId: "IE",
        positionId: { $in: expect.arrayContaining(["minister_for_finance"]) },
      })
    );
  });

  it("withdraws proposed and active nominations", async () => {
    const { db, nominationCol } = makeMockDb();
    await clearCabinetOnTransition(db as any, "US");

    expect(nominationCol.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ status: { $in: ["proposed", "active"] } }),
      expect.objectContaining({ $set: expect.objectContaining({ status: "withdrawn" }) })
    );
  });

  it("sends notification to each player character member", async () => {
    const charId = new ObjectId();
    const userId = new ObjectId();
    const { db } = makeMockDb({
      members: [{ positionId: "secretary_of_state", characterId: charId }],
      characters: [{ _id: charId, userId }],
    });

    await clearCabinetOnTransition(db as any, "US");

    expect(createNotifications).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ userId, title: "Cabinet Resigned" })])
    );
  });

  it("skips notification for NPP members (no userId)", async () => {
    const charId = new ObjectId();
    const { db } = makeMockDb({
      members: [{ positionId: "secretary_of_state", characterId: charId }],
      characters: [{ _id: charId }], // no userId
    });

    await clearCabinetOnTransition(db as any, "US");

    // Helper still flushes once with an empty list — never with any input
    expect(createNotifications).toHaveBeenCalledWith([]);
  });

  it("is a no-op when there are no members", async () => {
    const { db, memberCol } = makeMockDb();
    await expect(clearCabinetOnTransition(db as any, "UK")).resolves.not.toThrow();
    expect(memberCol.deleteMany).toHaveBeenCalledOnce();
    expect(createNotifications).toHaveBeenCalledWith([]);
  });

  it("restores a cleared parliamentary minister's currentOffice to their legislative seat", async () => {
    const charId = new ObjectId();
    const { db, characterCol } = makeMockDb({
      members: [
        {
          _id: new ObjectId(),
          positionId: "finance_minister",
          characterId: charId,
          characterName: "Min",
        },
      ],
      characters: [
        {
          _id: charId,
          currentOffice: { type: "parliamentaryCabinet", positionId: "finance_minister" },
        },
      ],
      seats: [{ characterId: charId, officeType: "bundestag", state: "BY" }],
    });

    await clearCabinetOnTransition(db as any, "DE");

    expect(characterCol.updateOne).toHaveBeenCalledWith(
      { _id: charId },
      expect.objectContaining({
        $set: expect.objectContaining({ currentOffice: { type: "bundestag", state: "BY" } }),
      })
    );
  });

  it("unsets currentOffice when a cleared minister has no legislative seat", async () => {
    const charId = new ObjectId();
    const { db, characterCol } = makeMockDb({
      members: [
        {
          _id: new ObjectId(),
          positionId: "minister_for_finance",
          characterId: charId,
          characterName: "Min",
        },
      ],
      characters: [
        {
          _id: charId,
          currentOffice: { type: "parliamentaryCabinet", positionId: "minister_for_finance" },
        },
      ],
      seats: [], // no legislative seat
    });

    await clearCabinetOnTransition(db as any, "IE");

    expect(characterCol.updateOne).toHaveBeenCalledWith(
      { _id: charId },
      expect.objectContaining({ $unset: { currentOffice: "" } })
    );
  });

  it("does not touch currentOffice for a holder whose office already moved on", async () => {
    const charId = new ObjectId();
    const { db, characterCol } = makeMockDb({
      members: [
        {
          _id: new ObjectId(),
          positionId: "finance_minister",
          characterId: charId,
          characterName: "Min",
        },
      ],
      // currentOffice already reverted to a Dáil seat — must not be clobbered.
      characters: [{ _id: charId, currentOffice: { type: "dail", state: "DUB" } }],
      seats: [{ characterId: charId, officeType: "bundestag", state: "BY" }],
    });

    await clearCabinetOnTransition(db as any, "DE");

    expect(characterCol.updateOne).not.toHaveBeenCalled();
  });

  it("clears CN (one-party state) cabinet on transition", async () => {
    // CN was omitted from the positionsByCountry map, so a government transition
    // was a no-op — leaving stale cabinet seats that a re-formed government could
    // not overwrite (the appoint 409-guard reads the un-cleared seat).
    const { db, memberCol } = makeMockDb();
    await clearCabinetOnTransition(db as any, "CN");

    expect(memberCol.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        countryId: "CN",
        positionId: { $in: expect.arrayContaining(["minister_of_foreign_affairs"]) },
      })
    );
  });

  it("clears NG cabinet on transition", async () => {
    const { db, memberCol } = makeMockDb();
    await clearCabinetOnTransition(db as any, "NG");

    expect(memberCol.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        countryId: "NG",
        positionId: { $in: expect.arrayContaining(["minister_of_foreign_affairs"]) },
      })
    );
  });

  it("restores a cleared US cabinet secretary's currentOffice", async () => {
    const charId = new ObjectId();
    const { db, characterCol } = makeMockDb({
      members: [{ positionId: "secretary_of_state", characterId: charId }],
      characters: [
        { _id: charId, currentOffice: { type: "usCabinet", positionId: "secretary_of_state" } },
      ],
      seats: [{ characterId: charId, officeType: "senate", state: "NY" }],
    });

    await clearCabinetOnTransition(db as any, "US");

    expect(characterCol.updateOne).toHaveBeenCalledWith(
      { _id: charId },
      expect.objectContaining({
        $set: expect.objectContaining({ currentOffice: { type: "senate", state: "NY" } }),
      })
    );
  });
});
