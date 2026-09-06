import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { applyCloneControllerPolicy } from "./cloneControllers";

function fakeDb() {
  const updates: unknown[] = [];
  const npps = [{ _id: "npp-1", countryId: "US" }];
  const corporations = [
    { _id: "corp-player", countryId: "US", ceoId: "player-1" },
    { _id: "corp-state", countryId: "US", ceoId: "state-1" },
  ];
  const db = {
    collection(name: string) {
      if (name === "npps") return { find: () => ({ toArray: async () => npps }) };
      if (name === "corporations") {
        return {
          find: () => corporations.filter((corp) => corp._id === "corp-player"),
          updateOne: async (...args: unknown[]) => {
            updates.push(args);
          },
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  };
  return { db, updates };
}

describe("applyCloneControllerPolicy", () => {
  it("writes NPP controller fields by default", async () => {
    const { db, updates } = fakeDb();
    const converted = await applyCloneControllerPolicy(db as unknown as Db, () => {}, false);
    expect(converted).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual([
      { _id: "corp-player" },
      expect.objectContaining({
        $set: expect.objectContaining({ ceoType: "npp", ceoId: "npp-1" }),
      }),
    ]);
  });

  it("does not write controllers when the player rail is preserved", async () => {
    const { db, updates } = fakeDb();
    const converted = await applyCloneControllerPolicy(db as unknown as Db, () => {}, true);
    expect(converted).toBe(0);
    expect(updates).toHaveLength(0);
  });
});
