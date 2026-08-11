import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import type {
  Caucus,
  CaucusChairCandidate,
  CaucusChairElection,
  CaucusMembership,
  Character,
  NPP,
  NPPRelationship,
} from "@/lib/db/types";
import { buildPartyCaucusHealthSnapshot } from "./caucusHealth";

describe("buildPartyCaucusHealthSnapshot", () => {
  it("summarizes caucus churn, election status, and at-risk NPP retention", async () => {
    const db = createMockDb();
    const caucusId = new ObjectId();
    const chairId = new ObjectId();
    const playerJoinId = new ObjectId();
    const playerLeaveId = new ObjectId();
    const playerRemovedId = new ObjectId();
    const nppId = new ObjectId();
    const electionId = new ObjectId();
    const candidateId = new ObjectId();
    const now = Date.now();

    db.collection("caucuses");
    db.collection("caucusMemberships");
    db.collection("characters");
    db.collection("npps");
    db.collection("nppRelationships");
    db.collection("caucusChairElections");
    db.collection("caucusChairCandidates");
    db.collection("caucusChairVotes");

    db.collectionMocks.caucuses.find.mockReturnValue({
      toArray: async () => [
        {
          _id: caucusId,
          slug: "test-caucus",
          previousSlugs: [],
          countryId: "US",
          partyId: "1",
          name: "Test Caucus",
          description: "",
          color: "#3366ff",
          chairId,
          viceChairId: null,
          whipMode: "soft",
          treasury: 0,
          taxRate: 0,
          lastElectedTurn: null,
          nextElectionTurn: 120,
          termsServed: 0,
          disbandedAt: null,
          createdBy: chairId,
          createdAt: new Date(now - 48 * 60 * 60 * 1000),
          updatedAt: new Date(now - 60 * 60 * 1000),
        } satisfies Caucus,
      ],
      sort() {
        return this;
      },
    });

    db.collectionMocks.caucusMemberships.find.mockReturnValue({
      toArray: async () =>
        [
          {
            _id: new ObjectId(),
            caucusId,
            countryId: "US",
            partyId: "1",
            memberType: "character",
            memberId: chairId,
            role: "chair",
            status: "active",
            invitedAt: null,
            joinedAt: new Date(now - 48 * 60 * 60 * 1000),
            leftAt: null,
            complianceScore: -1,
            createdAt: new Date(now - 48 * 60 * 60 * 1000),
            updatedAt: new Date(now - 48 * 60 * 60 * 1000),
          },
          {
            _id: new ObjectId(),
            caucusId,
            countryId: "US",
            partyId: "1",
            memberType: "character",
            memberId: playerJoinId,
            role: "member",
            status: "active",
            invitedAt: null,
            joinedAt: new Date(now - 2 * 60 * 60 * 1000),
            leftAt: null,
            complianceScore: -1,
            createdAt: new Date(now - 2 * 60 * 60 * 1000),
            updatedAt: new Date(now - 2 * 60 * 60 * 1000),
          },
          {
            _id: new ObjectId(),
            caucusId,
            countryId: "US",
            partyId: "1",
            memberType: "character",
            memberId: playerLeaveId,
            role: "member",
            status: "left",
            invitedAt: null,
            joinedAt: new Date(now - 24 * 60 * 60 * 1000),
            leftAt: new Date(now - 3 * 60 * 60 * 1000),
            complianceScore: -1,
            createdAt: new Date(now - 24 * 60 * 60 * 1000),
            updatedAt: new Date(now - 3 * 60 * 60 * 1000),
          },
          {
            _id: new ObjectId(),
            caucusId,
            countryId: "US",
            partyId: "1",
            memberType: "character",
            memberId: playerRemovedId,
            role: "member",
            status: "removed",
            invitedAt: null,
            joinedAt: new Date(now - 24 * 60 * 60 * 1000),
            leftAt: new Date(now - 4 * 60 * 60 * 1000),
            complianceScore: -1,
            createdAt: new Date(now - 24 * 60 * 60 * 1000),
            updatedAt: new Date(now - 4 * 60 * 60 * 1000),
          },
          {
            _id: new ObjectId(),
            caucusId,
            countryId: "US",
            partyId: "1",
            memberType: "npp",
            memberId: nppId,
            role: "member",
            status: "active",
            invitedAt: null,
            joinedAt: new Date(now - 36 * 60 * 60 * 1000),
            leftAt: null,
            complianceScore: -1,
            createdAt: new Date(now - 36 * 60 * 60 * 1000),
            updatedAt: new Date(now - 36 * 60 * 60 * 1000),
          },
        ] satisfies CaucusMembership[],
    });

    db.collectionMocks.characters.find.mockReturnValue({
      project() {
        return this;
      },
      toArray: async () =>
        [
          { _id: chairId, name: "Chair Person" },
          { _id: playerJoinId, name: "Fresh Join" },
          { _id: playerLeaveId, name: "Voluntary Exit" },
          { _id: playerRemovedId, name: "Forced Removal" },
        ] as Character[],
    });

    db.collectionMocks.npps.find.mockReturnValue({
      project() {
        return this;
      },
      toArray: async () => [{ _id: nppId, name: "Lena NPP" }] as NPP[],
    });

    db.collectionMocks.nppRelationships.find.mockReturnValue({
      toArray: async () =>
        [
          {
            _id: `${chairId.toString()}_${nppId.toString()}`,
            characterId: chairId,
            nppId,
            relationshipScore: 23.4,
            totalAttempts: 0,
            successfulAttempts: 0,
            lastAttemptTurn: 0,
            createdAt: new Date(now - 48 * 60 * 60 * 1000),
            updatedAt: new Date(now - 60 * 60 * 1000),
          },
        ] satisfies NPPRelationship[],
    });

    db.collectionMocks.caucusChairElections.find.mockReturnValue({
      toArray: async () => [
        {
          _id: electionId,
          caucusId,
          partyId: "1",
          countryId: "US",
          status: "voting",
          startTime: new Date(now - 60 * 60 * 1000),
          endTime: new Date(now + 2 * 60 * 60 * 1000),
          startTurn: 12,
          endTurn: 18,
          durationTurns: 6,
          winnerId: null,
          createdAt: new Date(now - 60 * 60 * 1000),
          updatedAt: new Date(now - 60 * 60 * 1000),
        } satisfies CaucusChairElection,
      ],
      sort() {
        return this;
      },
    });

    db.collectionMocks.caucusChairCandidates.find.mockReturnValue({
      toArray: async () =>
        [
          {
            _id: candidateId,
            electionId,
            caucusId,
            characterId: chairId,
            characterName: "Chair Person",
            status: "active",
            enteredAt: new Date(now - 50 * 60 * 1000),
            withdrawnAt: null,
          },
        ] satisfies CaucusChairCandidate[],
    });

    db.collectionMocks.caucusChairVotes.aggregate.mockReturnValue({
      toArray: async () => [{ electionId, totalVotes: 2 }],
    });

    const snapshot = await buildPartyCaucusHealthSnapshot(db as any, "US", "1");

    expect(snapshot.fragileCount).toBe(1);
    expect(snapshot.activeElectionCount).toBe(1);
    expect(snapshot.recentJoinCount).toBe(1);
    expect(snapshot.recentLeaveCount).toBe(1);
    expect(snapshot.recentForcedExitCount).toBe(1);
    expect(snapshot.atRiskMemberCount).toBe(1);

    expect(snapshot.caucuses).toHaveLength(1);
    expect(snapshot.caucuses[0]).toMatchObject({
      caucusName: "Test Caucus",
      statusLabel: "Fragile",
      recentJoinCount: 1,
      recentLeaveCount: 1,
      recentForcedExitCount: 1,
      atRiskCount: 1,
      memberCounts: { players: 2, npps: 1, total: 3 },
      election: {
        status: "active",
        candidateCount: 1,
        totalVotes: 2,
      },
    });
    expect(snapshot.caucuses[0].recentChurn.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(["join", "leave", "forced_exit"])
    );
    expect(snapshot.caucuses[0].atRiskMembers[0]?.nppName).toBe("Lena NPP");
  });
});
