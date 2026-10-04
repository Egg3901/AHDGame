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
  it("loads defiance whips for every caucus in one query", async () => {
    const db = createMockDb();
    db.collection("caucuses");
    db.collection("caucusMemberships");
    db.collection("caucusChairElections");
    db.collection("characters");
    db.collection("billWhips");
    db.collectionMocks.caucuses!.find.mockReturnValue({
      toArray: async () =>
        ["a", "b", "c"].map((slug) => ({
          _id: new ObjectId(),
          slug,
          countryId: "US",
          partyId: "1",
          name: slug,
          disbandedAt: null,
        })),
    });

    const snapshot = await buildPartyCaucusHealthSnapshot(db as never, "US", "1");

    expect(snapshot.caucuses).toHaveLength(3);
    expect(db.collectionMocks.billWhips!.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.billWhips!.find.mock.calls[0][0].caucusId.$in).toHaveLength(3);
  });

  it("loads shared whip target and voter metadata once across caucuses", async () => {
    const db = createMockDb();
    const caucuses = ["a", "b", "c"].map((slug) => ({
      _id: new ObjectId(),
      slug,
      countryId: "US",
      partyId: "1",
      name: slug,
      disbandedAt: null,
    }));
    const voterIds = caucuses.map(() => new ObjectId());
    const billIds = caucuses.map(() => new ObjectId());
    db.collection("caucuses");
    db.collection("caucusMemberships");
    db.collection("caucusChairElections");
    db.collection("characters");
    db.collection("electedOfficials");
    db.collection("billWhips");
    db.collection("bills");
    db.collectionMocks.caucuses!.find.mockReturnValue({ toArray: async () => caucuses });
    db.collectionMocks.caucusMemberships!.find.mockReturnValue({
      toArray: async () =>
        caucuses.map((caucus, index) => ({
          _id: new ObjectId(),
          caucusId: caucus._id,
          memberType: "character",
          memberId: voterIds[index],
          status: "active",
        })),
    });
    db.collectionMocks.billWhips!.find.mockReturnValue({
      sort() {
        return this;
      },
      toArray: async () =>
        caucuses.map((caucus, index) => ({
          _id: new ObjectId(),
          targetType: "bill",
          targetId: billIds[index],
          chamber: "house",
          direction: "for",
          issuedBy: "caucus",
          countryId: "US",
          partyId: "1",
          caucusId: caucus._id,
          audience: "character",
          mode: "soft",
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
    });
    db.collectionMocks.bills!.find.mockReturnValue({
      toArray: async () =>
        billIds.map((billId, index) => ({
          _id: billId,
          title: `Bill ${index}`,
          status: "active",
          votes: { [voterIds[index]!.toString()]: "against" },
        })),
    });
    db.collectionMocks.characters!.find.mockReturnValue({
      project() {
        return this;
      },
      toArray: async () =>
        voterIds.map((_id, index) => ({
          _id: voterIds[index],
          name: `Voter ${index}`,
          party: "1",
        })),
    });
    db.collectionMocks.electedOfficials!.find.mockReturnValue({
      project() {
        return this;
      },
      toArray: async () =>
        voterIds.map((characterId) => ({ characterId, state: "CA", officeType: "house" })),
    });

    const snapshot = await buildPartyCaucusHealthSnapshot(db as never, "US", "1");

    expect(snapshot.activeDefianceCount).toBe(3);
    expect(snapshot.caucuses.map((caucus) => caucus.activeDefianceCount)).toEqual([1, 1, 1]);
    expect(snapshot.caucuses.map((caucus) => caucus.playerDefianceCount)).toEqual([1, 1, 1]);
    expect(db.collectionMocks.bills!.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.characters!.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.electedOfficials!.find).toHaveBeenCalledTimes(1);
    // The caucus membership roster loaded by the parent snapshot is enough to scope voters.
    expect(db.collectionMocks.caucusMemberships!.find).toHaveBeenCalledTimes(1);
  });

  it("keeps bill phase filtering scoped to each caucus whip", async () => {
    const db = createMockDb();
    const oldCaucusId = new ObjectId();
    const currentCaucusId = new ObjectId();
    const voterId = new ObjectId();
    const billId = new ObjectId();
    const phaseStart = new Date("2026-09-01T00:00:00.000Z");
    db.collection("caucuses");
    db.collection("caucusMemberships");
    db.collection("caucusChairElections");
    db.collection("characters");
    db.collection("electedOfficials");
    db.collection("billWhips");
    db.collection("bills");
    db.collectionMocks.caucuses!.find.mockReturnValue({
      toArray: async () => [
        {
          _id: oldCaucusId,
          slug: "old",
          countryId: "US",
          partyId: "1",
          name: "A Old Phase",
          disbandedAt: null,
        },
        {
          _id: currentCaucusId,
          slug: "current",
          countryId: "US",
          partyId: "1",
          name: "B Current Phase",
          disbandedAt: null,
        },
      ],
    });
    db.collectionMocks.caucusMemberships!.find.mockReturnValue({
      toArray: async () =>
        [oldCaucusId, currentCaucusId].map((caucusId) => ({
          _id: new ObjectId(),
          caucusId,
          memberType: "character",
          memberId: voterId,
          status: "active",
        })),
    });
    db.collectionMocks.billWhips!.find.mockReturnValue({
      sort() {
        return this;
      },
      toArray: async () => [
        ...[
          { caucusId: oldCaucusId, createdAt: new Date(phaseStart.getTime() - 1) },
          { caucusId: currentCaucusId, createdAt: new Date(phaseStart.getTime() + 1) },
        ].map(({ caucusId, createdAt }) => ({
          _id: new ObjectId(),
          targetType: "bill",
          targetId: billId,
          chamber: "house",
          direction: "for",
          issuedBy: "caucus",
          countryId: "US",
          partyId: "1",
          caucusId,
          audience: "character",
          mode: "soft",
          createdAt,
          updatedAt: createdAt,
        })),
      ],
    });
    db.collectionMocks.bills!.find.mockReturnValue({
      toArray: async () => [
        {
          _id: billId,
          title: "Veto Override",
          status: "veto_override",
          overrideVotingStartedAt: phaseStart,
          vetoOverrideVotes: { [voterId.toString()]: "against" },
        },
      ],
    });
    db.collectionMocks.characters!.find.mockReturnValue({
      project() {
        return this;
      },
      toArray: async () => [{ _id: voterId, name: "Voter", party: "1" }],
    });
    db.collectionMocks.electedOfficials!.find.mockReturnValue({
      project() {
        return this;
      },
      toArray: async () => [{ characterId: voterId, state: "CA", officeType: "house" }],
    });

    const snapshot = await buildPartyCaucusHealthSnapshot(db as never, "US", "1");

    expect(snapshot.caucuses.map((caucus) => caucus.activeDefianceCount)).toEqual([0, 1]);
    expect(db.collectionMocks.bills!.find).toHaveBeenCalledTimes(1);
  });

  it("retains NPP office metadata when legacy officials omit isNPP", async () => {
    const db = createMockDb();
    const caucusId = new ObjectId();
    const nppId = new ObjectId();
    const billId = new ObjectId();
    db.collection("caucuses");
    db.collection("caucusMemberships");
    db.collection("caucusChairElections");
    db.collection("npps");
    db.collection("electedOfficials");
    db.collection("billWhips");
    db.collection("bills");
    db.collectionMocks.caucuses!.find.mockReturnValue({
      toArray: async () => [
        {
          _id: caucusId,
          slug: "npp-caucus",
          countryId: "US",
          partyId: "1",
          name: "NPP Caucus",
          disbandedAt: null,
        },
      ],
    });
    db.collectionMocks.caucusMemberships!.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          caucusId,
          memberType: "npp",
          memberId: nppId,
          status: "active",
        },
      ],
    });
    db.collectionMocks.billWhips!.find.mockReturnValue({
      sort() {
        return this;
      },
      toArray: async () => [
        {
          _id: new ObjectId(),
          targetType: "bill",
          targetId: billId,
          chamber: "house",
          direction: "for",
          issuedBy: "caucus",
          countryId: "US",
          partyId: "1",
          caucusId,
          audience: "npp",
          mode: "soft",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });
    db.collectionMocks.bills!.find.mockReturnValue({
      toArray: async () => [
        {
          _id: billId,
          title: "Current Bill",
          status: "active",
          votes: { [`npp_${nppId.toString()}`]: "against" },
        },
      ],
    });
    db.collectionMocks.npps!.find.mockReturnValue({
      project() {
        return this;
      },
      toArray: async () => [{ _id: nppId, name: "NPP Voter", party: "1" }],
    });
    db.collectionMocks.electedOfficials!.find.mockReturnValue({
      project() {
        return this;
      },
      toArray: async () => [{ nppId, state: "CA", officeType: "house" }],
    });

    const snapshot = await buildPartyCaucusHealthSnapshot(db as never, "US", "1");

    expect(snapshot.caucuses[0]).toMatchObject({
      activeDefianceCount: 1,
      nppDefianceCount: 1,
    });
    expect(db.collectionMocks.electedOfficials!.find.mock.calls[0][0].$or).toContainEqual({
      nppId: { $in: [nppId] },
    });
  });

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
