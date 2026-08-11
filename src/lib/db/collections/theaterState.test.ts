import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { getTheaterState } from "./theaterState";

describe("getTheaterState", () => {
  it("returns defaults when the country has no situation doc", async () => {
    const db = createMockDb();
    db.collection("theaterState");
    db.collectionMocks.theaterState.findOne.mockResolvedValue(null);
    const s = await getTheaterState(db as unknown as Db, "US");
    expect(s).toEqual({ cohesion: 85, committed: {} });
  });

  it("returns the stored cohesion + committed when present", async () => {
    const db = createMockDb();
    db.collection("theaterState");
    db.collectionMocks.theaterState.findOne.mockResolvedValue({
      countryId: "US",
      cohesion: 70,
      committed: { afghan: 100 },
    });
    const s = await getTheaterState(db as unknown as Db, "US");
    expect(s).toEqual({ cohesion: 70, committed: { afghan: 100 } });
  });
});

import { vi } from "vitest";
import { listTheaterStates } from "./theaterState";

describe("listTheaterStates", () => {
  it("returns all theater-state docs", async () => {
    const db = createMockDb();
    db.collection("theaterState");
    const toArray = vi.fn().mockResolvedValue([{ countryId: "US", committed: { afghan: 100 } }]);
    db.collectionMocks.theaterState.find.mockReturnValue({ toArray });
    const r = await listTheaterStates(db as unknown as Db);
    expect(db.collectionMocks.theaterState.find).toHaveBeenCalledWith({});
    expect(r).toHaveLength(1);
  });
});
