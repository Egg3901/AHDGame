import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  ELECTION_RESULT_SNAPSHOT_VERSION,
  type ElectionResultSnapshot,
} from "./electionResultSnapshot";

const emptySummary = {
  totalVotes: 0,
  unitsReporting: 0,
  totalUnits: 0,
  unitsCalled: 0,
  projectedWinner: null,
};

describe("ElectionResultSnapshot", () => {
  it("pins the schema version at 1", () => {
    // The results route refuses to serve a snapshot whose version it does not
    // recognise, so this constant is a compatibility contract, not a detail.
    expect(ELECTION_RESULT_SNAPSHOT_VERSION).toBe(1);
  });

  it("carries the electoral-college totals that were in force at the time", () => {
    const snap: ElectionResultSnapshot = {
      _id: new ObjectId(),
      electionId: new ObjectId(),
      countryId: "US",
      electionType: "president",
      cycle: 3,
      electionYear: 1960,
      schemaVersion: 1,
      capturedAt: new Date("2026-09-20T00:00:00.000Z"),
      capturedAtTurn: 412,
      totalEv: 531,
      evNeeded: 266,
      totalSeats: 0,
      candidates: [],
      units: [],
      national: null,
      summary: emptySummary,
    };
    expect(snap.schemaVersion).toBe(ELECTION_RESULT_SNAPSHOT_VERSION);
    // 531, not today's 538: a 1960 race was decided under its own map.
    expect(snap.totalEv).toBe(531);
    expect(snap.evNeeded).toBe(266);
  });

  it("lets a non-presidential race omit the electoral-college fields", () => {
    const snap: ElectionResultSnapshot = {
      _id: new ObjectId(),
      electionId: new ObjectId(),
      countryId: "UK",
      electionType: "commons",
      cycle: 2,
      electionYear: null,
      schemaVersion: 1,
      capturedAt: new Date("2026-09-20T00:00:00.000Z"),
      capturedAtTurn: 500,
      totalSeats: 650,
      candidates: [],
      units: [],
      national: null,
      summary: emptySummary,
    };
    expect(snap.totalEv).toBeUndefined();
    expect(snap.evNeeded).toBeUndefined();
  });
});
