import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getCountryConfigForRuntime } from "@/lib/constants/countries";
import { resolveCountryOfficeLayout } from "@/lib/countries/rules/officeLayout";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEvent: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: { govCollapsed: 0x992222, govFormed: 0x229944 },
}));
vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/congress/governmentVoteBreakdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/congress/governmentVoteBreakdown")>();
  return {
    ...actual,
    computeParliamentaryGovernmentTally: vi.fn(actual.computeParliamentaryGovernmentTally),
  };
});

import { resolveParliamentaryAppointmentVote } from "@/lib/turn/parliamentaryGovernment";

let db: MockDb;
const offices = resolveCountryOfficeLayout(getCountryConfigForRuntime("UK", "1991-default"));
const now = new Date("2026-10-04T12:00:00.000Z");
const voteId = new ObjectId();
const nomineeId = new ObjectId();

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  db.collection("governmentFormations");
  db.collection("gameState");
  db.collection("countryGameStates");
  db.collection("countryState");
  db.collection("pmAppointmentVotes");
  db.collection("billWhips");
  db.collection("electedOfficials");
  db.collection("characters");
  db.collection("npps");
  db.collection("cabinetMembers");
  db.collection("ukCabinetCooldowns");
  db.collectionMocks.gameState.findOne.mockResolvedValue({
    _id: "current",
    preset: "1991-default",
    currentTurn: 100,
  });
  db.collectionMocks.governmentFormations.findOne.mockResolvedValue({
    _id: "UK",
    status: "formed",
    pmCharacterId: new ObjectId(),
    pmName: "Outgoing PM",
    totalSeats: 650,
    seatsByParty: { "1": 400, "2": 250 },
  });
  db.collectionMocks.characters.findOne.mockResolvedValue({
    _id: nomineeId,
    userId: new ObjectId(),
    avatarUrl: "https://cdn.invalid/nominee.png",
    party: "1",
  });
  db.collectionMocks.characters.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([]),
  });
  db.collectionMocks.electedOfficials.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([]),
  });
  db.collectionMocks.billWhips.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([]),
  });
  db.collectionMocks.pmAppointmentVotes.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([]),
  });
});

function setVote(vote: Record<string, unknown>, claimed: boolean) {
  db.collectionMocks.pmAppointmentVotes.findOne.mockImplementation(
    async (filter: Record<string, unknown>) => (filter.status === "passed" ? null : vote)
  );
  db.collectionMocks.pmAppointmentVotes.findOneAndUpdate.mockImplementation(
    async (_filter, update: { $set?: Record<string, unknown> }) =>
      claimed ? { ...vote, ...update.$set } : null
  );
  db.collectionMocks.pmAppointmentVotes.updateMany.mockResolvedValue({
    modifiedCount: 0,
  });
}

async function setTally(votesFor: number, votesAgainst: number) {
  const { computeParliamentaryGovernmentTally } =
    await import("@/lib/congress/governmentVoteBreakdown");
  vi.mocked(computeParliamentaryGovernmentTally).mockResolvedValue({
    votesFor,
    votesAgainst,
    voteByParty: [],
  });
}

function appointmentVote(isConfidenceMotion: boolean) {
  return {
    _id: voteId,
    countryId: "UK",
    status: "active",
    votesFor: 200,
    votesAgainst: 100,
    votes: {},
    nomineeCharacterId: nomineeId,
    nomineeName: "Nominee",
    nomineePartyId: "1",
    formationType: "majority",
    coalitionId: null,
    coalitionPartyIds: null,
    isConfidenceMotion,
  };
}

