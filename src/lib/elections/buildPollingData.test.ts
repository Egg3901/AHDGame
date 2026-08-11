import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { ElectionCandidate, PoliticalParty, PrimarySnapshot } from "@/lib/db/types";
import { buildPollingData, computeSeatEstimates } from "./buildPollingData";
import { allocateSeats, getMajoritarianBonus } from "@/lib/turn/election/seatAllocation";

// Minimal fixtures — buildPollingData only reads the fields set here.
function makeCandidate(overrides: Partial<ElectionCandidate>): ElectionCandidate {
  return {
    _id: new ObjectId(),
    electionId: new ObjectId(),
    characterId: new ObjectId(),
    characterName: "Candidate",
    party: "1",
    status: "active",
    enteredAt: new Date("1992-01-01T00:00:00Z"),
    ...overrides,
  } as unknown as ElectionCandidate;
}

function makeParty(seq: number, name: string, color: string): PoliticalParty {
  return {
    sequentialId: seq,
    countryId: "IE",
    name,
    color,
  } as unknown as PoliticalParty;
}

describe("buildPollingData — primary phase", () => {
  it("excludes primary-snapshot entries whose candidate is no longer active", () => {
    // Active candidate that remains in the race.
    const activeRow = makeCandidate({ characterName: "Margaret Connolly", party: "1" });
    const activeId = activeRow._id.toString();

    // A candidate who withdrew (e.g. switched races) AFTER the last snapshot was
    // recorded. They are NOT in activeCandidates, but the snapshot still lists them.
    const staleId = new ObjectId().toString();

    const snapshot: PrimarySnapshot = {
      _id: new ObjectId(),
      electionId: new ObjectId(),
      recordedAt: new Date("1992-01-01T00:00:00Z"),
      byParty: {
        "1": [
          {
            candidateId: staleId,
            characterName: "Senator",
            party: "1",
            primaryScore: 100,
            sharePct: 100,
          },
          {
            candidateId: activeId,
            characterName: "Margaret Connolly",
            party: "1",
            primaryScore: 52,
            sharePct: 36.6,
          },
        ],
      },
    };

    const polling = buildPollingData(
      "governor",
      "IE",
      true, // inPrimary
      [activeRow],
      [makeParty(1, "Fine Gael", "#1d4ed8")],
      null,
      snapshot,
      new Map()
      // no live groups → snapshot fallback
    );

    expect(polling).not.toBeNull();
    // The ghost (withdrawn) candidate must not appear anywhere in the payload.
    expect(polling!.sharesPct).not.toHaveProperty(staleId);
    expect(polling!.candidateNames).not.toHaveProperty(staleId);
    expect(polling!.candidateParties).not.toHaveProperty(staleId);
    // The active candidate is still present.
    expect(polling!.sharesPct).toHaveProperty(activeId);
    // Leader is computed only among active candidates (not the 100% ghost).
    expect(polling!.leaderId).toBe(activeId);
    expect(polling!.leaderName).toBe("Margaret Connolly");
  });

  it("keeps all active candidates present in the snapshot", () => {
    const a = makeCandidate({ characterName: "Janice Boylan", party: "2" });
    const b = makeCandidate({ characterName: "Oisín O'Reilly", party: "2" });
    const aId = a._id.toString();
    const bId = b._id.toString();

    const snapshot: PrimarySnapshot = {
      _id: new ObjectId(),
      electionId: new ObjectId(),
      recordedAt: new Date("1992-01-01T00:00:00Z"),
      byParty: {
        "2": [
          {
            candidateId: aId,
            characterName: "Janice Boylan",
            party: "2",
            primaryScore: 60,
            sharePct: 40.6,
          },
          {
            candidateId: bId,
            characterName: "Oisín O'Reilly",
            party: "2",
            primaryScore: 55,
            sharePct: 40.3,
          },
        ],
      },
    };

    const polling = buildPollingData(
      "dail",
      "IE",
      true,
      [a, b],
      [makeParty(2, "Fianna Fáil", "#16a34a")],
      null,
      snapshot,
      new Map()
    );

    expect(polling!.sharesPct).toHaveProperty(aId, 40.6);
    expect(polling!.sharesPct).toHaveProperty(bId, 40.3);
    expect(polling!.leaderId).toBe(aId);
  });

  // ticket-1022: party/list cards used the hourly snapshot, so a late joiner
  // showed 0% while the election detail page already had live softmax shares.
  it("prefers live party-group shares over a stale snapshot (late joiner)", () => {
    const early = makeCandidate({ characterName: "Larry", party: "1" });
    const late = makeCandidate({ characterName: "Isabel Streibl", party: "1" });
    const earlyId = early._id.toString();
    const lateId = late._id.toString();

    const staleSnapshot: PrimarySnapshot = {
      _id: new ObjectId(),
      electionId: new ObjectId(),
      recordedAt: new Date("1953-01-01T00:00:00Z"),
      byParty: {
        "1": [
          {
            candidateId: earlyId,
            characterName: "Larry",
            party: "1",
            primaryScore: 80,
            sharePct: 91.8,
          },
          // late joiner absent from snapshot → old UI appended them at 0%
        ],
      },
    };

    const liveGroups = [
      {
        partyId: "1",
        partyName: "Labour Party",
        partyColor: "#E4003B",
        countryId: "UK" as const,
        partyEcon: -0.3,
        partySocial: -0.2,
        hasCompetitivePrimary: true,
        candidates: [
          {
            id: lateId,
            characterName: "Isabel Streibl",
            sharePct: 64.8,
          },
          {
            id: earlyId,
            characterName: "Larry",
            sharePct: 33.9,
          },
        ],
      },
    ];

    const polling = buildPollingData(
      "commons",
      "UK",
      true,
      [early, late],
      [makeParty(1, "Labour Party", "#E4003B")],
      null,
      staleSnapshot,
      new Map(),
      liveGroups as never
    );

    expect(polling!.source).toBe("primary");
    expect(polling!.sharesPct[lateId]).toBe(64.8);
    expect(polling!.sharesPct[earlyId]).toBe(33.9);
    expect(polling!.leaderId).toBe(lateId);
    expect(polling!.leaderName).toBe("Isabel Streibl");
  });
});

