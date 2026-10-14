import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { withPartyTerritoryMutation } from "./territoryMutation";

const us = { countryId: "US", partyId: "1" } as const;
function fixture() {
  const mock = createMockDb();
  const tokens = new Map<string, string>();
  mock.collection("politicalParties").updateMany.mockImplementation(
    async (
      filter: {
        $or: { countryId: string; sequentialId: number }[];
        "territoryMutation.token"?: string;
      },
      update: { $set?: { territoryMutation: { token: string } }; $unset?: object }
    ) => {
      for (const identity of filter.$or) {
        const key = `${identity.countryId}:${identity.sequentialId}`;
        if (update.$set) {
          if (!tokens.has(key)) tokens.set(key, update.$set.territoryMutation.token);
        } else if (tokens.get(key) === filter["territoryMutation.token"]) tokens.delete(key);
      }
      return { matchedCount: 1 };
    }
  );
  mock.collection("politicalParties").findOne.mockResolvedValue({ _id: new ObjectId() });
  mock
    .collection("politicalParties")
    .find.mockImplementation(
      (filter: {
        $or: { countryId: string; sequentialId: number }[];
        "territoryMutation.token": { $ne: string };
      }) => {
        const cursor = {
          limit: () => cursor,
          toArray: async () =>
            filter.$or
              .filter(
                (identity) =>
                  tokens.get(`${identity.countryId}:${identity.sequentialId}`) !==
                  filter["territoryMutation.token"].$ne
              )
              .map(() => ({ _id: new ObjectId() })),
        };
        return cursor;
      }
    );
  return { mock, db: mock as unknown as Db, tokens };
}

describe("cross-process party territory writer admission", () => {
  it.each(["01", "1abc", "+1", " 1 "])(
    "claims URL alias %s as the canonical party",
    async (partyId) => {
      const { db, tokens } = fixture();
      await withPartyTerritoryMutation(db, [{ ...us, partyId }, us], async () => {
        expect([...tokens.keys()]).toEqual(["US:1"]);
        await expect(withPartyTerritoryMutation(db, [us], async () => undefined)).rejects.toThrow(
          "in progress"
        );
      });
      expect(tokens.size).toBe(0);
    }
  );
  it("releases its own partial claim after a lost acquisition acknowledgement", async () => {
    const { mock, db, tokens } = fixture();
    const write = mock.collection("politicalParties").updateMany;
    const original = write.getMockImplementation()!;
    write.mockImplementationOnce(async (...args: unknown[]) => {
      await original(...args);
      throw new Error("lost acknowledgement");
    });
    await expect(withPartyTerritoryMutation(db, [us], async () => undefined)).rejects.toThrow(
      "lost acknowledgement"
    );
    expect(tokens.size).toBe(0);
  });
  it("rejects a simultaneous same-party writer before its eligibility reads", async () => {
    const { db, tokens } = fixture();
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withPartyTerritoryMutation(db, [us], async () => {
      entered();
      await gate;
      return "done";
    });
    await ready;
    let ran = false;
    await expect(
      withPartyTerritoryMutation(db, [us], async () => {
        ran = true;
      })
    ).rejects.toThrow("in progress");
    expect(ran).toBe(false);
    expect(tokens.size).toBe(1);
    release();
    expect(await first).toBe("done");
    expect(tokens.size).toBe(0);
    expect(await withPartyTerritoryMutation(db, [us], async () => "next")).toBe("next");
  });
  it("cleans up owned claims after a rejected business operation", async () => {
    const { db, tokens } = fixture();
    await expect(
      withPartyTerritoryMutation(db, [us], async () => {
        throw new Error("reject");
      })
    ).rejects.toThrow("reject");
    expect(tokens.size).toBe(0);
  });
  it("releases partial acquisition without removing someone else's claim", async () => {
    const { db, tokens } = fixture();
    tokens.set("US:2", "other");
    await expect(
      withPartyTerritoryMutation(db, [us, { countryId: "US", partyId: "2" }], async () => undefined)
    ).rejects.toThrow("in progress");
    expect([...tokens]).toEqual([["US:2", "other"]]);
  });
  it("deduplicates claims and scopes equal sequential ids by country", async () => {
    const { db, tokens } = fixture();
    await withPartyTerritoryMutation(db, [us, us, { countryId: "UK", partyId: "1" }], async () => {
      expect(tokens.size).toBe(2);
    });
    expect(tokens.size).toBe(0);
  });
  it("rejects stale actor membership before work and releases its claim", async () => {
    const { mock, db, tokens } = fixture();
    const expected = { _id: new ObjectId(), homeState: "OR", countryId: "US", party: "1" } as const;
    mock.collection("characters").findOne.mockResolvedValue({ ...expected, party: "independent" });
    await expect(
      withPartyTerritoryMutation(
        db,
        [us],
        async () => {
          throw new Error("must not run");
        },
        expected
      )
    ).rejects.toThrow("membership changed");
    expect(tokens.size).toBe(0);
  });
  it("never expires an abandoned claim while its old writer might still resume", async () => {
    const { mock, db, tokens } = fixture();
    tokens.set("US:1", "abandoned");
    await expect(withPartyTerritoryMutation(db, [us], async () => undefined)).rejects.toThrow(
      "contact staff"
    );
    expect(tokens.get("US:1")).toBe("abandoned");
    expect(mock.collection("politicalParties").updateMany.mock.calls[0][0]).toMatchObject({
      territoryMutation: { $exists: false },
    });
  });
});
