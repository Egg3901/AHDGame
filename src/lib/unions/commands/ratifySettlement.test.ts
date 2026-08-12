import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { BargainingCampaign, Character, Union } from "@/lib/db/types";
import { actOnBargainingCampaignAsUnion } from "./bargaining";
import {
  castRatificationBallot,
  closeDueRatificationVotes,
  closeRatificationVote,
} from "./ratifySettlement";

vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: vi
    .fn()
    .mockImplementation(async (_inside: unknown, fallback: () => Promise<void>) => fallback()),
}));
vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));

const leaderId = new ObjectId();
const alice = new ObjectId();
const bob = new ObjectId();

function character(id: ObjectId): Character {
  return { _id: id, name: "Organizer", countryId: "US", userId: new ObjectId() } as Character;
}

function ledUnion(): Union {
  return {
    _id: new ObjectId(),
    countryId: "US",
    sectorType: "manufacturing",
    name: "Industrial Workers",
    ownerId: leaderId,
    treasury: 2400,
    membershipPressure: 60,
    lastCalledStrikeTurn: null,
    demandedWageLevel: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function campaignFor(unionId: ObjectId, employerId: ObjectId): BargainingCampaign {
  const offer = {
    revision: 2,
    proposedBy: "employer" as const,
    wageLevel: 1.08,
    agreementDurationTurns: 48,
    noStrikeTurns: 24,
    proposedAtTurn: 101,
    proposedAt: new Date(),
  };
  return {
    _id: new ObjectId(),
    unionId,
    countryId: "US",
    sectorType: "manufacturing",
    employerCorporationId: employerId,
    sectorIds: [new ObjectId()],
    status: "negotiating",
    escalationLevel: "none",
    mandate: {
      coverage: 60,
      grievance: 50,
      laborTightness: 70,
      lawSupport: 50,
      strikeFundRunway: 4,
      support: 56,
      leverage: 58,
      organizedLocalCount: 1,
      totalLocalCount: 1,
    },
    currentOffer: offer,
    offers: [{ ...offer, revision: 1, proposedBy: "union", wageLevel: 1.15 }, offer],
    startedAtTurn: 100,
    deadlineTurn: 108,
    lastActionTurn: 101,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

interface FakeState {
  campaign: BargainingCampaign;
  union: Union;
  organizers: { characterId: ObjectId; strength: number }[];
  ballots: Record<string, unknown>[];
  employerExists: boolean;
  agreements: Record<string, unknown>[];
  campaignUpdates: Record<string, unknown>[];
}

/**
 * Enough of the driver surface for these commands: campaign reads and $set
 * updates, the organizer roster the snapshot is taken from, and the ballot
 * upsert. `$set` is applied to the stored campaign so a follow-up read sees the
 * write, which is what the close path depends on.
 */
function fakeDb(state: FakeState): Db {
  const applySet = (target: Record<string, unknown>, set: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(set)) {
      if (!key.includes(".")) {
        target[key] = value;
        continue;
      }
      const [head, ...rest] = key.split(".");
      const nested = (target[head] ?? {}) as Record<string, unknown>;
      let cursor = nested;
      for (const part of rest.slice(0, -1)) {
        cursor[part] = cursor[part] ?? {};
        cursor = cursor[part] as Record<string, unknown>;
      }
      cursor[rest[rest.length - 1]] = value;
      target[head] = nested;
    }
  };
  return {
    collection: (name: string) => {
      if (name === "gameState") {
        return { findOne: vi.fn().mockResolvedValue({ isProcessing: false }) };
      }
      if (name === "unions") return { findOne: vi.fn().mockResolvedValue(state.union) };
      if (name === "federalBudget") return { findOne: vi.fn().mockResolvedValue({}) };
      if (name === "characters") {
        return {
          findOne: vi.fn().mockResolvedValue({ _id: leaderId, userId: new ObjectId() }),
          find: () => ({
            toArray: () =>
              Promise.resolve(
                state.organizers.map((organizer) => ({
                  _id: organizer.characterId,
                  userId: new ObjectId(),
                }))
              ),
          }),
        };
      }
      if (name === "unionOrganizers") {
        return { find: () => ({ toArray: () => Promise.resolve(state.organizers) }) };
      }
      if (name === "corporations") {
        return {
          findOne: vi
            .fn()
            .mockResolvedValue(
              state.employerExists ? { _id: state.campaign.employerCorporationId } : null
            ),
        };
      }
      if (name === "corporateSectors") {
        return {
          bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 0, matchedCount: 0 }),
          find: () => ({ toArray: () => Promise.resolve([]) }),
        };
      }
      if (name === "collectiveAgreements") {
        return {
          findOne: vi.fn().mockResolvedValue(null),
          insertOne: vi.fn().mockImplementation((doc: Record<string, unknown>) => {
            state.agreements.push(doc);
            return Promise.resolve({ insertedId: doc._id });
          }),
          deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
        };
      }
      if (name === "bargainingCampaigns") {
        return {
          findOne: vi.fn().mockResolvedValue(state.campaign),
          find: () => ({
            toArray: () =>
              Promise.resolve(
                state.campaign.ratification?.status === "open" ? [state.campaign] : []
              ),
          }),
          updateOne: vi.fn().mockImplementation((_filter, update) => {
            const set = (update.$set ?? {}) as Record<string, unknown>;
            state.campaignUpdates.push(set);
            applySet(state.campaign as unknown as Record<string, unknown>, set);
            return Promise.resolve({ modifiedCount: 1 });
          }),
          updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
        };
      }
      if (name === "bargainingRatificationBallots") {
        return {
          find: () => ({ toArray: () => Promise.resolve(state.ballots) }),
          updateOne: vi.fn().mockImplementation((filter, update) => {
            const existing = state.ballots.find(
              (ballot) =>
                ballot.voterCharacterId!.toString() === filter.voterCharacterId.toString() &&
                ballot.offerRevision === filter.offerRevision
            );
            if (existing) Object.assign(existing, update.$set);
            else state.ballots.push({ ...filter, ...update.$set, ...update.$setOnInsert });
            return Promise.resolve({ modifiedCount: 1 });
          }),
          deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  } as unknown as Db;
}

function baseState(overrides: Partial<FakeState> = {}): FakeState {
  const union = ledUnion();
  return {
    union,
    campaign: campaignFor(union._id, new ObjectId()),
    organizers: [
      { characterId: alice, strength: 60 },
      { characterId: bob, strength: 40 },
    ],
    ballots: [],
    employerExists: true,
    agreements: [],
    campaignUpdates: [],
    ...overrides,
  };
}

describe("settlement ratification", () => {
  beforeEach(() => vi.clearAllMocks());

  it("puts the employer's offer to the members instead of settling on the president's word", async () => {
    const state = baseState();
    const db = fakeDb(state);
    const result = await actOnBargainingCampaignAsUnion(
      db,
      character(leaderId),
      state.union._id.toString(),
      state.campaign._id.toString(),
      "accept",
      104
    );
    expect(result.ok).toBe(true);
    expect(state.agreements).toHaveLength(0);
    expect(state.campaign.ratification).toMatchObject({
      status: "open",
      offerRevision: 2,
      totalStrength: 100,
      closesAtTurn: 107,
    });
  });

  it("settles directly when no organizer holds strength, so a settlement is never stranded", async () => {
    const state = baseState({ organizers: [] });
    const db = fakeDb(state);
    const result = await actOnBargainingCampaignAsUnion(
      db,
      character(leaderId),
      state.union._id.toString(),
      state.campaign._id.toString(),
      "accept",
      104
    );
    expect(result.ok).toBe(true);
    expect(state.campaign.ratification).toBeUndefined();
    expect(state.agreements).toHaveLength(1);
  });

  it("settles on a decisive ratify ballot and refuses a voter with no snapshot weight", async () => {
    const state = baseState();
    const db = fakeDb(state);
    await actOnBargainingCampaignAsUnion(
      db,
      character(leaderId),
      state.union._id.toString(),
      state.campaign._id.toString(),
      "accept",
      104
    );

    const stranger = await castRatificationBallot(
      db,
      character(new ObjectId()),
      state.union._id.toString(),
      state.campaign._id.toString(),
      "ratify",
      105
    );
    expect(stranger).toMatchObject({ ok: false, status: 403 });

    const cast = await castRatificationBallot(
      db,
      character(alice),
      state.union._id.toString(),
      state.campaign._id.toString(),
      "ratify",
      105
    );
    expect(cast).toMatchObject({ ok: true, weight: 60, outcome: "ratified" });
    expect(state.campaign.status).toBe("settled");
    expect(state.agreements).toHaveLength(1);
  });

  it("leaves the campaign open and the offer on the table when members reject", async () => {
    const state = baseState();
    const db = fakeDb(state);
    await actOnBargainingCampaignAsUnion(
      db,
      character(leaderId),
      state.union._id.toString(),
      state.campaign._id.toString(),
      "accept",
      104
    );
    const cast = await castRatificationBallot(
      db,
      character(alice),
      state.union._id.toString(),
      state.campaign._id.toString(),
      "reject",
      105
    );
    expect(cast).toMatchObject({ ok: true, outcome: "rejected" });
    expect(state.campaign.status).toBe("negotiating");
    expect(state.campaign.currentOffer.revision).toBe(2);
    expect(state.agreements).toHaveLength(0);

    // And the same offer cannot simply be put back to the same members.
    const retry = await actOnBargainingCampaignAsUnion(
      db,
      character(leaderId),
      state.union._id.toString(),
      state.campaign._id.toString(),
      "accept",
      106
    );
    expect(retry).toMatchObject({ ok: false, status: 409 });
  });

  it("closes every vote that reached its deadline turn", async () => {
    const state = baseState();
    const db = fakeDb(state);
    await actOnBargainingCampaignAsUnion(
      db,
      character(leaderId),
      state.union._id.toString(),
      state.campaign._id.toString(),
      "accept",
      104
    );
    // Nobody voted. Silence leaves the president's acceptance standing.
    const closed = await closeDueRatificationVotes(db, 107);
    expect(closed).toEqual({ ratified: 1, rejected: 0, voided: 0 });
    expect(state.campaign.status).toBe("settled");
  });

  it("voids a vote whose campaign was withdrawn or lapsed under it", async () => {
    const state = baseState();
    const db = fakeDb(state);
    await actOnBargainingCampaignAsUnion(
      db,
      character(leaderId),
      state.union._id.toString(),
      state.campaign._id.toString(),
      "accept",
      104
    );
    state.campaign.status = "withdrawn";
    const closed = await closeRatificationVote(db, state.campaign, 107);
    expect(closed.outcome).toBe("void");
    expect(state.agreements).toHaveLength(0);
    expect(state.campaign.ratification?.status).toBe("void");
  });

  it("lapses the campaign when the employer no longer exists", async () => {
    const state = baseState();
    const db = fakeDb(state);
    await actOnBargainingCampaignAsUnion(
      db,
      character(leaderId),
      state.union._id.toString(),
      state.campaign._id.toString(),
      "accept",
      104
    );
    state.employerExists = false;
    const closed = await closeRatificationVote(db, state.campaign, 106);
    expect(closed).toMatchObject({ outcome: "void", campaignStatus: "lapsed" });
    expect(state.campaign.status).toBe("lapsed");
    expect(state.campaign.endedAtTurn).toBe(106);
  });

  it("closes on schedule even with the presidency vacant, since it is the members' vote", async () => {
    const state = baseState();
    const db = fakeDb(state);
    await actOnBargainingCampaignAsUnion(
      db,
      character(leaderId),
      state.union._id.toString(),
      state.campaign._id.toString(),
      "accept",
      104
    );
    state.union.ownerId = null;
    const closed = await closeRatificationVote(db, state.campaign, 107);
    expect(closed).toMatchObject({ outcome: "ratified", campaignStatus: "settled" });
    expect(state.agreements).toHaveLength(1);
  });

  it("refuses a ballot once the deadline turn has arrived", async () => {
    const state = baseState();
    const db = fakeDb(state);
    await actOnBargainingCampaignAsUnion(
      db,
      character(leaderId),
      state.union._id.toString(),
      state.campaign._id.toString(),
      "accept",
      104
    );
    const late = await castRatificationBallot(
      db,
      character(alice),
      state.union._id.toString(),
      state.campaign._id.toString(),
      "reject",
      107
    );
    expect(late).toMatchObject({ ok: false, status: 409 });
    // The late ballot closed the vote rather than leaving it hanging.
    expect(state.campaign.ratification?.status).not.toBe("open");
  });
});