// ── computeSeatEstimates parity with allocateSeats — ticket #1032 ────────────
//
// The projected-seats panel and the resolver are two separate implementations
// of the same allocation. When they disagree, players see one seat total on
// the election page and a different one on election night — the "inconsistent
// results totals" report on ticket #1032. These tests pin them together on the
// shapes that used to diverge.

describe("computeSeatEstimates — parity with allocateSeats (ticket #1032)", () => {
  const YEAR_1953 = 1953;
  const bonus = getMajoritarianBonus("commons", YEAR_1953);

  /** Runs both engines over the same votes and returns per-party seat totals. */
  function bothEngines(
    region: string,
    seats: number,
    votes: Record<string, number>,
    parties: Record<string, string>
  ) {
    const tally = { totalVotes: votes, candidateParties: parties } as never;
    const projection = computeSeatEstimates("commons", seats, tally, new Set(Object.keys(votes)), bonus);
    const ranked = Object.entries(votes)
      .map(([id, v]) => ({ id, votes: v, party: parties[id] }))
      .sort((a, b) => b.votes - a.votes);
    const totalVotes = ranked.reduce((s, c) => s + c.votes, 0);
    const resolution = allocateSeats("commons", region, seats, ranked, totalVotes, undefined, bonus)
      .seatsEstimate;
    const byParty = (est: Record<string, number> | null) => {
      const out: Record<string, number> = {};
      for (const [id, s] of Object.entries(est ?? {})) {
        if (!s) continue;
        const p = parties[id] ?? "ind";
        out[p] = (out[p] ?? 0) + s;
      }
      return out;
    };
    return { projection: byParty(projection), resolution: byParty(resolution) };
  }

  it("pools a split party's candidates instead of gating each one alone", () => {
    // Live LON shape: Labour split across three candidates (26.4/15.0/13.8)
    // and Conservative across three (22.0/12.0/1.9), plus a 7.1% third party
    // and a 1.9% minor. Judged per-candidate, four of those six major-party
    // candidates sit under the 10% gate; pooled, both majors clear it easily.
    const { projection, resolution } = bothEngines(
      "LON",
      75,
      {
        lab1: 441_139, lab2: 250_370, lab3: 231_630,
        con1: 368_520, con2: 200_235, con3: 31_104,
        third: 118_602, minor: 31_164,
      },
      {
        lab1: "lab", lab2: "lab", lab3: "lab",
        con1: "con", con2: "con", con3: "con",
        third: "third", minor: "minor",
      }
    );
    expect(projection).toEqual(resolution);
    // Both sub-gate parties are zero on both surfaces.
    expect(projection["third"]).toBeUndefined();
    expect(projection["minor"]).toBeUndefined();
  });

  it("matches the resolver when a major party sits just under the gate", () => {
    // Live WAL shape: Labour 75.1% pooled across two candidates, Conservative
    // 17.9% on one, and two minors at 4.2% / 2.8%. The minors used to collect
    // largest-remainder seats on the panel that the resolver never awards.
    const { projection, resolution } = bothEngines(
      "WAL",
      32,
      { lab1: 276_629, lab2: 171_948, con1: 106_882, nat: 25_316, lib: 16_697 },
      { lab1: "lab", lab2: "lab", con1: "con", nat: "nat", lib: "lib" }
    );
    expect(projection).toEqual(resolution);
    expect(projection["nat"]).toBeUndefined();
    expect(projection["lib"]).toBeUndefined();
  });

  it("does not re-admit sub-threshold parties when candidates are fewer than seats", () => {
    // NIR shape: one dominant party and three minors, 4 candidates for 18
    // seats. The old fallback fired here (it required EVERY candidate to
    // clear the gate) and handed the minors seats the resolver never gives.
    const { projection, resolution } = bothEngines(
      "NIR",
      18,
      { uup: 87_000, lib: 6_600, nat: 3_400, lab: 3_000 },
      { uup: "con", lib: "lib", nat: "nat", lab: "lab" }
    );
    expect(projection).toEqual(resolution);
    expect(projection).toEqual({ con: 18 });
  });

  it("keeps an above-gate third party on both surfaces", () => {
    const { projection, resolution } = bothEngines(
      "NEE",
      27,
      { lab: 52_900, con: 34_000, lib: 13_100 },
      { lab: "lab", con: "con", lib: "lib" }
    );
    expect(projection).toEqual(resolution);
    expect(projection["lib"]).toBeGreaterThan(0);
  });

  it("still fills seats when no party clears the gate at all", () => {
    // Degenerate: five parties, none above 10%. Both engines fall back to
    // ranked order rather than returning nothing.
    const votes = { a: 21, b: 20, c: 20, d: 20, e: 19 };
    const parties = { a: "pa", b: "pb", c: "pc", d: "pd", e: "pe" };
    const { projection, resolution } = bothEngines("UNKNOWN_REGION", 10, votes, parties);
    expect(projection).toEqual(resolution);
    const total = Object.values(projection).reduce((s, v) => s + v, 0);
    expect(total).toBe(10);
  });
});
