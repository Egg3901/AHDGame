/**
 * The first election after a one-party-state conversion honors the terms the
 * conversion set: the former ruling party's reserved seat share and, on a
 * forced conversion, its vote penalty. Every other election is untouched.
 */
import { describe, expect, it } from "vitest";
import { applyConversionVotePenalty, applyLegacySeatFloor } from "./conversionTerms";
import { allocateSeats } from "./seatAllocation";

const SED = "1";
const ranked = [
  { id: "spd", votes: 5200, party: "2" },
  { id: "cdu", votes: 3100, party: "3" },
  { id: "sed", votes: 900, party: SED },
  { id: "fdp", votes: 800, party: "4" },
];

function allocate(seats: number) {
  const total = ranked.reduce((n, c) => n + c.votes, 0);
  return allocateSeats("commons", "EAE", seats, ranked, total, undefined, undefined, {
    EAE: seats,
  });
}

function partySeats(winners: [string, number][], party: string) {
  const partyOf = new Map(ranked.map((c) => [c.id, c.party]));
  return winners.reduce((n, [id, s]) => n + (partyOf.get(id) === party ? s : 0), 0);
}

describe("applyLegacySeatFloor", () => {
  it("lifts the former ruling party to its reserved share and keeps the total", () => {
    const base = allocate(40);
    expect(partySeats(base.winners, SED)).toBeLessThan(8);

    const floored = applyLegacySeatFloor(base, ranked, {
      formerRulingPartyId: SED,
      legacyReservationPct: 20,
    });
    expect(partySeats(floored.winners, SED)).toBe(8);
    expect(floored.winners.reduce((n, [, s]) => n + s, 0)).toBe(40);
    expect(floored.seatsEstimate.sed).toBe(8);
    // Seats come off the biggest holder first.
    const before = new Map(base.winners);
    const after = new Map(floored.winners);
    expect((before.get("spd") ?? 0) - (after.get("spd") ?? 0)).toBeGreaterThan(0);
    expect(floored.losers).not.toContain("sed");
  });

  it("seats a former ruling party that won nothing on the vote", () => {
    const tiny = [...ranked.slice(0, 3).map((c) => (c.id === "sed" ? { ...c, votes: 10 } : c))];
    const total = tiny.reduce((n, c) => n + c.votes, 0);
    const base = allocateSeats("commons", "EAE", 10, tiny, total, undefined, undefined, {
      EAE: 10,
    });
    expect(base.winners.find(([id]) => id === "sed")).toBeUndefined();

    const floored = applyLegacySeatFloor(base, tiny, {
      formerRulingPartyId: SED,
      legacyReservationPct: 20,
    });
    expect(new Map(floored.winners).get("sed")).toBe(2);
    expect(floored.losers).not.toContain("sed");
  });

  it("leaves the result alone when the party already clears its share", () => {
    const base = allocate(40);
    const floored = applyLegacySeatFloor(base, ranked, {
      formerRulingPartyId: "2",
      legacyReservationPct: 20,
    });
    expect(floored).toBe(base);
  });

  it("cannot seat a party that stood no candidate in the region", () => {
    const base = allocate(40);
    const floored = applyLegacySeatFloor(base, ranked, {
      formerRulingPartyId: "99",
      legacyReservationPct: 35,
    });
    expect(floored).toBe(base);
  });

  it("is a no-op without conversion terms or a reservation", () => {
    const base = allocate(40);
    expect(applyLegacySeatFloor(base, ranked, undefined)).toBe(base);
    expect(
      applyLegacySeatFloor(base, ranked, { formerRulingPartyId: SED, legacyReservationPct: 0 })
    ).toBe(base);
  });
});

describe("applyConversionVotePenalty", () => {
  const partyOf = (id: string) => ranked.find((c) => c.id === id)?.party;
  const votes = Object.fromEntries(ranked.map((c) => [c.id, c.votes]));

  it("scales only the former ruling party's votes by 1 + penalty", () => {
    const out = applyConversionVotePenalty(votes, partyOf, {
      formerRulingPartyId: SED,
      legacyReservationPct: 5,
      voteSharePenalty: -0.2,
    });
    expect(out).toEqual({ ...votes, sed: 720 });
  });

  it("returns null when there is no penalty to apply", () => {
    expect(applyConversionVotePenalty(votes, partyOf, undefined)).toBeNull();
    expect(
      applyConversionVotePenalty(votes, partyOf, {
        formerRulingPartyId: SED,
        legacyReservationPct: 20,
      })
    ).toBeNull();
  });
});
