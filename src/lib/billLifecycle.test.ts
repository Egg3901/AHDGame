/**
 * Unit tests for processBillLifecycle — the main bill state machine processor.
 * Tests each lifecycle phase: proposed→active, origin vote close, other chamber,
 * presidential deadline (pocket-sign), and veto override resolution.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn(),
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/legislationEffects", () => ({
  applyLegislationEffect: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/billEnactment", () => ({ onBillEnacted: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/achievements", () => ({
  awardAchievement: vi.fn(),
  resolveUserIdFromCharacter: vi.fn().mockResolvedValue(new ObjectId()),
}));

const NOW = new Date("2025-06-15T12:00:00Z");

function makeBill(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    title: "Test Bill",
    originChamber: "house",
    currentChamber: "house",
    status: "active",
    votesFor: 0,
    votesAgainst: 0,
    sponsorId: new ObjectId(),
    coSponsors: [],
    ...overrides,
  };
}

describe("processBillLifecycle", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    // Pre-initialize collections so collectionMocks entries exist
    db.collection("bills");
    db.collection("electedOfficials");
    db.collection("characters");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 10 } as never);
  });

  describe("Phase A: Activate proposed bills", () => {
    it("transitions proposed bills to active with voting window", async () => {
      const bill = makeBill({ status: "proposed" });

      // First find returns proposed bills, subsequent finds return []
      let callCount = 0;
      db.collectionMocks["bills"]!.find.mockImplementation(() => {
        callCount++;
        const docs = callCount === 1 ? [bill] : [];
        return {
          toArray: vi.fn().mockResolvedValue(docs),
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          project: vi.fn().mockReturnThis(),
        };
      });

      const { processBillLifecycle } = await import("./billLifecycle");
      await processBillLifecycle(NOW);

      expect(db.collectionMocks["bills"]!.updateOne).toHaveBeenCalled();
      const updateCall = db.collectionMocks["bills"]!.updateOne.mock.calls[0];
      expect(updateCall[0]).toEqual({ _id: bill._id });
      expect(updateCall[1].$set.status).toBe("active");
      expect(updateCall[1].$set.currentChamber).toBe("house");
      expect(updateCall[1].$set.votingEndsAt).toBeInstanceOf(Date);
    });
  });

  describe("Phase D: Close expired origin-chamber votes", () => {
    it("marks bill as failed when votes against >= votes for", async () => {
      const bill = makeBill({
        status: "active",
        votingEndsAt: new Date(NOW.getTime() - 1000),
        votesFor: 3,
        votesAgainst: 5,
      });

      // proposed find returns [], active expired find returns [bill], rest []
      let callCount = 0;
      db.collectionMocks["bills"]!.find.mockImplementation(() => {
        callCount++;
        const docs = callCount === 2 ? [bill] : [];
        return {
          toArray: vi.fn().mockResolvedValue(docs),
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          project: vi.fn().mockReturnThis(),
        };
      });
      // Re-fetch returns same bill
      db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);
      // Characters for notification
      db.collectionMocks["characters"]!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });

      const { processBillLifecycle } = await import("./billLifecycle");
      await processBillLifecycle(NOW);

      const updateCall = db.collectionMocks["bills"]!.updateOne.mock.calls[0];
      expect(updateCall[1].$set.status).toBe("failed");
      expect(updateCall[1].$set.failedAt).toEqual(NOW);
    });

    it("advances passed bill to other chamber for non-joint bills", async () => {
      const bill = makeBill({
        status: "active",
        originChamber: "house",
        votingEndsAt: new Date(NOW.getTime() - 1000),
        votesFor: 10,
        votesAgainst: 3,
      });

      let callCount = 0;
      db.collectionMocks["bills"]!.find.mockImplementation(() => {
        callCount++;
        const docs = callCount === 2 ? [bill] : [];
        return {
          toArray: vi.fn().mockResolvedValue(docs),
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          project: vi.fn().mockReturnThis(),
        };
      });
      db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);
      db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });
      db.collectionMocks["characters"]!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });

      const { processBillLifecycle } = await import("./billLifecycle");
      await processBillLifecycle(NOW);

      const updateCall = db.collectionMocks["bills"]!.updateOne.mock.calls[0];
      expect(updateCall[1].$set.status).toBe("active_other");
      expect(updateCall[1].$set.currentChamber).toBe("senate");
      expect(updateCall[1].$set.otherChamberVotesFor).toBe(0);
      expect(updateCall[1].$set.otherChamberVotesAgainst).toBe(0);
    });

    it("freezes voteSnapshot when the origin chamber vote resolves (#0982)", async () => {
      const charFor = new ObjectId();
      const charAgainst = new ObjectId();
      const bill = makeBill({
        status: "active",
        originChamber: "house",
        currentChamber: "house",
        countryId: "US",
        votingEndsAt: new Date(NOW.getTime() - 1000),
        votesFor: 10,
        votesAgainst: 3,
        votesAbstain: 0,
        votes: { [charFor.toString()]: "for", [charAgainst.toString()]: "against" },
      });

      let callCount = 0;
      db.collectionMocks["bills"]!.find.mockImplementation(() => {
        callCount++;
        const docs = callCount === 2 ? [bill] : [];
        return {
          toArray: vi.fn().mockResolvedValue(docs),
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          project: vi.fn().mockReturnThis(),
        };
      });
      db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);
      // Current House seat holders who cast the two votes (scoping finds survivors).
      db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            characterId: charFor,
            countryId: "US",
            nppId: null,
            officeType: "house",
            seatsHeld: 10,
          },
          {
            characterId: charAgainst,
            countryId: "US",
            nppId: null,
            officeType: "house",
            seatsHeld: 3,
          },
        ]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });
      db.collectionMocks["characters"]!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });

      const { processBillLifecycle } = await import("./billLifecycle");
      await processBillLifecycle(NOW);

      const updateCall = db.collectionMocks["bills"]!.updateOne.mock.calls[0];
      const snap = updateCall[1].$set.voteSnapshot;
      expect(snap).toBeDefined();
      expect(snap.totals).toEqual({ for: 10, against: 3, abstain: 0 });
      // Headline stored field and snapshot agree.
      expect(snap.totals.for).toBe(updateCall[1].$set.votesFor);
      expect(snap.weights[charFor.toString()]).toBe(10);
    });

    it("sends joint bill directly to president (skips second chamber)", async () => {
      const bill = makeBill({
        status: "active",
        originChamber: "joint",
        votingEndsAt: new Date(NOW.getTime() - 1000),
        votesFor: 10,
        votesAgainst: 3,
      });

      let callCount = 0;
      db.collectionMocks["bills"]!.find.mockImplementation(() => {
        callCount++;
        const docs = callCount === 2 ? [bill] : [];
        return {
          toArray: vi.fn().mockResolvedValue(docs),
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          project: vi.fn().mockReturnThis(),
        };
      });
      db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);
      db.collectionMocks["characters"]!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });

      const { processBillLifecycle } = await import("./billLifecycle");
      await processBillLifecycle(NOW);

      const updateCall = db.collectionMocks["bills"]!.updateOne.mock.calls[0];
      expect(updateCall[1].$set.status).toBe("enrolled");
      expect(updateCall[1].$set.sentToPresidentAt).toEqual(NOW);
      expect(updateCall[1].$set.presidentActionDeadline).toBeInstanceOf(Date);

      const { createNotifications } = await import("@/lib/notifications");
      const batched0 = vi.mocked(createNotifications).mock.calls.flatMap((c) => c[0]);
      expect(batched0.filter((n) => n.title === "Bill Awaiting Your Signature").length).toBe(0);
    });

    it("notifies the US president when a bill is enrolled (player president)", async () => {
      const prezUserId = new ObjectId();
      const prezCharId = new ObjectId();
      const bill = makeBill({
        status: "active",
        originChamber: "joint",
        votingEndsAt: new Date(NOW.getTime() - 1000),
        votesFor: 10,
        votesAgainst: 3,
      });

      let callCount = 0;
      db.collectionMocks["bills"]!.find.mockImplementation(() => {
        callCount++;
        const docs = callCount === 2 ? [bill] : [];
        return {
          toArray: vi.fn().mockResolvedValue(docs),
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          project: vi.fn().mockReturnThis(),
        };
      });
      db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);
      db.collectionMocks["characters"]!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });
      db.collectionMocks["electedOfficials"]!.findOne.mockImplementation((filter) => {
        const f = filter as Record<string, unknown>;
        if (f?.officeType === "president") {
          return Promise.resolve({
            characterId: prezCharId,
            officeType: "president",
            isNPP: false,
          });
        }
        return Promise.resolve(null);
      });
      db.collectionMocks["characters"]!.findOne.mockImplementation((filter) => {
        const id = (filter as { _id?: ObjectId })?._id;
        if (id?.equals(prezCharId)) {
          return Promise.resolve({ userId: prezUserId });
        }
        return Promise.resolve(null);
      });

      const { processBillLifecycle } = await import("./billLifecycle");
      await processBillLifecycle(NOW);

      const { createNotifications } = await import("@/lib/notifications");
      expect(createNotifications).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            userId: prezUserId,
            type: "bill_enrolled",
            title: "Bill Awaiting Your Signature",
            message: expect.stringContaining("Test Bill") as unknown,
            metadata: expect.objectContaining({ billId: bill._id.toString() }) as unknown,
          }),
        ])
      );
    });
  });

  describe("Phase E: Close expired other-chamber votes", () => {
    it("enrolls bill when other chamber passes it", async () => {
      const bill = makeBill({
        status: "active_other",
        originChamber: "house",
        currentChamber: "senate",
        otherChamberVotingEndsAt: new Date(NOW.getTime() - 1000),
        otherChamberVotesFor: 8,
        otherChamberVotesAgainst: 2,
      });

      let callCount = 0;
      db.collectionMocks["bills"]!.find.mockImplementation(() => {
        callCount++;
        // Phase A (proposed)=1, Phase D (active expired)=2, Phase E (active_other expired)=3
        const docs = callCount === 3 ? [bill] : [];
        return {
          toArray: vi.fn().mockResolvedValue(docs),
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          project: vi.fn().mockReturnThis(),
        };
      });
      db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);
      db.collectionMocks["characters"]!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });

      const { processBillLifecycle } = await import("./billLifecycle");
      await processBillLifecycle(NOW);

      const updateCall = db.collectionMocks["bills"]!.updateOne.mock.calls[0];
      expect(updateCall[1].$set.status).toBe("enrolled");
      expect(updateCall[1].$set.presidentActionDeadline).toBeInstanceOf(Date);
    });

    it("directly enacts legislative-only withdrawal bills after second-chamber passage", async () => {
      const bill = makeBill({
        status: "active_other",
        countryId: "US",
        originChamber: "house",
        currentChamber: "senate",
        otherChamberVotingEndsAt: new Date(NOW.getTime() - 1000),
        otherChamberVotesFor: 8,
        otherChamberVotesAgainst: 2,
        internationalAction: {
          type: "leave_organization",
          targetCountryId: "US",
          organizationId: "UNAS",
          organizationName: "Union of North Atlantic States",
        },
      });

      let callCount = 0;
      db.collectionMocks["bills"]!.find.mockImplementation(() => {
        callCount++;
        const docs = callCount === 3 ? [bill] : [];
        return {
          toArray: vi.fn().mockResolvedValue(docs),
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          project: vi.fn().mockReturnThis(),
        };
      });
      db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);
      db.collectionMocks["characters"]!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });

      const { processBillLifecycle } = await import("./billLifecycle");
      await processBillLifecycle(NOW);

      const updateCall = db.collectionMocks["bills"]!.updateOne.mock.calls[0];
      expect(updateCall[1].$set.status).toBe("signed");
      expect(updateCall[1].$set.enactedAt).toEqual(NOW);

      const { applyLegislationEffect } = await import("@/lib/legislationEffects");
      const { onBillEnacted } = await import("@/lib/billEnactment");
      const { createNotifications } = await import("@/lib/notifications");
      const { awardAchievement } = await import("@/lib/achievements");

      expect(applyLegislationEffect).toHaveBeenCalledWith(expect.anything(), bill);
      expect(onBillEnacted).toHaveBeenCalledWith(expect.anything(), bill, 10);
      expect(awardAchievement).toHaveBeenCalledWith(
        expect.any(ObjectId),
        "lawmaker",
        bill.sponsorId
      );
      const batchedCalls = vi.mocked(createNotifications).mock.calls.flatMap((c) => c[0]);
      expect(batchedCalls).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "bill_enrolled" })])
      );
    });

    it("fails bill when other chamber rejects it", async () => {
      const bill = makeBill({
        status: "active_other",
        originChamber: "senate",
        currentChamber: "house",
        otherChamberVotingEndsAt: new Date(NOW.getTime() - 1000),
        otherChamberVotesFor: 2,
        otherChamberVotesAgainst: 8,
      });

      let callCount = 0;
      db.collectionMocks["bills"]!.find.mockImplementation(() => {
        callCount++;
        const docs = callCount === 3 ? [bill] : [];
        return {
          toArray: vi.fn().mockResolvedValue(docs),
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          project: vi.fn().mockReturnThis(),
        };
      });
      db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);
      db.collectionMocks["characters"]!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });

      const { processBillLifecycle } = await import("./billLifecycle");
      await processBillLifecycle(NOW);

      const updateCall = db.collectionMocks["bills"]!.updateOne.mock.calls[0];
      expect(updateCall[1].$set.status).toBe("failed");
    });

    it("evaluates second-chamber passage from scoped chamber votes when stored counters include foreign voters", async () => {
      const usNppId = new ObjectId();
      const brNppId = new ObjectId();
      const bill = makeBill({
        status: "active_other",
        countryId: "US",
        originChamber: "house",
        currentChamber: "senate",
        otherChamberVotingEndsAt: new Date(NOW.getTime() - 1000),
        otherChamberVotes: {
          [`npp_${usNppId.toString()}`]: "against",
          [`npp_${brNppId.toString()}`]: "for",
        },
        otherChamberVotesFor: 3,
        otherChamberVotesAgainst: 1,
        otherChamberVotesAbstain: 0,
      });

      let callCount = 0;
      db.collectionMocks["bills"]!.find.mockImplementation(() => {
        callCount++;
        const docs = callCount === 3 ? [bill] : [];
        return {
          toArray: vi.fn().mockResolvedValue(docs),
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          project: vi.fn().mockReturnThis(),
        };
      });
      db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            countryId: "US",
            officeType: "senate",
            characterId: null,
            nppId: usNppId,
            seatsHeld: 1,
          },
          {
            countryId: "BR",
            officeType: "senate",
            characterId: null,
            nppId: brNppId,
            seatsHeld: 3,
          },
        ]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });
      db.collectionMocks["characters"]!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });

      const { processBillLifecycle } = await import("./billLifecycle");
      await processBillLifecycle(NOW);

      const updateCall = db.collectionMocks["bills"]!.updateOne.mock.calls[0];
      expect(updateCall[1].$set.status).toBe("failed");
      expect(updateCall[1].$set.otherChamberVotesFor).toBe(0);
      expect(updateCall[1].$set.otherChamberVotesAgainst).toBe(1);
      expect(updateCall[1].$set.otherChamberVotesAbstain).toBe(0);
    });
  });

  describe("Phase F: Presidential action deadline (pocket-sign)", () => {
    it("auto-signs enrolled bills past presidential deadline", async () => {
      const bill = makeBill({
        status: "enrolled",
        presidentActionDeadline: new Date(NOW.getTime() - 1000),
        sponsorId: new ObjectId(),
      });

      let callCount = 0;
      db.collectionMocks["bills"]!.find.mockImplementation(() => {
        callCount++;
        // Phase F (enrolled expired) = call 4
        const docs = callCount === 4 ? [bill] : [];
        return {
          toArray: vi.fn().mockResolvedValue(docs),
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          project: vi.fn().mockReturnThis(),
        };
      });
      db.collectionMocks["characters"]!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });

      const { processBillLifecycle } = await import("./billLifecycle");
      await processBillLifecycle(NOW);

      // Pocket-sign now uses a per-bill atomic claim (guarded updateOne) rather
      // than a bulkWrite, so overlapping turn runners cannot double-enact.
      const signCall = db.collectionMocks["bills"]!.updateOne.mock.calls.find(
        (call) =>
          (call[1] as { $set?: { presidentAction?: string } })?.$set?.presidentAction ===
          "unsigned_law"
      );
      expect(signCall).toBeDefined();
      expect((signCall![0] as { status?: string }).status).toBe("enrolled");
      expect((signCall![1] as { $set: { status: string } }).$set.status).toBe("signed");

      // Legislation effect and enactment hook should be called
      const { applyLegislationEffect } = await import("@/lib/legislationEffects");
      expect(applyLegislationEffect).toHaveBeenCalledWith(expect.anything(), bill);
      const { onBillEnacted } = await import("@/lib/billEnactment");
      expect(onBillEnacted).toHaveBeenCalledWith(expect.anything(), bill, 10);
    });
  });

  describe("Phase G: Veto override resolution", () => {
    // Regression for Bug #0952: the House override threshold was computed from the
    // *document count* of house officials (countDocuments) while the "for" tally was
    // seat-weighted. Because NPP/aggregated officials hold many seats per document,
    // the threshold collapsed far below 2/3 of the real chamber and bills were enacted
    // with well under a supermajority. Both sides must be weighted by seatsHeld.
    it("fails override when seat-weighted 'for' is below 2/3 of total seats despite exceeding 2/3 of the official document count", async () => {
      // House: 3 official documents holding 10+8+12 = 30 seats. Two "for" docs = 18 seats.
      // 18/30 = 60% < 2/3 (need 20). But 2/3 of the 3-document count is only 2, which 18
      // trivially clears — that is the bug.
      const houseForA = new ObjectId();
      const houseForB = new ObjectId();
      const houseAgainstC = new ObjectId();
      // Senate passes cleanly so the failure is isolated to the House.
      const senateFor = new ObjectId();
      const officials = [
        { nppId: houseForA, characterId: null, officeType: "house", seatsHeld: 10 },
        { nppId: houseForB, characterId: null, officeType: "house", seatsHeld: 8 },
        { nppId: houseAgainstC, characterId: null, officeType: "house", seatsHeld: 12 },
        { nppId: senateFor, characterId: null, officeType: "senate", seatsHeld: 3 },
      ];

      const bill = makeBill({
        countryId: "US",
        status: "veto_override",
        overrideVotingEndsAt: new Date(NOW.getTime() - 1000),
        vetoOverrideVotes: {
          [`npp_${houseForA.toString()}`]: "for",
          [`npp_${houseForB.toString()}`]: "for",
          [`npp_${houseAgainstC.toString()}`]: "against",
          [`npp_${senateFor.toString()}`]: "for",
        },
        sponsorId: new ObjectId(),
      });

      let callCount = 0;
      db.collectionMocks["bills"]!.find.mockImplementation(() => {
        callCount++;
        const docs = callCount === 5 ? [bill] : [];
        return {
          toArray: vi.fn().mockResolvedValue(docs),
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          project: vi.fn().mockReturnThis(),
        };
      });
      db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);

      db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue(officials),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });

      const { processBillLifecycle } = await import("./billLifecycle");
      await processBillLifecycle(NOW);

      const updateCall = db.collectionMocks["bills"]!.updateOne.mock.calls[0];
      expect(updateCall[1].$set.status).toBe("override_failed");
    });

    it("freezes overrideDisplaySnapshot when a veto override resolves (#0982)", async () => {
      const houseForA = new ObjectId();
      const houseForB = new ObjectId();
      const houseAgainstC = new ObjectId();
      const senateForId = new ObjectId();
      const officials = [
        { nppId: houseForA, characterId: null, officeType: "house", seatsHeld: 10 },
        { nppId: houseForB, characterId: null, officeType: "house", seatsHeld: 8 },
        { nppId: houseAgainstC, characterId: null, officeType: "house", seatsHeld: 12 },
        { nppId: senateForId, characterId: null, officeType: "senate", seatsHeld: 3 },
      ];
      const bill = makeBill({
        countryId: "US",
        status: "veto_override",
        overrideVotingEndsAt: new Date(NOW.getTime() - 1000),
        vetoOverrideVotes: {
          [`npp_${houseForA.toString()}`]: "for",
          [`npp_${houseForB.toString()}`]: "for",
          [`npp_${houseAgainstC.toString()}`]: "against",
          [`npp_${senateForId.toString()}`]: "for",
        },
        sponsorId: new ObjectId(),
      });

      let callCount = 0;
      db.collectionMocks["bills"]!.find.mockImplementation(() => {
        callCount++;
        const docs = callCount === 5 ? [bill] : [];
        return {
          toArray: vi.fn().mockResolvedValue(docs),
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          project: vi.fn().mockReturnThis(),
        };
      });
      db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);
      db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue(officials),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });

      const { processBillLifecycle } = await import("./billLifecycle");
      await processBillLifecycle(NOW);

      const updateCall = db.collectionMocks["bills"]!.updateOne.mock.calls[0];
      const snap = updateCall[1].$set.overrideDisplaySnapshot;
      expect(snap).toBeDefined();
      // Seat-weighted per-chamber result frozen at resolution.
      expect(snap.house).toEqual({ for: 18, against: 12, seats: 30 });
      expect(snap.senate).toEqual({ for: 3, against: 0, seats: 3 });
    });

    // A single non-NPP/player official can hold a multi-seat delegation. Its "for"
    // vote must contribute its full seat weight to the override tally (previously
    // player votes were hard-counted as 1, under-counting multi-seat holders).
    it("weights a multi-seat official's override vote by seatsHeld", async () => {
      // House: 30 seats total (threshold 20). A single player holds 20 of them and
      // votes "for"; the rest are held "against". 20 ≥ 20 → the House clears only if
      // the player's 20 seats are counted, not a flat 1.
      const bigHolder = new ObjectId();
      const officials = [
        { characterId: bigHolder, nppId: null, officeType: "house", seatsHeld: 20 },
        { characterId: null, nppId: new ObjectId(), officeType: "house", seatsHeld: 10 },
        // Senate clears trivially.
        { characterId: null, nppId: new ObjectId(), officeType: "senate", seatsHeld: 3 },
      ];
      const senateForId = officials[2]!.nppId!;
      const bill = makeBill({
        countryId: "US",
        status: "veto_override",
        overrideVotingEndsAt: new Date(NOW.getTime() - 1000),
        vetoOverrideVotes: {
          [bigHolder.toString()]: "for",
          [`npp_${senateForId.toString()}`]: "for",
        },
        sponsorId: new ObjectId(),
      });

      let callCount = 0;
      db.collectionMocks["bills"]!.find.mockImplementation(() => {
        callCount++;
        const docs = callCount === 5 ? [bill] : [];
        return {
          toArray: vi.fn().mockResolvedValue(docs),
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          project: vi.fn().mockReturnThis(),
        };
      });
      db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);
      db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue(officials),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });

      const { processBillLifecycle } = await import("./billLifecycle");
      await processBillLifecycle(NOW);

      const updateCall = db.collectionMocks["bills"]!.updateOne.mock.calls[0];
      expect(updateCall[1].$set.status).toBe("signed");
    });

    it("enacts bill when override meets 2/3 threshold in both chambers", async () => {
      // House: 3 seats, all "for" (3/3 ≥ ceil(2/3·3)=2). Senate: 3 seats, all "for".
      const h1 = new ObjectId();
      const h2 = new ObjectId();
      const h3 = new ObjectId();
      const s1 = new ObjectId();
      const s2 = new ObjectId();
      const s3 = new ObjectId();
      const officials = [
        { characterId: h1, nppId: null, officeType: "house", seatsHeld: 1 },
        { characterId: h2, nppId: null, officeType: "house", seatsHeld: 1 },
        { characterId: h3, nppId: null, officeType: "house", seatsHeld: 1 },
        { characterId: s1, nppId: null, officeType: "senate", seatsHeld: 1 },
        { characterId: s2, nppId: null, officeType: "senate", seatsHeld: 1 },
        { characterId: s3, nppId: null, officeType: "senate", seatsHeld: 1 },
      ];
      const bill = makeBill({
        countryId: "US",
        status: "veto_override",
        overrideVotingEndsAt: new Date(NOW.getTime() - 1000),
        vetoOverrideVotes: Object.fromEntries(
          [h1, h2, h3, s1, s2, s3].map((id) => [id.toString(), "for"])
        ),
        sponsorId: new ObjectId(),
      });

      let callCount = 0;
      db.collectionMocks["bills"]!.find.mockImplementation(() => {
        callCount++;
        // Phase G (veto_override expired) = call 5
        const docs = callCount === 5 ? [bill] : [];
        return {
          toArray: vi.fn().mockResolvedValue(docs),
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          project: vi.fn().mockReturnThis(),
        };
      });
      db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);

      db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue(officials),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });
      db.collectionMocks["characters"]!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });

      const { processBillLifecycle } = await import("./billLifecycle");
      await processBillLifecycle(NOW);

      const updateCall = db.collectionMocks["bills"]!.updateOne.mock.calls[0];
      expect(updateCall[1].$set.status).toBe("signed");
      expect(updateCall[1].$set.presidentAction).toBe("override");
    });

    it("fails override when threshold not met", async () => {
      const bill = makeBill({
        countryId: "US",
        status: "veto_override",
        overrideVotingEndsAt: new Date(NOW.getTime() - 1000),
        vetoOverrideVotes: {},
      });

      let callCount = 0;
      db.collectionMocks["bills"]!.find.mockImplementation(() => {
        callCount++;
        const docs = callCount === 5 ? [bill] : [];
        return {
          toArray: vi.fn().mockResolvedValue(docs),
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          project: vi.fn().mockReturnThis(),
        };
      });
      db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);

      // 10 house seats, 5 senate seats (thresholds 7 and 4) but zero "for" votes.
      db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { characterId: null, nppId: new ObjectId(), officeType: "house", seatsHeld: 10 },
          { characterId: null, nppId: new ObjectId(), officeType: "senate", seatsHeld: 5 },
        ]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });

      const { processBillLifecycle } = await import("./billLifecycle");
      await processBillLifecycle(NOW);

      const updateCall = db.collectionMocks["bills"]!.updateOne.mock.calls[0];
      expect(updateCall[1].$set.status).toBe("override_failed");
    });

    it("scopes the 2/3 chamber thresholds to the bill's country, ignoring other countries' seats", async () => {
      const houseVoters = Array.from({ length: 7 }, () => new ObjectId());
      const senateVoters = Array.from({ length: 4 }, () => new ObjectId());
      const bill = makeBill({
        countryId: "US",
        status: "veto_override",
        overrideVotingEndsAt: new Date(NOW.getTime() - 1000),
        vetoOverrideVotes: Object.fromEntries(
          [...houseVoters, ...senateVoters].map((id) => [id.toString(), "for"])
        ),
        sponsorId: new ObjectId(),
      });

      let callCount = 0;
      db.collectionMocks["bills"]!.find.mockImplementation(() => {
        callCount++;
        const docs = callCount === 5 ? [bill] : [];
        return {
          toArray: vi.fn().mockResolvedValue(docs),
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          project: vi.fn().mockReturnThis(),
        };
      });
      db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);

      // US: 7 house seats / 4 senate seats (thresholds 5 and 3). The officials query
      // is scoped by countryId, so other countries' seats never enter the tally.
      db.collectionMocks["electedOfficials"]!.find.mockImplementation(
        (filter: Record<string, unknown>) => ({
          toArray: vi.fn().mockResolvedValue(
            filter?.countryId !== "US"
              ? []
              : [
                  ...houseVoters.map((id) => ({
                    characterId: id,
                    nppId: null,
                    officeType: "house",
                    seatsHeld: 1,
                  })),
                  ...senateVoters.map((id) => ({
                    characterId: id,
                    nppId: null,
                    officeType: "senate",
                    seatsHeld: 1,
                  })),
                ]
          ),
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          skip: vi.fn().mockReturnThis(),
          project: vi.fn().mockReturnThis(),
        })
      );
      db.collectionMocks["characters"]!.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });

      const { processBillLifecycle } = await import("./billLifecycle");
      await processBillLifecycle(NOW);

      const updateCall = db.collectionMocks["bills"]!.updateOne.mock.calls[0];
      expect(updateCall[1].$set.status).toBe("signed");
      expect(updateCall[1].$set.presidentAction).toBe("override");
      // The chamber seat totals must be scoped to the bill's country.
      expect(db.collectionMocks["electedOfficials"]!.find).toHaveBeenCalledWith(
        expect.objectContaining({
          officeType: { $in: ["house", "senate"] },
          countryId: "US",
        })
      );
    });
  });

  describe("No-op when nothing to process", () => {
    it("does nothing when no bills match any phase", async () => {
      // All finds return empty (default from createMockDb)
      const { processBillLifecycle } = await import("./billLifecycle");
      await processBillLifecycle(NOW);

      expect(db.collectionMocks["bills"]!.updateOne).not.toHaveBeenCalled();
      // bulkWrite is also pre-initialized since we called db.collection("bills") in beforeEach
      expect(db.collectionMocks["bills"]!.bulkWrite).not.toHaveBeenCalled();
    });
  });

  describe("didPassWithFilibusterCheck: quorum-based cloture (3/5 of votes cast)", () => {
    function makeFilibusteredBill(overrides: Record<string, unknown> = {}) {
      return makeBill({
        countryId: "US",
        originChamber: "senate",
        currentChamber: "senate",
        filibusterInvocations: [
          { characterId: "abc", characterName: "Test Senator", invokedAt: NOW },
        ],
        ...overrides,
      });
    }

    beforeEach(() => {
      db.collection("statePolicies");
      // Filibuster not abolished
      db.collectionMocks["statePolicies"]!.findOne.mockResolvedValue(null);
    });

    it("passes cloture at 3/5 of votes cast, regardless of absent seats", async () => {
      const { didPassWithFilibusterCheck } = await import("./billLifecycle");
      // Bill 6a552645253ce627675ec6ef regression: 58 for / 24 against / 5 abstain.
      // 87 cast → threshold ceil(3/5 × 87) = 53; 58 passes even though 58 < 60
      // (the old seat-based bar with ~13 senators absent).
      const passed = await didPassWithFilibusterCheck(
        db as never,
        makeFilibusteredBill() as never,
        58,
        24,
        5
      );
      expect(passed).toBe(true);
    });

    it("counts abstentions in the quorum — abstaining raises the bar", async () => {
      const { didPassWithFilibusterCheck } = await import("./billLifecycle");
      // 55 for / 25 against / 15 abstain = 95 cast → threshold 57; 55 fails,
      // though it would pass at 3/5 of for+against only (48).
      const passed = await didPassWithFilibusterCheck(
        db as never,
        makeFilibusteredBill() as never,
        55,
        25,
        15
      );
      expect(passed).toBe(false);
    });

    it("passes exactly at the 3/5 boundary", async () => {
      const { didPassWithFilibusterCheck } = await import("./billLifecycle");
      // 60 for / 30 against / 10 abstain = 100 cast → threshold 60; 60 passes.
      const passed = await didPassWithFilibusterCheck(
        db as never,
        makeFilibusteredBill() as never,
        60,
        30,
        10
      );
      expect(passed).toBe(true);
    });

    it("fails when no votes were cast", async () => {
      const { didPassWithFilibusterCheck } = await import("./billLifecycle");
      const passed = await didPassWithFilibusterCheck(
        db as never,
        makeFilibusteredBill() as never,
        0,
        0,
        0
      );
      expect(passed).toBe(false);
    });

    it("applies simple majority when the filibuster has been abolished", async () => {
      db.collectionMocks["statePolicies"]!.findOne.mockResolvedValue({ effectDirection: -1 });
      const { didPassWithFilibusterCheck } = await import("./billLifecycle");
      const passed = await didPassWithFilibusterCheck(
        db as never,
        makeFilibusteredBill() as never,
        51,
        49
      );
      expect(passed).toBe(true);
    });
  });
});
