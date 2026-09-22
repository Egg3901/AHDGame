/**
 * The two pure converters that sit either side of the frozen snapshot.
 *
 * `buildResultsPayload` itself is exercised by the results route's own tests —
 * it is that route's body, lifted out unchanged. What needs tests of its own is
 * the round trip: which fields survive a capture, and which are deliberately
 * dropped because they are per-request rather than settled.
 */
import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/elections/liveResults/electionNight", () => ({
  buildNationalElectionNight: vi.fn().mockResolvedValue(null),
}));

import { snapshotFromPayload, payloadFromSnapshot } from "./buildResultsPayload";
import type { ElectionResultsResponse } from "./types";
import type { ElectionResultSnapshot } from "@/lib/db/types/electionResultSnapshot";

const ELECTION_OID = new ObjectId();

const election = {
  _id: ELECTION_OID,
  countryId: "US" as const,
  electionType: "president",
  cycle: 3,
  electionYear: 1960,
  totalSeats: 0,
};

function samplePayload(): ElectionResultsResponse {
  return {
    election: {
      id: ELECTION_OID.toString(),
      countryId: "US",
      electionType: "president",
      state: "US",
      status: "resolved",
      cycle: 3,
      electionYear: 1960,
      currentTurn: 999,
      startTurn: 100,
      endTurn: 200,
      totalSeats: 0,
      // The 1960 college, not today's 538.
      evNeeded: 266,
      totalEv: 531,
      finalHour: null,
    },
    candidates: [
      {
        id: "c1",
        name: "Candidate One",
        party: "1",
        partyName: "First Party",
        partyColor: "#123456",
        isNPP: false,
        totalVotes: 100,
        voteSharePct: 100,
        electoralVotes: 300,
        leadingElectoralVotes: 0,
      },
    ],
    units: [],
    national: null,
    summary: {
      totalVotes: 100,
      unitsReporting: 1,
      totalUnits: 1,
      unitsCalled: 1,
      projectedWinner: "c1",
    },
    isAdmin: false,
    lastUpdated: "2026-01-01T00:00:00.000Z",
  };
}

describe("snapshotFromPayload", () => {
  it("keeps the electoral-college totals that governed the race", () => {
    const snap = snapshotFromPayload(samplePayload(), election, 412, new Date("2026-02-02"));
    expect(snap.totalEv).toBe(531);
    expect(snap.evNeeded).toBe(266);
    expect(snap.electionYear).toBe(1960);
  });

  it("keeps the party identity as it stood at capture", () => {
    // A party that later renames or recolours must not rewrite its own past.
    const snap = snapshotFromPayload(samplePayload(), election, 412, new Date("2026-02-02"));
    expect(snap.candidates[0].partyName).toBe("First Party");
    expect(snap.candidates[0].partyColor).toBe("#123456");
  });

  it("stamps the schema version and the capture turn", () => {
    const snap = snapshotFromPayload(samplePayload(), election, 412, new Date("2026-02-02"));
    expect(snap.schemaVersion).toBe(1);
    expect(snap.capturedAtTurn).toBe(412);
    expect(snap.capturedAt).toEqual(new Date("2026-02-02"));
  });

  it("drops the per-request fields rather than freezing them", () => {
    // Freezing isAdmin would serve one reader another reader's page.
    const snap = snapshotFromPayload(
      samplePayload(),
      election,
      412,
      new Date("2026-02-02")
    ) as unknown as Record<string, unknown>;
    expect(snap).not.toHaveProperty("isAdmin");
    expect(snap).not.toHaveProperty("lastUpdated");
    expect(snap).not.toHaveProperty("currentTurn");
    expect(snap).not.toHaveProperty("finalHour");
  });

  it("omits the college fields entirely for a race that has none", () => {
    const payload = samplePayload();
    delete payload.election.totalEv;
    delete payload.election.evNeeded;
    const snap = snapshotFromPayload(
      payload,
      { ...election, electionType: "commons", totalSeats: 650 },
      412,
      new Date("2026-02-02")
    );
    expect(snap).not.toHaveProperty("totalEv");
    expect(snap).not.toHaveProperty("evNeeded");
    expect(snap.totalSeats).toBe(650);
  });
});

describe("payloadFromSnapshot", () => {
  function storedSnapshot(): ElectionResultSnapshot {
    return {
      ...snapshotFromPayload(samplePayload(), election, 412, new Date("2026-02-02")),
      _id: new ObjectId(),
    };
  }

  const electionContext = {
    id: ELECTION_OID.toString(),
    state: "US",
    status: "resolved",
    startTurn: 100,
    endTurn: 200,
  };

  it("restores the frozen college totals", () => {
    const out = payloadFromSnapshot(storedSnapshot(), electionContext, {
      currentTurn: 999,
      isAdmin: false,
    });
    expect(out.election.totalEv).toBe(531);
    expect(out.election.evNeeded).toBe(266);
    expect(out.candidates[0].electoralVotes).toBe(300);
  });

  it("re-applies the live per-request fields", () => {
    const out = payloadFromSnapshot(storedSnapshot(), electionContext, {
      currentTurn: 999,
      isAdmin: true,
    });
    expect(out.election.currentTurn).toBe(999);
    expect(out.isAdmin).toBe(true);
  });

  it("reports the capture time as the payload's last update", () => {
    const snap = storedSnapshot();
    const out = payloadFromSnapshot(snap, electionContext, { currentTurn: 999, isAdmin: false });
    expect(out.lastUpdated).toBe(snap.capturedAt.toISOString());
  });

  it("serves no final-hour drip, because the race already ended", () => {
    const out = payloadFromSnapshot(storedSnapshot(), electionContext, {
      currentTurn: 999,
      isAdmin: false,
    });
    expect(out.election.finalHour).toBeNull();
  });
});
