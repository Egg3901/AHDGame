import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { BLACKLIST_MAX_ENTRIES, setBlacklist } from "./blacklist";

vi.mock("@/lib/banking/featureFlag", () => ({
  isPrivateBankingEnabled: vi.fn().mockResolvedValue(true),
}));

const bankId = new ObjectId();

function makeDb(overrides: { countDocuments?: number } = {}) {
  const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
  const db = {
    collection: vi.fn(() => ({
      findOne: vi.fn().mockResolvedValue({
        _id: bankId,
        bankCharter: { status: "active" },
      }),
      countDocuments: vi.fn().mockResolvedValue(overrides.countDocuments ?? 0),
      updateOne,
    })),
  } as unknown as Db;
  return { db, updateOne };
}

beforeEach(() => vi.clearAllMocks());

describe("setBlacklist entry cap", () => {
  it("refuses a list longer than the cap instead of storing it on the corp document", async () => {
    const { db, updateOne } = makeDb();
    const tooMany = Array.from({ length: BLACKLIST_MAX_ENTRIES + 1 }, () =>
      new ObjectId().toString()
    );

    const result = await setBlacklist(db, bankId, {
      corporationIds: [],
      characterIds: tooMany,
      indexFundIds: [],
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain(String(BLACKLIST_MAX_ENTRIES));
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("counts entries after dedupe, so repeats of one id do not trip the cap", async () => {
    const single = new ObjectId().toString();
    const { db, updateOne } = makeDb({ countDocuments: 1 });

    const result = await setBlacklist(db, bankId, {
      corporationIds: [],
      characterIds: Array.from({ length: BLACKLIST_MAX_ENTRIES + 10 }, () => single),
      indexFundIds: [],
    });

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.blacklist.characterIds).toEqual([single]);
    expect(updateOne).toHaveBeenCalled();
  });
});
