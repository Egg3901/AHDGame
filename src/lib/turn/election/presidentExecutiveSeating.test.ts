/**
 * Unit tests for seatPresidentialExecutive — focused on the invariant that a
 * newly-seated President/VP must not remain an active candidate in any other
 * (down-ballot) race. A lingering candidacy could otherwise resolve later and
 * seat the executive into a second office (the IL phantom-senator failure mode).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Election, ElectionCandidate } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { clearCabinetOnTransition } from "@/lib/cabinetTransition";

vi.mock("@/lib/cabinetTransition", () => ({
  clearCabinetOnTransition: vi.fn().mockResolvedValue(undefined),
}));

const NOW = new Date("2025-11-15T00:00:00Z");

function makeElection(overrides: Partial<Election> = {}): Election {
  return {
    _id: new ObjectId(),
    countryId: "US",
    electionType: "president",
    cycle: 1,
    status: "completed",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Election;
}

let db: MockDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  for (const name of ["electedOfficials", "characters", "npps", "electionCandidates"]) {
    db.collection(name);
  }
  db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue(null);
  // Both the winner-character and VP-character lookups read from characters.findOne.
  db.collectionMocks["characters"]!.findOne.mockResolvedValue({
    _id: new ObjectId(),
    name: "Exec",
    party: "1",
    careerHistory: [],
    executiveTermsServed: 0,
  });
});

describe("seatPresidentialExecutive", () => {
  it("withdraws the President's and VP's still-active candidacies in other races", async () => {
    const presId = new ObjectId();
    const vpId = new ObjectId();
    const election = makeElection();
    const winnerCandidate = {
      _id: new ObjectId(),
      isNPP: false,
      characterId: presId,
      characterName: "President Pat",
      party: "1",
    } as unknown as ElectionCandidate;

    const { seatPresidentialExecutive } = await import("./presidentExecutiveSeating");
    await seatPresidentialExecutive(db as unknown as Db, {
      election,
      winnerCandidate,
      vpCharId: vpId,
      now: NOW,
    });

    const withdrawCall = db.collectionMocks["electionCandidates"]!.updateMany.mock.calls.find(
      (c) => c[0]?.status === "active" && c[1]?.$set?.status === "withdrawn"
    );
    expect(withdrawCall).toBeDefined();
    const orClause = withdrawCall![0].$or as Array<Record<string, unknown>>;
    const ids = orClause
      .map((o) => (o.characterId as ObjectId | undefined)?.toString())
      .filter(Boolean);
    expect(ids).toContain(presId.toString());
    expect(ids).toContain(vpId.toString());
  });

  it("country-corrects the transition for a non-US (BR) election", async () => {
    const presId = new ObjectId();
    const election = makeElection({ countryId: "BR" });
    const winnerCandidate = {
      _id: new ObjectId(),
      isNPP: false,
      characterId: presId,
      characterName: "Presidente Paulo",
      party: "1",
    } as unknown as ElectionCandidate;

    const { seatPresidentialExecutive } = await import("./presidentExecutiveSeating");
    await seatPresidentialExecutive(db as unknown as Db, {
      election,
      winnerCandidate,
      now: NOW,
    });

    // Cabinet clears for the election's own country, not a hardcoded US.
    expect(clearCabinetOnTransition).toHaveBeenCalledWith(expect.anything(), "BR");

    // Executive term counter increments under the BR key, not US.
    const winnerUpdate = db.collectionMocks["characters"]!.updateOne.mock.calls.find(
      (c) =>
        (c[0] as Record<string, unknown>)?._id === presId && (c[1] as { $push?: unknown })?.$push
    );
    expect(winnerUpdate).toBeDefined();
    const set = (winnerUpdate![1] as { $set: Record<string, unknown> }).$set;
    expect(set["executiveTermsServed.BR"]).toBe(1);
    expect(set["executiveTermsServed.US"]).toBeUndefined();
  });
});
