import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { buildApportionment, loadApportionment } from "./apportionment";

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

function withUsStates(db: MockDb, docs: unknown[]) {
  db.collection("states");
  db.collectionMocks.states!.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(docs),
  } as never);
}

describe("buildApportionment — statehood admission", () => {
  it("leaves a 1953 world at 48 states and 531 electoral votes with no admissions", () => {
    const a = buildApportionment({}, "1953-default", 1953);
    expect(Object.keys(a.houseSeats)).toHaveLength(48);
    expect(a.houseSeats.AK).toBeUndefined();
    expect(a.houseSeats.HI).toBeUndefined();
    expect(sum(a.electoralVotes)).toBe(531);
  });

  it("admits a territory into the seats map at the constitutional one-seat floor", () => {
    const a = buildApportionment({}, "1953-default", 1959, ["AK"]);
    expect(a.houseSeats.AK).toBe(1);
    // 1 House seat + 2 senators = 3 EV on top of the 48-state total.
    expect(a.electoralVotes.AK).toBe(3);
    expect(sum(a.electoralVotes)).toBe(534);
  });

  it("admits several territories independently", () => {
    const a = buildApportionment({}, "1953-default", 1960, ["AK", "HI"]);
    expect(a.houseSeats.AK).toBe(1);
    expect(a.houseSeats.HI).toBe(1);
    expect(sum(a.electoralVotes)).toBe(537);
  });

  it("honours a live seat count for an admitted state over the floor", () => {
    // After a census reapportions, an admitted state can hold more than one seat.
    const a = buildApportionment({ AK: 2 }, "1953-default", 1970, ["AK"]);
    expect(a.houseSeats.AK).toBe(2);
    expect(a.electoralVotes.AK).toBe(4);
  });

  it("does not disturb states already in the map", () => {
    const withAk = buildApportionment({}, "1953-default", 1959, ["AK"]);
    const without = buildApportionment({}, "1953-default", 1959);
    for (const [id, seats] of Object.entries(without.houseSeats)) {
      expect(withAk.houseSeats[id]).toBe(seats);
    }
  });

  it("is a no-op for a preset that already carries the state", () => {
    const withAk = buildApportionment({}, "2019-default", 2019, ["AK"]);
    const without = buildApportionment({}, "2019-default", 2019);
    expect(withAk.houseSeats).toEqual(without.houseSeats);
    expect(sum(withAk.electoralVotes)).toBe(sum(without.electoralVotes));
  });
});

describe("loadApportionment — statehood admission", () => {
  it("reads admittedYear from the state docs", async () => {
    const db = createMockDb();
    withUsStates(db, [
      { _id: "CA", houseDistricts: 30 },
      { _id: "AK", admittedYear: 1959, houseDistricts: 1 },
    ]);

    const a = await loadApportionment(db as unknown as Db, "1953-default", 1962);
    expect(a.houseSeats.AK).toBe(1);
    expect(a.electoralVotes.AK).toBe(3);
  });

  it("ignores an admission dated after the current year", async () => {
    const db = createMockDb();
    withUsStates(db, [{ _id: "AK", admittedYear: 1959, houseDistricts: 1 }]);

    const a = await loadApportionment(db as unknown as Db, "1953-default", 1955);
    expect(a.houseSeats.AK).toBeUndefined();
    expect(a.electoralVotes.AK).toBeUndefined();
  });

  it("falls back to the preset's starting year when no live year is passed", async () => {
    const db = createMockDb();
    withUsStates(db, [{ _id: "AK", admittedYear: 1959, houseDistricts: 1 }]);

    // 1953-default starts in 1953, which is before the admission.
    const a = await loadApportionment(db as unknown as Db, "1953-default");
    expect(a.houseSeats.AK).toBeUndefined();
  });
});