describe("parliamentary public event card contract", () => {
  it("publishes the appointment notice and exact government-formation tally card", async () => {
    const { sendCountryGameEvent, DISCORD_COLORS } = await import("@/lib/discordWebhooks");
    setVote(appointmentVote(false), true);
    await setTally(200, 100);

    await resolveParliamentaryAppointmentVote(db as unknown as Db, "UK", voteId, now, offices);

    expect(sendCountryGameEvent).toHaveBeenCalledTimes(2);
    expect(sendCountryGameEvent).toHaveBeenNthCalledWith(1, "UK", {
      title: "New Prime Minister Appointed",
      description: "**Nominee** has been appointed as Prime Minister of United Kingdom.",
      color: DISCORD_COLORS.govFormed,
      footer: { text: "A House Divided" },
      timestamp: now.toISOString(),
      thumbnail: { url: "https://cdn.invalid/nominee.png" },
    });
    expect(sendCountryGameEvent).toHaveBeenNthCalledWith(2, "UK", {
      title: "Government Formed",
      description: "**Nominee** has been confirmed as Prime Minister (200\u2013100).",
      color: DISCORD_COLORS.govFormed,
      footer: { text: "A House Divided" },
      timestamp: now.toISOString(),
      cardVoteSplit: [
        {
          label: "House of Commons",
          votesFor: 200,
          votesAgainst: 100,
          votesAbstain: 0,
          seats: 650,
        },
      ],
      thumbnail: { url: "https://cdn.invalid/nominee.png" },
    });
  });

  it("publishes exact confidence-collapse result and tally only when its claim wins", async () => {
    const { sendCountryGameEvent, DISCORD_COLORS } = await import("@/lib/discordWebhooks");
    setVote({ ...appointmentVote(true), votesFor: 200, votesAgainst: 300 }, true);
    await setTally(200, 300);

    await resolveParliamentaryAppointmentVote(db as unknown as Db, "UK", voteId, now, offices);

    expect(sendCountryGameEvent).toHaveBeenCalledTimes(1);
    expect(sendCountryGameEvent).toHaveBeenNthCalledWith(1, "UK", {
      title: "Prime Minister Loses Confidence Motion",
      description:
        "**Nominee** lost the post-election confidence motion (200 ayes, 300 nays) and has been removed from office.",
      color: DISCORD_COLORS.govCollapsed,
      footer: { text: "A House Divided" },
      timestamp: now.toISOString(),
      cardVoteSplit: [
        {
          label: "House of Commons",
          votesFor: 200,
          votesAgainst: 300,
          votesAbstain: 0,
        },
      ],
      thumbnail: { url: "https://cdn.invalid/nominee.png" },
    });
  });

  it("omits an unavailable nominee portrait without changing the card", async () => {
    const { sendCountryGameEvent, DISCORD_COLORS } = await import("@/lib/discordWebhooks");
    setVote(appointmentVote(false), true);
    await setTally(200, 100);
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: nomineeId,
      party: "1",
    });

    await resolveParliamentaryAppointmentVote(db as unknown as Db, "UK", voteId, now, offices);

    expect(sendCountryGameEvent).toHaveBeenCalledTimes(2);
    expect(sendCountryGameEvent).toHaveBeenNthCalledWith(1, "UK", {
      title: "New Prime Minister Appointed",
      description: "**Nominee** has been appointed as Prime Minister of United Kingdom.",
      color: DISCORD_COLORS.govFormed,
      footer: { text: "A House Divided" },
      timestamp: now.toISOString(),
    });
    expect(sendCountryGameEvent).toHaveBeenNthCalledWith(2, "UK", {
      title: "Government Formed",
      description: "**Nominee** has been confirmed as Prime Minister (200\u2013100).",
      color: DISCORD_COLORS.govFormed,
      footer: { text: "A House Divided" },
      timestamp: now.toISOString(),
      cardVoteSplit: [
        {
          label: "House of Commons",
          votesFor: 200,
          votesAgainst: 100,
          votesAbstain: 0,
          seats: 650,
        },
      ],
    });
  });

  it.each([
    { confidence: false, votesAgainst: 100, status: "passed" },
    { confidence: true, votesAgainst: 300, status: "failed" },
  ])("does no publication or government write after losing the $status claim", async (scenario) => {
    const { sendCountryGameEvent } = await import("@/lib/discordWebhooks");
    setVote(
      {
        ...appointmentVote(scenario.confidence),
        votesFor: 200,
        votesAgainst: scenario.votesAgainst,
      },
      false
    );
    await setTally(200, scenario.votesAgainst);

    await resolveParliamentaryAppointmentVote(db as unknown as Db, "UK", voteId, now, offices);

    expect(db.collectionMocks.pmAppointmentVotes.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: voteId, status: "active" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: scenario.status }),
      })
    );
    expect(sendCountryGameEvent).not.toHaveBeenCalled();
    expect(db.collectionMocks.governmentFormations.updateOne).not.toHaveBeenCalled();
  });
});
