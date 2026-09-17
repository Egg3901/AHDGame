import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { processUkLeadershipChallengeTurn } from "./ukLeadershipChallengeTurn";
import {
  castLeadershipBallotVote,
  initiateLeadershipChallenge,
} from "@/lib/uk/leadership/leadershipCommands";
import { createFakeLeadershipDb } from "@/lib/uk/leadership/leadershipTestDb";
import { getLowerChamberOfficeType } from "@/lib/legislature/chamberOfficeType";
import {
  LEADERSHIP_BALLOT_DURATION_TURNS,
  LEADERSHIP_GATHERING_WINDOW_TURNS,
} from "@/lib/uk/leadership/rules";
import type { PoliticalParty } from "@/lib/db/types";

vi.mock("@/lib/notifications", () => ({ createNotification: async () => undefined }));
vi.mock("@/lib/country/registeredCountries", () => ({ getRegisteredCountryIds: vi.fn() }));

const MP_OFFICE = getLowerChamberOfficeType("UK");
const NOW = () => new Date("2026-09-17T00:00:00Z");

async function seedParty(db: Db, mpCount: number) {
  const partySeq = "2";
  const mkChar = async (name: string) => {
    const id = new ObjectId();
    await db.collection("characters").insertOne({ _id: id, name, party: partySeq });
    return id;
  };
  const leaderId = await mkChar("Leader Lex");
  const mpIds: ObjectId[] = [];
  for (let i = 0; i < mpCount; i++) {
    const id = await mkChar(`MP ${i}`);
    mpIds.push(id);
    await db.collection("electedOfficials").insertOne({
      _id: new ObjectId(),
      characterId: id,
      countryId: "UK",
      officeType: MP_OFFICE,
      party: partySeq,
      seatsHeld: 1,
    });
  }
  await db.collection("politicalParties").insertOne({
    _id: new ObjectId(),
    sequentialId: 2,
    countryId: "UK",
    name: "Conservative Party",
    abbreviation: "CON",
    chairId: leaderId,
    viceChairId: null,
    treasurerId: null,
    committeeIds: mpIds.slice(0, 3),
    memberCount: mpCount + 1,
  } as unknown as PoliticalParty);
  return { partySeq, mpIds };
}

async function setRegistered(ids: string[]) {
  const { getRegisteredCountryIds } = await import("@/lib/country/registeredCountries");
  vi.mocked(getRegisteredCountryIds).mockResolvedValue(ids as never);
}

describe("processUkLeadershipChallengeTurn", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await setRegistered(["UK"]);
  });

  it("is a no-op returning zeros when the UK is not registered", async () => {
    await setRegistered(["US"]);
    const db = createFakeLeadershipDb();
    const result = await processUkLeadershipChallengeTurn(db, 200, NOW());
    expect(result).toEqual({ expired: 0, resolved: 0, removed: 0 });
  });

  it("leaves unripe gatherings and open ballots alone", async () => {
    const db = createFakeLeadershipDb();
    const { partySeq, mpIds } = await seedParty(db, 20);
    const actor = { _id: mpIds[0], name: "MP 0", party: partySeq };
    await initiateLeadershipChallenge(db, "UK", partySeq, actor, 100, NOW());
    const result = await processUkLeadershipChallengeTurn(db, 101, NOW());
    expect(result).toEqual({ expired: 0, resolved: 0, removed: 0 });
    const live = await db
      .collection("ukLeadershipChallenges")
      .findOne({ countryId: "UK", status: "gathering" });
    expect(live).not.toBeNull();
  });

  it("expires a gathering that never reaches threshold", async () => {
    const db = createFakeLeadershipDb();
    const { partySeq, mpIds } = await seedParty(db, 20);
    const actor = { _id: mpIds[0], name: "MP 0", party: partySeq };
    await initiateLeadershipChallenge(db, "UK", partySeq, actor, 100, NOW());
    const result = await processUkLeadershipChallengeTurn(
      db,
      100 + LEADERSHIP_GATHERING_WINDOW_TURNS,
      NOW()
    );
    expect(result).toEqual({ expired: 1, resolved: 0, removed: 0 });
    const leadership = await db.collection("ukPartyLeadership").findOne({ _id: "UK:2" });
    expect(leadership?.activeChallengeId).toBeNull();
  });

  it("resolves a closed ballot and counts the removal", async () => {
    const db = createFakeLeadershipDb();
    const { partySeq, mpIds } = await seedParty(db, 1);
    const actor = { _id: mpIds[0], name: "MP 0", party: partySeq };
    const { challengeId } = await initiateLeadershipChallenge(
      db,
      "UK",
      partySeq,
      actor,
      100,
      NOW()
    );
    await castLeadershipBallotVote(db, "UK", challengeId, actor, "aye", 101, NOW());
    const result = await processUkLeadershipChallengeTurn(
      db,
      100 + LEADERSHIP_BALLOT_DURATION_TURNS,
      NOW()
    );
    expect(result).toEqual({ expired: 0, resolved: 1, removed: 1 });
  });

  it("is idempotent: rerunning the same turn resolves nothing twice", async () => {
    const db = createFakeLeadershipDb();
    const { partySeq, mpIds } = await seedParty(db, 20);
    const actor = { _id: mpIds[0], name: "MP 0", party: partySeq };
    await initiateLeadershipChallenge(db, "UK", partySeq, actor, 100, NOW());
    const close = 100 + LEADERSHIP_GATHERING_WINDOW_TURNS;
    const first = await processUkLeadershipChallengeTurn(db, close, NOW());
    expect(first.expired).toBe(1);
    const second = await processUkLeadershipChallengeTurn(db, close, NOW());
    expect(second).toEqual({ expired: 0, resolved: 0, removed: 0 });
    const later = await processUkLeadershipChallengeTurn(db, close + 10, NOW());
    expect(later).toEqual({ expired: 0, resolved: 0, removed: 0 });
  });
});
