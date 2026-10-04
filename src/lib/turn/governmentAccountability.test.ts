import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEvent: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: { govCollapsed: 0, govFormed: 0 },
}));
vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/analytics/officeTransitionAnalytics", () => ({ captureOfficeTransition: vi.fn() }));
vi.mock("@/lib/analytics/billStatusAnalytics", () => ({ captureBillStatusChanged: vi.fn() }));
import {
  openConfidenceMotionForIncumbent,
  updateSeatCountsOnly,
  autoAyeNPPsForParliamentaryAppointment,
  resolveParliamentaryAppointmentVote,
} from "./parliamentaryGovernment";

let db: MockDb;
const now = new Date("2026-10-04T02:00:00Z");
beforeEach(async () => {
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  db.collection("gameState").findOne.mockResolvedValue({
    currentTurn: 100,
    preset: "1953-default",
  });
});

describe("post-election accountability for autonomous and player governments", () => {
  it("opens confidence for an NPP PM and records its identity and actual party", async () => {
    const pmNppId = new ObjectId();
    db.collection("governmentFormations").findOne.mockResolvedValue({
      _id: "JP",
      status: "formed",
      pmCharacterId: null,
      pmNppId,
      pmName: "Incumbent",
      governingPartyId: "2",
      formationType: "minority",
    });
    db.collection("electedOfficials").findOne.mockResolvedValue({ nppId: pmNppId, party: "1" });
    db.collection("pmAppointmentVotes").insertOne.mockImplementation(
      async (doc: { _id: ObjectId }) => ({
        insertedId: doc._id,
      })
    );
    expect((await openConfidenceMotionForIncumbent(db as unknown as Db, "JP", now)).opened).toBe(
      true
    );
    expect(db.collection("electedOfficials").findOne).toHaveBeenCalledWith(
      expect.objectContaining({ nppId: pmNppId, countryId: "JP" })
    );
    expect(db.collection("pmAppointmentVotes").insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        nomineeCharacterId: null,
        nomineeNppId: pmNppId,
        nomineeMode: "npp",
        nomineePartyId: "1",
        isConfidenceMotion: true,
        closesOnTurn: 124,
      })
    );
    expect(db.collection("characters").findOne).not.toHaveBeenCalled();
  });

  it("preserves the sitting government's party when the opposition becomes largest", async () => {
    db.collection("governmentFormations").findOne.mockResolvedValue({
      _id: "JP",
      status: "formed",
      pmNppId: new ObjectId(),
      pmCharacterId: null,
      governingPartyId: "1",
      cycle: 5,
    });
    db.collection("electedOfficials").find.mockReturnValue({
      toArray: async () => [
        { party: "1", seatsHeld: 164 },
        { party: "2", seatsHeld: 250 },
      ],
    } as ReturnType<ReturnType<MockDb["collection"]>["find"]>);
    await updateSeatCountsOnly(db as unknown as Db, "JP", now);
    expect(db.collection("governmentFormations").updateOne).toHaveBeenCalledWith(
      { _id: "JP" },
      expect.objectContaining({
        $set: expect.objectContaining({
          governingPartyId: "1",
          seatsByParty: { "1": 164, "2": 250 },
        }),
      })
    );
  });

  it("casts opposition nays on renewal instead of leaving only government ayes", async () => {
    const voteId = new ObjectId(),
      governmentMp = new ObjectId(),
      oppositionMp = new ObjectId();
    db.collection("pmAppointmentVotes").findOne.mockResolvedValue({
      _id: voteId,
      countryId: "JP",
      status: "active",
      nomineePartyId: "1",
      formationType: "minority",
      coalitionPartyIds: null,
      isConfidenceMotion: true,
      votes: {},
    });
    db.collection("electedOfficials").find.mockReturnValue({
      toArray: async () => [
        { nppId: governmentMp, party: "1", seatsHeld: 164 },
        { nppId: oppositionMp, party: "2", seatsHeld: 250 },
      ],
    } as ReturnType<ReturnType<MockDb["collection"]>["find"]>);
    await autoAyeNPPsForParliamentaryAppointment(db as unknown as Db, "JP", voteId);
    expect(db.collection("pmAppointmentVotes").updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $inc: { votesAgainst: 250 } })
    );
  });
  it("removes a defeated NPP incumbent even when a historical appointment passed", async () => {
    const pm = new ObjectId(),
      opponent = new ObjectId(),
      voteId = new ObjectId();
    const vote = {
      _id: voteId,
      countryId: "JP",
      nomineeNppId: pm,
      nomineeCharacterId: null,
      nomineeName: "PM",
      nomineePartyId: "1",
      status: "active",
      isConfidenceMotion: true,
      openedAt: now,
      votes: { [`npp_${pm}`]: "aye", [`npp_${opponent}`]: "nay" },
    };
    db.collection("governmentFormations").findOne.mockResolvedValue({
      _id: "JP",
      status: "formed",
      pmNppId: pm,
      pmCharacterId: null,
      governingPartyId: "1",
    });
    db.collection("pmAppointmentVotes").findOne.mockImplementation(
      async (filter: Record<string, unknown>) => {
        if (filter._id instanceof ObjectId) return vote;
        return filter.closedAt ? null : { status: "passed", closedAt: new Date("2025-01-01") };
      }
    );
    db.collection("pmAppointmentVotes").findOneAndUpdate.mockResolvedValue(vote);
    db.collection("electedOfficials")
      .find()
      .toArray.mockResolvedValue([
        {
          nppId: pm,
          characterId: null,
          party: "1",
          seatsHeld: 10,
          officeType: "shugiin",
          countryId: "JP",
        },
        {
          nppId: opponent,
          characterId: null,
          party: "2",
          seatsHeld: 20,
          officeType: "shugiin",
          countryId: "JP",
        },
      ]);
    db.collection("npps")
      .find()
      .toArray.mockResolvedValue([
        { _id: pm, party: "1" },
        { _id: opponent, party: "2" },
      ]);
    db.collection("electedOfficials")
      .find()
      .toArray.mockResolvedValue([
        { nppId: pm, characterId: null, isNPP: true, party: "1", seatsHeld: 10 },
        { nppId: opponent, characterId: null, isNPP: true, party: "2", seatsHeld: 20 },
      ]);
    await resolveParliamentaryAppointmentVote(db as unknown as Db, "JP", voteId, now);
    expect(db.collection("governmentFormations").updateOne).toHaveBeenCalledWith(
      { _id: "JP" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "pending", pmNppId: null }),
      })
    );
  });
  it("honors explicit minority tolerance while opposition without an agreement votes nay", async () => {
    const voteId = new ObjectId(),
      nppId = new ObjectId();
    db.collection("pmAppointmentVotes").findOne.mockResolvedValue({
      _id: voteId,
      countryId: "JP",
      status: "active",
      nomineePartyId: "1",
      isConfidenceMotion: true,
      confidenceAbstentionPartyIds: ["2"],
      votes: {},
    });
    db.collection("electedOfficials")
      .find()
      .toArray.mockResolvedValue([{ nppId, party: "2", seatsHeld: 100 }]);
    await autoAyeNPPsForParliamentaryAppointment(db as unknown as Db, "JP", voteId);
    expect(db.collection("pmAppointmentVotes").updateOne).not.toHaveBeenCalled();
  });
});
