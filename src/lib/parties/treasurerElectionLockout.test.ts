import { describe, it, expect, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  isTreasurerElectionLockoutActive,
  wouldUseVacantTreasurerFallback,
  TREASURER_LOCKOUT_TURNS,
} from "./treasurerElectionLockout";

const PARTY = { sequentialId: 3, countryId: "UK" as const };

/**
 * Minimal Db stub: `nationalPartyElections.find().toArray()` returns the
 * supplied elections, `nationalPartyCandidates.countDocuments()` returns
 * the supplied count. Captures both filters for assertion.
 */
function makeDbStub(elections: unknown[], activeCandidates: number) {
  const filters: Record<string, unknown> = {};
  const db = {
    collection: vi.fn().mockImplementation((name: string) => {
      if (name === "nationalPartyElections") {
        return {
          find: vi.fn().mockImplementation((filter: unknown) => {
            filters.elections = filter;
            return { toArray: () => Promise.resolve(elections) };
          }),
        };
      }
      if (name === "nationalPartyCandidates") {
        return {
          countDocuments: vi.fn().mockImplementation((filter: unknown) => {
            filters.candidates = filter;
            return Promise.resolve(activeCandidates);
          }),
        };
      }
      throw new Error(`unexpected collection ${name}`);
    }),
  } as unknown as Db;
  return { db, filters };
}

function election(seed: Partial<{ _id: ObjectId; endTurn: number }> = {}) {
  return { _id: seed._id ?? new ObjectId(), endTurn: seed.endTurn ?? 100 };
}

describe("isTreasurerElectionLockoutActive", () => {
  it("is inactive when no open Treasurer election exists", async () => {
    const { db } = makeDbStub([], 0);
    expect(await isTreasurerElectionLockoutActive(db, PARTY, 100)).toBe(false);
  });

  it("is active when a closing election has a candidate standing", async () => {
    const { db } = makeDbStub([election({ endTurn: 103 })], 1);
    expect(await isTreasurerElectionLockoutActive(db, PARTY, 100)).toBe(true);
  });

  it("is inactive when the closing election has no candidates", async () => {
    // Nobody running means nobody gets seated, so the vacant-seat
    // fallback has to stay available or the party is stuck.
    const { db } = makeDbStub([election({ endTurn: 103 })], 0);
    expect(await isTreasurerElectionLockoutActive(db, PARTY, 100)).toBe(false);
  });

  it("queries only elections closing within the lockout window", async () => {
    const { db, filters } = makeDbStub([election()], 1);
    await isTreasurerElectionLockoutActive(db, PARTY, 100);
    expect(filters.elections).toMatchObject({
      partyId: "3",
      countryId: "UK",
      position: "treasurer",
      status: "voting",
      endTurn: { $lte: 100 + TREASURER_LOCKOUT_TURNS },
    });
  });

  it("counts only candidates still standing", async () => {
    const electionId = new ObjectId();
    const { db, filters } = makeDbStub([election({ _id: electionId })], 1);
    await isTreasurerElectionLockoutActive(db, PARTY, 100);
    expect(filters.candidates).toEqual({
      electionId: { $in: [electionId] },
      status: "active",
    });
  });

  it("treats an overdue election still in voting as inside the window", async () => {
    // endTurn already passed: the query's $lte bound matches, and an
    // overdue race is the most sensitive moment, not a reason to reopen.
    const { db } = makeDbStub([election({ endTurn: 90 })], 1);
    expect(await isTreasurerElectionLockoutActive(db, PARTY, 100)).toBe(true);
  });

  it("scopes the query to this party and country", async () => {
    const { db, filters } = makeDbStub([], 0);
    await isTreasurerElectionLockoutActive(db, { sequentialId: 7, countryId: "US" }, 50);
    expect(filters.elections).toMatchObject({ partyId: "7", countryId: "US" });
  });
});

describe("wouldUseVacantTreasurerFallback", () => {
  it("is true for an absent mode with a vacant seat", () => {
    expect(wouldUseVacantTreasurerFallback({ treasurerId: null })).toBe(true);
  });

  it("is true for explicit double mode with a vacant seat", () => {
    expect(
      wouldUseVacantTreasurerFallback({ transactionApprovalMode: "double", treasurerId: null })
    ).toBe(true);
  });

  it("is false once a Treasurer is seated", () => {
    expect(
      wouldUseVacantTreasurerFallback({
        transactionApprovalMode: "double",
        treasurerId: new ObjectId(),
      })
    ).toBe(false);
  });

  it("is false for a party that deliberately chose single mode", () => {
    expect(
      wouldUseVacantTreasurerFallback({ transactionApprovalMode: "single", treasurerId: null })
    ).toBe(false);
  });
});
