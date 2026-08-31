import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

import { spawnHouseElection } from "./electionSpawning";
import type { Election } from "@/lib/db/types";

/**
 * Ticket #1190. `spawnHouseElection` runs from `generalResolution` the instant a
 * House cycle resolves. It used to size the next cycle from the RESOLVING
 * election's `totalSeats`, so a delegation reapportioned by the decennial census
 * handed its stale seat count straight to its successor — the same inheritance
 * that let a pre-census number propagate forever through
 * `ensurePerpetualElections`.
 */
function setup(db: MockDb, opts: { houseDistricts: number; currentYear?: number }): void {
  const elections = db.collection("elections");
  elections.findOne = vi.fn().mockResolvedValue(null); // no live successor yet
  elections.insertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
  db.collection("gameState").findOne = vi.fn().mockResolvedValue({
    _id: "current",
    currentTurn: 400,
    preset: "1953-default",
    startingYear: 1953,
    currentYear: opts.currentYear ?? 1960,
  });
  db.collection("states");
  db.collectionMocks.states!.find = vi.fn().mockReturnValue({
    toArray: vi.fn().mockResolvedValue([{ _id: "TX", houseDistricts: opts.houseDistricts }]),
  } as never);
}

const resolvedRace = (totalSeats: number): Election =>
  ({
    _id: new ObjectId(),
    countryId: "US",
    electionType: "house",
    state: "TX",
    cycle: 3,
    status: "resolved",
    totalSeats,
    endTime: new Date("2026-01-02T00:00:00Z"),
  }) as unknown as Election;

describe("spawnHouseElection — seat count follows the live apportionment (#1190)", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as never);
  });

  it("sizes the next cycle from the census, not from the race that just ended", async () => {
    // TX was reapportioned 22 -> 26; the resolving race still carries 22.
    setup(db, { houseDistricts: 26 });

    await spawnHouseElection(db as never, resolvedRace(22), new Date());

    const inserted = vi.mocked(db.collection("elections").insertOne).mock
      .calls[0][0] as unknown as Election;
    expect(inserted.totalSeats).toBe(26);
  });

  it("keeps the resolving race's count when the state has no live apportionment", async () => {
    // An unadmitted/absent state must not be resized to the 1-seat backstop.
    setup(db, { houseDistricts: 0 });

    await spawnHouseElection(db as never, resolvedRace(22), new Date());

    const inserted = vi.mocked(db.collection("elections").insertOne).mock
      .calls[0][0] as unknown as Election;
    expect(inserted.totalSeats).toBe(22);
  });
});
