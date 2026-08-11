import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import type { Seat } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { buildUsStateSeats, seedSeats } from "./seedSeats";

function withUsStates(db: MockDb, docs: unknown[]) {
  db.collection("states");
  db.collectionMocks.states!.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(docs),
  } as never);
}

/** Seat docs seedSeats upserted, for a given state. */
function seatsFor(db: MockDb, stateId: string): Seat[] {
  const ops = db.collectionMocks.seats!.bulkWrite.mock.calls.flatMap(
    (call) => call[0] as Array<{ updateOne: { filter: { _id: string }; update: { $set: Seat } } }>
  );
  return ops
    .map((op) => ({ ...op.updateOne.update.$set, _id: op.updateOne.filter._id }) as Seat)
    .filter((s) => s.countryId === "US" && s.state === stateId);
}

describe("buildUsStateSeats", () => {
  it("builds House, both Senate classes, Governor and State Senate", () => {
    const seats = buildUsStateSeats("AK", 1, new Date("2026-01-01"));
    const types = seats.map((s) => s.electionType).sort();
    expect(types).toEqual(["governor", "house", "senate", "senate", "stateSenate"]);
    expect(seats.find((s) => s.electionType === "house")!.totalSeats).toBe(1);
    expect(seats.every((s) => s.countryId === "US" && s.state === "AK")).toBe(true);
  });

  it("carries the delegation size it is given", () => {
    const seats = buildUsStateSeats("AK", 3, new Date("2026-01-01"));
    expect(seats.find((s) => s.electionType === "house")!.totalSeats).toBe(3);
  });

  it("produces stable ids, so re-running an admission cannot duplicate seats", () => {
    const a = buildUsStateSeats("HI", 2, new Date("2026-01-01"));
    const b = buildUsStateSeats("HI", 2, new Date("2027-06-06"));
    expect(a.map((s) => s._id)).toEqual(b.map((s) => s._id));
  });
});

describe("seedSeats — statehood", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("seats");
  });

  it("gives a 1953 world no Alaska or Hawaii seats", async () => {
    withUsStates(db, []);

    await seedSeats(db as unknown as Db, false, () => {}, "1953-default");

    expect(seatsFor(db, "AK")).toEqual([]);
    expect(seatsFor(db, "HI")).toEqual([]);
  });

  it("keeps the seats of a state admitted mid-game", async () => {
    // A world that admitted Alaska in 1959 and has since reapportioned it to 2.
    withUsStates(db, [{ _id: "AK", admittedYear: 1959, houseDistricts: 2 }]);

    await seedSeats(db as unknown as Db, false, () => {}, "1953-default");

    const types = seatsFor(db, "AK")
      .map((s) => s.electionType)
      .sort();
    expect(types).toEqual(["governor", "house", "senate", "senate", "stateSenate"]);
    // Hawaii was never admitted in this world, so it stays a territory.
    expect(seatsFor(db, "HI")).toEqual([]);
  });

  it("uses the live delegation size for an admitted state, not the floor", async () => {
    withUsStates(db, [{ _id: "AK", admittedYear: 1959, houseDistricts: 3 }]);

    await seedSeats(db as unknown as Db, false, () => {}, "1953-default");

    const akHouse = seatsFor(db, "AK").find((s) => s.electionType === "house");
    expect(akHouse?.totalSeats).toBe(3);
  });
});
