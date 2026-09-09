import { describe, expect, it, vi } from "vitest";
import { insertManyIgnoringDuplicateKey, isDuplicateKeyError } from "./duplicateKey";

describe("isDuplicateKeyError", () => {
  it("matches Mongo 11000 on the error itself", () => {
    expect(isDuplicateKeyError(Object.assign(new Error("dup"), { code: 11000 }))).toBe(true);
  });

  it("matches a bulk writeErrors 11000", () => {
    expect(
      isDuplicateKeyError(
        Object.assign(new Error("batch"), { writeErrors: [{ code: 11000 }, { code: 50 }] })
      )
    ).toBe(true);
  });

  it("matches an E11000 message", () => {
    expect(
      isDuplicateKeyError(
        new Error(
          "E11000 duplicate key error collection: nationalPartyElections index: unique_voting_national_party_election_per_seat"
        )
      )
    ).toBe(true);
  });

  it("rejects unrelated errors", () => {
    expect(isDuplicateKeyError(new Error("nope"))).toBe(false);
    expect(isDuplicateKeyError({ code: 50 })).toBe(false);
  });
});

describe("insertManyIgnoringDuplicateKey", () => {
  it("returns insertedCount on success", async () => {
    const insertMany = vi.fn().mockResolvedValue({ insertedCount: 3 });
    await expect(insertManyIgnoringDuplicateKey({ insertMany }, [{}, {}, {}])).resolves.toBe(3);
    expect(insertMany).toHaveBeenCalledWith([{}, {}, {}], { ordered: false });
  });

  it("returns the partial insertedCount when a unique voting index rejects the rest", async () => {
    const insertMany = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("E11000 duplicate key"), { code: 11000, insertedCount: 2 })
      );
    await expect(insertManyIgnoringDuplicateKey({ insertMany }, [{}, {}, {}])).resolves.toBe(2);
  });

  it("rethrows non-duplicate failures", async () => {
    const insertMany = vi.fn().mockRejectedValue(Object.assign(new Error("boom"), { code: 50 }));
    await expect(insertManyIgnoringDuplicateKey({ insertMany }, [{}])).rejects.toThrow("boom");
  });
});
