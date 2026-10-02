/**
 * Government appointment and confidence votes follow the seated chamber of the
 * current constitution. Obsolete deputies retain no vote in its replacements.
 */
import { ObjectId, type Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({
    currentTurn: 40,
    effectiveNow: new Date("1992-01-01T00:00:00Z"),
  }),
}));
vi.mock("@/lib/congress/clearWhippedVote", () => ({ clearWhippedFromVote: vi.fn() }));

import {
  castPmAppointmentVote,
  castNoConfidenceVote,
  proposeHosAppointment,
} from "./parliamentaryGovernment";
import {
  getHosAppointmentCandidates,
  getPmAppointmentCandidates,
} from "../queries/parliamentaryGovernment";

const phases = [
  { markers: {}, office: "unionCongressDeputy", obsolete: "dumaDeputy" },
  {
    markers: { ruSovietSuccessionSinceTurn: 24 },
    office: "congressDeputy",
    obsolete: "unionCongressDeputy",
  },
  {
    markers: { ruSovietSuccessionSinceTurn: 24, ruFederalAssemblySinceTurn: 30 },
    office: "dumaDeputy",
    obsolete: "congressDeputy",
  },
];

describe("appointments and confidence use the active constitution", () => {
  let mem: ReturnType<typeof createInMemoryDb>;
  let voterId: ObjectId;
  let obsoleteId: ObjectId;
  let voteId: ObjectId;
  beforeEach(() => {
    mem = createInMemoryDb();
    voterId = new ObjectId();
    obsoleteId = new ObjectId();
    voteId = new ObjectId();
    mem.seed("gameState", [{ _id: "current", preset: "1991-default", currentTurn: 40 }]);
  });

  it.each(phases)(
    "weights the active $office appointment vote and rejects $obsolete",
    async (phase) => {
      mem.seed("countryGameStates", [{ _id: "RU", ...phase.markers }]);
      mem.seed("electedOfficials", [
        {
          _id: new ObjectId(),
          countryId: "RU",
          characterId: voterId,
          officeType: phase.office,
          seatsHeld: 3,
        },
        {
          _id: new ObjectId(),
          countryId: "RU",
          characterId: obsoleteId,
          officeType: phase.obsolete,
          seatsHeld: 10,
        },
      ]);
      mem.seed("pmAppointmentVotes", [
        {
          _id: voteId,
          countryId: "RU",
          status: "active",
          closesOnTurn: 60,
          votes: {},
          votesFor: 0,
          votesAgainst: 0,
        },
      ]);
      const db = mem as unknown as Db;
      await expect(
        castPmAppointmentVote(db, "RU", { _id: obsoleteId }, String(voteId), "aye")
      ).rejects.toMatchObject({ status: 403 });
      const update = vi
        .spyOn(mem.collection("pmAppointmentVotes"), "updateOne")
        .mockResolvedValue({ matchedCount: 1, modifiedCount: 1, upsertedCount: 0 });
      await castPmAppointmentVote(db, "RU", { _id: voterId }, String(voteId), "aye");
      expect(update).toHaveBeenCalledWith({ _id: voteId, countryId: "RU", status: "active" }, [
        expect.objectContaining({
          $set: expect.objectContaining({
            votesFor: { $add: [{ $ifNull: ["$votesFor", 0] }, 3, expect.any(Object)] },
          }),
        }),
      ]);
    }
  );

  it.each(phases)(
    "weights the active $office confidence vote and rejects $obsolete",
    async (phase) => {
      mem.seed("countryGameStates", [{ _id: "RU", ...phase.markers }]);
      mem.seed("electedOfficials", [
        {
          _id: new ObjectId(),
          countryId: "RU",
          characterId: voterId,
          officeType: phase.office,
          seatsHeld: 2,
        },
        {
          _id: new ObjectId(),
          countryId: "RU",
          characterId: obsoleteId,
          officeType: phase.obsolete,
        },
      ]);
      mem.seed("noConfidenceVotes", [
        {
          _id: voteId,
          countryId: "RU",
          status: "active",
          closesOnTurn: 60,
          votes: {},
          votesFor: 0,
          votesAgainst: 0,
        },
      ]);
      const db = mem as unknown as Db;
      await expect(
        castNoConfidenceVote(db, "RU", { _id: obsoleteId }, String(voteId), "aye")
      ).rejects.toMatchObject({ status: 403 });
      const update = vi
        .spyOn(mem.collection("noConfidenceVotes"), "updateOne")
        .mockResolvedValue({ matchedCount: 1, modifiedCount: 1, upsertedCount: 0 });
      await castNoConfidenceVote(db, "RU", { _id: voterId }, String(voteId), "aye");
      expect(update).toHaveBeenCalledWith({ _id: voteId, countryId: "RU", status: "active" }, [
        expect.objectContaining({
          $set: expect.objectContaining({
            votesFor: { $add: [{ $ifNull: ["$votesFor", 0] }, 2, expect.any(Object)] },
          }),
        }),
      ]);
    }
  );

  it.each(phases)("lists only active $office PM candidates", async (phase) => {
    mem.seed("countryGameStates", [{ _id: "RU", ...phase.markers }]);
    mem.seed("countryState", [{ _id: "RU", governmentType: "parliamentaryRepublic" }]);
    mem.seed("politicalParties", [
      { _id: new ObjectId(), countryId: "RU", sequentialId: 1, chairId: voterId, name: "Party" },
    ]);
    mem.seed("governmentFormations", [{ _id: "RU", status: "pending", majorityThreshold: 1 }]);
    mem.seed("characters", [
      { _id: voterId, name: "Deputy", party: "1", userId: new ObjectId() },
      { _id: obsoleteId, name: "Former Deputy", party: "1", userId: new ObjectId() },
    ]);
    mem.seed("electedOfficials", [
      {
        _id: new ObjectId(),
        countryId: "RU",
        characterId: voterId,
        officeType: phase.office,
        party: "1",
        seatsHeld: 2,
      },
      {
        _id: new ObjectId(),
        countryId: "RU",
        characterId: obsoleteId,
        officeType: phase.obsolete,
        party: "1",
        seatsHeld: 500,
      },
    ]);
    const result = await getPmAppointmentCandidates(mem as unknown as Db, "RU", voterId);
    expect(result.candidates).toEqual([
      expect.objectContaining({ _id: String(voterId), seatsByParty: 2 }),
    ]);
  });

  it.each([{ ruSovietSuccessionSinceTurn: 24, ruPresidencySinceTurn: 30 }])(
    "rejects legislative head-of-state nominations under a presidential constitution %j",
    async (markers) => {
      mem.seed("countryGameStates", [{ _id: "RU", ...markers }]);
      const db = mem as unknown as Db;
      await expect(
        proposeHosAppointment(db, "RU", { _id: voterId, name: "Chair" }, String(voterId))
      ).rejects.toMatchObject({ status: 400 });
      await expect(getHosAppointmentCandidates(db, "RU", voterId)).rejects.toMatchObject({
        status: 400,
      });
      expect(mem.collection("pmAppointmentVotes").docs).toEqual([]);
    }
  );
  it("rejects a stale legislative head-of-state vote after presidential adoption", async () => {
    mem.seed("countryGameStates", [
      { _id: "RU", ruSovietSuccessionSinceTurn: 24, ruPresidencySinceTurn: 30 },
    ]);
    mem.seed("electedOfficials", [
      { _id: new ObjectId(), countryId: "RU", characterId: voterId, officeType: "congressDeputy" },
    ]);
    mem.seed("pmAppointmentVotes", [
      {
        _id: voteId,
        countryId: "RU",
        office: "headOfState",
        status: "active",
        closesOnTurn: 60,
        votes: {},
        votesFor: 0,
        votesAgainst: 0,
      },
    ]);
    await expect(
      castPmAppointmentVote(mem as unknown as Db, "RU", { _id: voterId }, String(voteId), "aye")
    ).rejects.toMatchObject({ status: 400 });
    expect(mem.collection("pmAppointmentVotes").docs[0]).toMatchObject({ votes: {}, votesFor: 0 });
  });
});
