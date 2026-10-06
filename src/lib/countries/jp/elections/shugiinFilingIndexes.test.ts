import { describe, expect, it, vi } from "vitest";
import {
  ensureJapanShugiinFilingIndexes,
  JAPAN_SHUGIIN_FILING_INDEXES,
} from "./shugiinFilingIndexes";

describe("Japan Shugiin filing indexes", () => {
  it("creates both active nomination guards once per database handle", async () => {
    const createIndex = vi.fn().mockResolvedValue("created");
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });
    const db = {
      collection: vi.fn(() => ({ createIndex, updateMany })),
    } as never;

    const first = ensureJapanShugiinFilingIndexes(db);
    const second = ensureJapanShugiinFilingIndexes(db);
    await Promise.all([first, second]);

    expect(createIndex).toHaveBeenCalledTimes(2);
    expect(createIndex.mock.calls).toEqual(
      JAPAN_SHUGIIN_FILING_INDEXES.map(([, keys, options]) => [keys, options])
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ countryId: "JP", party: { $type: "string", $ne: "independent" } }),
      expect.arrayContaining([expect.objectContaining({ $set: expect.any(Object) })])
    );
  });
});
