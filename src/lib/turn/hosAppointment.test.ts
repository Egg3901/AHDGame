/**
 * Tests for the head-of-state appointment resolution (spec §2.3 — RU Chairman
 * of the Presidium, joint-sitting vote over both Supreme Soviet chambers).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { resolveHeadOfStateAppointmentVote } from "./hosAppointment";

vi.mock("@/lib/turn/parliamentaryGovernment", () => ({
  autoAyeNPPsForParliamentaryAppointment: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/congress/governmentVoteBreakdown", () => ({
  computeParliamentaryGovernmentTally: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({ createNotifications: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEvent: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: { govFormed: 0 },
}));

type Doc = Record<string, unknown>;

function makeDb(vote: Doc | null) {
  const voteUpdates: Doc[] = [];
  const officialDeletes: Doc[] = [];
  const officialInserts: Doc[] = [];
  const govUpdates: Doc[] = [];
  const votesColl = {
    findOne: vi.fn().mockResolvedValue(vote),
    findOneAndUpdate: vi.fn().mockImplementation((_f: Doc, u: Doc) => {
      voteUpdates.push(u);
      return Promise.resolve(vote);
    }),
    updateMany: vi.fn().mockResolvedValue({}),
  };
  const db = {
    collection: vi.fn().mockImplementation((name: string) => {
      if (name === "pmAppointmentVotes") return votesColl;
      if (name === "governmentFormations") {
        return {
          updateOne: vi.fn().mockImplementation((_f: Doc, u: Doc) => {
            govUpdates.push(u);
            return Promise.resolve({});
          }),
        };
      }
      if (name === "electedOfficials") {
        return {
          deleteMany: vi.fn().mockImplementation((f: Doc) => {
            officialDeletes.push(f);
            return Promise.resolve({});
          }),
          insertOne: vi.fn().mockImplementation((d: Doc) => {
            officialInserts.push(d);
            return Promise.resolve({ insertedId: d._id });
          }),
        };
      }
      if (name === "characters") {
        return { findOne: vi.fn().mockResolvedValue({ party: "1", userId: new ObjectId() }) };
      }
      return { findOne: vi.fn().mockResolvedValue(null) };
    }),
  };
  return { db, votesColl, voteUpdates, officialDeletes, officialInserts, govUpdates };
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

function makeVote(overrides: Doc = {}): Doc {
  return {
    _id: new ObjectId(),
    countryId: "RU",
    office: "headOfState",
    status: "active",
    nomineeCharacterId: new ObjectId(),
    nomineeName: "Test Chairman",
    nomineePartyId: "1",
    votes: { someone: "aye" },
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("resolveHeadOfStateAppointmentVote", () => {
  it("pass: seats the chairmanOfPresidium row, stamps hos fields, cancels siblings", async () => {
    await setTally(10, 3);
    const vote = makeVote();
    const { db, votesColl, officialDeletes, officialInserts, govUpdates } = makeDb(vote);

    await resolveHeadOfStateAppointmentVote(db as never, "RU", vote._id as ObjectId, new Date());

    expect(officialDeletes[0]).toEqual({ countryId: "RU", officeType: "chairmanOfPresidium" });
    expect(officialInserts[0]).toMatchObject({
      countryId: "RU",
      officeType: "chairmanOfPresidium",
      characterId: vote.nomineeCharacterId,
      characterName: "Test Chairman",
      isNPP: false,
    });
    expect(govUpdates[0]).toEqual({
      $set: expect.objectContaining({
        hosCharacterId: vote.nomineeCharacterId,
        hosNppId: null,
        hosName: "Test Chairman",
      }),
    });
    expect(votesColl.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ office: "headOfState", status: "active" }),
      expect.anything()
    );
  });

  it("fail: closes the vote without seating anyone", async () => {
    await setTally(2, 9);
    const vote = makeVote();
    const { db, officialInserts, govUpdates, voteUpdates } = makeDb(vote);

    await resolveHeadOfStateAppointmentVote(db as never, "RU", vote._id as ObjectId, new Date());

    expect((voteUpdates[0] as { $set: Doc }).$set.status).toBe("failed");
    expect(officialInserts).toHaveLength(0);
    expect(govUpdates).toHaveLength(0);
  });

  it("ignores non-hos votes (defensive)", async () => {
    await setTally(10, 0);
    const vote = makeVote({ office: undefined });
    const { db, voteUpdates } = makeDb(vote);
    await resolveHeadOfStateAppointmentVote(db as never, "RU", vote._id as ObjectId, new Date());
    expect(voteUpdates).toHaveLength(0);
  });
});
