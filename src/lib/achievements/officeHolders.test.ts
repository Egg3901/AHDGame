import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

const cabinetSeatId = new ObjectId();
const chairId = new ObjectId();

vi.mock("./index", () => ({
  getAchievementBySlug: vi.fn(async (slug: string) => ({
    _id: slug === "cabinet_seat" ? cabinetSeatId : chairId,
    slug,
  })),
}));
vi.mock("./cache", () => ({ invalidateRarityCache: vi.fn() }));

const cabinetFind = vi.fn();
vi.mock("@/lib/db/collections/cabinetMembers", () => ({
  getCabinetMembersCollection: () => ({ find: cabinetFind }),
}));

function makeDb(opts: {
  chairs: Array<{ chairCharacterId: ObjectId | null }>;
  existing: Array<{ userId: ObjectId; achievementId: ObjectId }>;
  insertMany: ReturnType<typeof vi.fn>;
}) {
  return {
    collection: (name: string) => {
      if (name === "centralBanks") {
        return { find: () => ({ toArray: async () => opts.chairs }) };
      }
      return {
        find: () => ({ toArray: async () => opts.existing }),
        insertMany: opts.insertMany,
      };
    },
  } as never;
}

describe("awardOfficeHolderAchievements", () => {
  beforeEach(() => {
    cabinetFind.mockReset();
  });

  it("awards a current cabinet member and chair without a profile visit, skipping existing awards", async () => {
    const { awardOfficeHolderAchievements } = await import("./officeHolders");
    const minister = { _id: new ObjectId(), userId: new ObjectId() };
    const chair = { _id: new ObjectId(), userId: new ObjectId() };
    const already = { _id: new ObjectId(), userId: new ObjectId() };
    cabinetFind.mockReturnValue({
      toArray: async () => [{ characterId: minister._id }, { characterId: already._id }],
    });
    const insertMany = vi.fn().mockResolvedValue({});
    const db = makeDb({
      chairs: [{ chairCharacterId: chair._id }],
      existing: [{ userId: already.userId, achievementId: cabinetSeatId }],
      insertMany,
    });

    const awarded = await awardOfficeHolderAchievements(db, [minister, chair, already]);

    expect(awarded).toBe(2);
    const docs = insertMany.mock.calls[0][0] as Array<{
      userId: ObjectId;
      characterId: ObjectId;
      achievementId: ObjectId;
    }>;
    expect(
      docs.map((d) => [d.userId.toString(), d.characterId.toString(), d.achievementId.toString()])
    ).toEqual([
      [minister.userId.toString(), minister._id.toString(), cabinetSeatId.toString()],
      [chair.userId.toString(), chair._id.toString(), chairId.toString()],
    ]);
  });

  it("writes nothing when no one holds office", async () => {
    const { awardOfficeHolderAchievements } = await import("./officeHolders");
    cabinetFind.mockReturnValue({ toArray: async () => [] });
    const insertMany = vi.fn();
    const db = makeDb({ chairs: [], existing: [], insertMany });
    expect(await awardOfficeHolderAchievements(db, [])).toBe(0);
    expect(insertMany).not.toHaveBeenCalled();
  });
});
