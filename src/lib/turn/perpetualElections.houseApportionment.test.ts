import { describe, expect, it } from "vitest";
import { ObjectId, type AnyBulkWriteOperation } from "mongodb";
import type { Election } from "@/lib/db/types";
import { buildHouseSeatHealOps } from "./perpetualElections";

/**
 * Ticket #1190. The decennial census reapportions `state.houseDistricts` and
 * regenerates the congressional-district maps, but the live House `Election`
 * docs kept the seat count they were spawned with — so a state that dropped
 * 9 → 8 rendered "projected 7 of 9 seats" over an 8-district map, and its
 * delegation resolved one seat short.
 */

const oid = (n: number) => new ObjectId(String(n).padStart(24, "0"));

type HouseRace = Pick<Election, "_id" | "electionType" | "countryId" | "state" | "totalSeats">;

const race = (id: number, state: string, totalSeats: number, countryId = "US"): HouseRace =>
  ({ _id: oid(id), electionType: "house", countryId, state, totalSeats }) as HouseRace;

const NOW = new Date("2026-08-25T19:00:00.000Z");

/** `AnyBulkWriteOperation` is a union; the helper only ever emits `updateOne`. */
const seatsOf = (op: AnyBulkWriteOperation<Election>): number =>
  (op as { updateOne: { update: { $set: { totalSeats: number } } } }).updateOne.update.$set
    .totalSeats;

describe("buildHouseSeatHealOps — census reapportionment reaches live races (#1190)", () => {
  it("heals a race whose totalSeats predates the census", () => {
    // AL was reapportioned 9 → 8 by the in-game 1960 census.
    const ops = buildHouseSeatHealOps([race(1, "AL", 9)], { AL: 8 }, NOW);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({
      updateOne: {
        filter: { _id: oid(1) },
        update: { $set: { totalSeats: 8, updatedAt: NOW } },
      },
    });
  });

  it("heals a state that GAINED seats too", () => {
    const ops = buildHouseSeatHealOps([race(1, "TX", 22)], { TX: 26 }, NOW);
    expect(ops).toHaveLength(1);
    expect(seatsOf(ops[0])).toBe(26);
  });

  it("leaves an already-correct race untouched", () => {
    expect(buildHouseSeatHealOps([race(1, "WY", 1)], { WY: 1 }, NOW)).toEqual([]);
  });

  it("ignores non-House races", () => {
    const senate = { ...race(1, "AL", 1), electionType: "senate" } as HouseRace;
    expect(buildHouseSeatHealOps([senate], { AL: 8 }, NOW)).toEqual([]);
  });

  it("never applies US apportionment to another country's House races", () => {
    // NG zone races share electionType "house"; their seat counts are their own.
    const ng = race(1, "NG_NC", 44, "NG");
    expect(buildHouseSeatHealOps([ng], { NG_NC: 8 }, NOW)).toEqual([]);
  });

  it("skips a state absent from the apportionment map", () => {
    // A territory with no House seats yet must not be healed to 0.
    expect(buildHouseSeatHealOps([race(1, "HI", 1)], { AL: 8 }, NOW)).toEqual([]);
  });

  it("skips a non-positive apportionment rather than zeroing a live race", () => {
    expect(buildHouseSeatHealOps([race(1, "AL", 9)], { AL: 0 }, NOW)).toEqual([]);
  });

  it("heals only the drifted races in a mixed set", () => {
    const ops = buildHouseSeatHealOps(
      [race(1, "AL", 9), race(2, "WY", 1), race(3, "NY", 43)],
      { AL: 8, WY: 1, NY: 40 },
      NOW
    );
    expect(ops.map(seatsOf)).toEqual([8, 40]);
  });
});
