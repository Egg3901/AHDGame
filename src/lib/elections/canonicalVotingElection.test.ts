import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import {
  compareVotingElections,
  pickCanonicalVotingElection,
  pickCanonicalVotingElectionPerKey,
} from "./canonicalVotingElection";

function election(overrides: {
  startTurn: number;
  createdAt?: Date;
  id?: string;
  position?: string;
}) {
  return {
    _id: overrides.id ? new ObjectId(overrides.id) : new ObjectId(),
    startTurn: overrides.startTurn,
    createdAt: overrides.createdAt,
    position: overrides.position ?? "chair",
  };
}

describe("pickCanonicalVotingElection", () => {
  it("returns undefined for an empty list", () => {
    expect(pickCanonicalVotingElection([])).toBeUndefined();
  });

  it("prefers the earlier startTurn", () => {
    const later = election({ startTurn: 540 });
    const earlier = election({ startTurn: 470 });
    expect(pickCanonicalVotingElection([later, earlier])).toBe(earlier);
    expect(pickCanonicalVotingElection([earlier, later])).toBe(earlier);
  });

  it("breaks a startTurn tie on createdAt then _id", () => {
    const olderId = "6a9283baeb457222c6eeeb19";
    const newerId = "6a965c018787ba3047f22d6b";
    const older = election({
      startTurn: 470,
      createdAt: new Date("2026-08-29T07:00:00.474Z"),
      id: olderId,
    });
    const newer = election({
      startTurn: 470,
      createdAt: new Date("2026-09-01T05:00:00.120Z"),
      id: newerId,
    });
    expect(pickCanonicalVotingElection([newer, older])).toBe(older);
    expect(compareVotingElections(older, newer)).toBeLessThan(0);
  });

  it("keeps one canonical row per key", () => {
    const chairReal = election({ startTurn: 470, position: "chair" });
    const chairDup = election({ startTurn: 540, position: "chair" });
    const vice = election({ startTurn: 470, position: "viceChair" });
    const picked = pickCanonicalVotingElectionPerKey(
      [chairDup, vice, chairReal],
      (row) => row.position
    );
    expect(picked).toHaveLength(2);
    expect(picked).toContain(chairReal);
    expect(picked).toContain(vice);
    expect(picked).not.toContain(chairDup);
  });
});
