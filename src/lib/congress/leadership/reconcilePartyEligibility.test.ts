import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { buildChamberLeadershipContext } from "@/lib/congress/leadership/rolePolicy";

vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({
    currentTurn: 500,
    effectiveNow: new Date("2026-05-30T12:00:00Z"),
    lastTurnProcessed: new Date("2026-05-30T12:00:00Z"),
    isActive: true,
    pausedAt: null,
  }),
}));
vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEvent: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: { leadership: 0 },
}));

const SENATE_CTX = buildChamberLeadershipContext({
  composition: [
    { party: "MAJ", partyName: "Democratic Party" },
    { party: "OPP", partyName: "Republican Party" },
  ],
  majorityParty: "MAJ",
  majorityBloc: null,
});

const SENATE_CTX_BY_CHAMBER = { senate: SENATE_CTX, house: SENATE_CTX };

const NOW = new Date("2026-05-30T12:00:00Z");

function cursorOf(docs: unknown[]) {
  return { toArray: vi.fn().mockResolvedValue(docs) };
}

/** Seat the given leader roles, all held by `holderId`. */
function seatLeaders(db: MockDb, roles: string[], holderId: ObjectId, cachedParty: string) {
  db.collectionMocks["congressLeaders"]!.find.mockImplementation(() =>
    cursorOf(
      roles.map((role) => ({
        role,
        characterId: holderId,
        characterName: "Estes Kefauver",
        party: cachedParty,
      }))
    )
  );
}

/** The holder's live seat row and character row, as the bulk lookups see them. */
function seatHolder(
  db: MockDb,
  holderId: ObjectId,
  chamber: "house" | "senate",
  liveParty: string | null
) {
  db.collectionMocks["electedOfficials"]!.find.mockImplementation(() =>
    cursorOf(
      liveParty === null
        ? []
        : [{ _id: new ObjectId(), officeType: chamber, characterId: holderId, party: liveParty }]
    )
  );
  db.collectionMocks["characters"]!.find.mockImplementation(() =>
    cursorOf(liveParty === null ? [] : [{ _id: holderId, party: liveParty }])
  );
}

describe("reconcileLeadershipPartyEligibility", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const name of [
      "congressLeaders",
      "electedOfficials",
      "characters",
      "senateLeadershipElections",
      "senateLeadershipNominations",
      "houseLeadershipElections",
      "houseLeadershipNominations",
    ]) {
      db.collection(name);
    }
    db.collectionMocks["senateLeadershipElections"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["houseLeadershipElections"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["congressLeaders"]!.find.mockImplementation(() => cursorOf([]));
    // The vacate is a conditional update; by default this pass wins the claim.
    db.collectionMocks["congressLeaders"]!.updateOne.mockResolvedValue({ matchedCount: 1 });
  });

  it("vacates a Pro Tempore who has gone independent and opens a 24-turn election", async () => {
    const holder = new ObjectId();
    seatLeaders(db, ["president_pro_tempore"], holder, "MAJ");
    seatHolder(db, holder, "senate", "independent");

    const { reconcileLeadershipPartyEligibility } = await import("./reconcilePartyEligibility");
    const vacated = await reconcileLeadershipPartyEligibility(
      db as unknown as Db,
      "senate",
      SENATE_CTX,
      NOW
    );

    expect(vacated).toEqual([
      expect.objectContaining({
        leaderRole: "president_pro_tempore",
        characterName: "Estes Kefauver",
        party: "independent",
      }),
    ]);
    expect(db.collectionMocks["congressLeaders"]!.updateOne).toHaveBeenCalledWith(
      { role: "president_pro_tempore", characterId: holder },
      expect.objectContaining({
        $set: expect.objectContaining({ characterId: null, characterName: "Vacant" }),
      }),
      { upsert: false }
    );
    expect(db.collectionMocks["senateLeadershipElections"]!.updateOne).toHaveBeenCalledWith(
      { _id: "pro_tempore" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "voting", endsOnTurn: 524 }),
      }),
      { upsert: true }
    );
  });

  it("reads the live seat party, not the stale party cached on the leader document", async () => {
    // `congressLeaders.party` is the party they QUALIFIED under, not where they
    // are now: it is stamped at election time and never updated on a switch. It
    // is the baseline for "did they move", never the live value.
    const holder = new ObjectId();
    seatLeaders(db, ["majority_leader_senate"], holder, "MAJ");
    seatHolder(db, holder, "senate", "OPP");

    const { reconcileLeadershipPartyEligibility } = await import("./reconcilePartyEligibility");
    const vacated = await reconcileLeadershipPartyEligibility(
      db as unknown as Db,
      "senate",
      SENATE_CTX,
      NOW
    );

    expect(vacated).toHaveLength(1);
    expect(vacated[0]!.leaderRole).toBe("majority_leader_senate");
  });

  it("leaves a holder alone when the chamber's majority moved out from under them", async () => {
    // The holder did not move: they still belong to the party they won the
    // office under. That party simply stopped being the chamber's largest.
    // Reopening that seat belongs to `triggerLeadershipElectionsAfterChamberVote`,
    // which opens a race WITHOUT emptying the chair first — vacating here would
    // silently override it and leave the chamber leaderless for 24 turns.
    const holder = new ObjectId();
    seatLeaders(db, ["majority_leader_senate"], holder, "OPP");
    seatHolder(db, holder, "senate", "OPP");

    const { reconcileLeadershipPartyEligibility } = await import("./reconcilePartyEligibility");
    const vacated = await reconcileLeadershipPartyEligibility(
      db as unknown as Db,
      "senate",
      SENATE_CTX, // majorityParty is "MAJ", so "OPP" is no longer the majority
      NOW
    );

    expect(vacated).toEqual([]);
    expect(db.collectionMocks["congressLeaders"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["senateLeadershipElections"]!.updateOne).not.toHaveBeenCalled();
  });

  it("leaves a holder alone when the leadership row records no qualifying party", async () => {
    // Without a baseline there is no way to tell a defection from a majority
    // flip, and vacating an office is not a coin toss.
    const holder = new ObjectId();
    db.collectionMocks["congressLeaders"]!.find.mockImplementation(() =>
      cursorOf([
        {
          role: "president_pro_tempore",
          characterId: holder,
          characterName: "Estes Kefauver",
          // no `party`
        },
      ])
    );
    seatHolder(db, holder, "senate", "independent");

    const { reconcileLeadershipPartyEligibility } = await import("./reconcilePartyEligibility");
    const vacated = await reconcileLeadershipPartyEligibility(
      db as unknown as Db,
      "senate",
      SENATE_CTX,
      NOW
    );

    expect(vacated).toEqual([]);
    expect(db.collectionMocks["congressLeaders"]!.updateOne).not.toHaveBeenCalled();
  });

  it("leaves a holder still in the majority party alone", async () => {
    const holder = new ObjectId();
    seatLeaders(
      db,
      ["president_pro_tempore", "majority_leader_senate", "majority_whip_senate"],
      holder,
      "MAJ"
    );
    seatHolder(db, holder, "senate", "MAJ");

    const { reconcileLeadershipPartyEligibility } = await import("./reconcilePartyEligibility");
    const vacated = await reconcileLeadershipPartyEligibility(
      db as unknown as Db,
      "senate",
      SENATE_CTX,
      NOW
    );

    expect(vacated).toEqual([]);
    expect(db.collectionMocks["congressLeaders"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["senateLeadershipElections"]!.updateOne).not.toHaveBeenCalled();
  });

  it("is idempotent: a second pass over the now-vacant seat does nothing", async () => {
    db.collectionMocks["congressLeaders"]!.find.mockImplementation(() =>
      cursorOf([{ role: "president_pro_tempore", characterId: null, characterName: "Vacant" }])
    );

    const { reconcileLeadershipPartyEligibility } = await import("./reconcilePartyEligibility");
    const vacated = await reconcileLeadershipPartyEligibility(
      db as unknown as Db,
      "senate",
      SENATE_CTX,
      NOW
    );

    expect(vacated).toEqual([]);
    expect(db.collectionMocks["senateLeadershipElections"]!.updateOne).not.toHaveBeenCalled();
  });

  it("does nothing when the chamber has no majority party (no composition data)", async () => {
    // Guard against wiping every leadership seat during a bootstrap or a
    // transient empty-composition read.
    const holder = new ObjectId();
    seatLeaders(db, ["president_pro_tempore"], holder, "MAJ");
    seatHolder(db, holder, "senate", "MAJ");

    const emptyCtx = buildChamberLeadershipContext({
      composition: [],
      majorityParty: null,
      majorityBloc: null,
    });

    const { reconcileLeadershipPartyEligibility } = await import("./reconcilePartyEligibility");
    const vacated = await reconcileLeadershipPartyEligibility(
      db as unknown as Db,
      "senate",
      emptyCtx,
      NOW
    );

    expect(vacated).toEqual([]);
    expect(db.collectionMocks["congressLeaders"]!.updateOne).not.toHaveBeenCalled();
  });

  it("leaves a holder who has lost their seat to the seat-loss sweep", async () => {
    // No electedOfficials row: `vacateLeadershipBulkIfLostSeat` owns that case,
    // and a de-seated member must not trigger a party-switch election here.
    const holder = new ObjectId();
    seatLeaders(db, ["president_pro_tempore"], holder, "MAJ");
    seatHolder(db, holder, "senate", null);

    const { reconcileLeadershipPartyEligibility } = await import("./reconcilePartyEligibility");
    const vacated = await reconcileLeadershipPartyEligibility(
      db as unknown as Db,
      "senate",
      SENATE_CTX,
      NOW
    );

    expect(vacated).toEqual([]);
    expect(db.collectionMocks["senateLeadershipElections"]!.updateOne).not.toHaveBeenCalled();
  });

  it("does not re-seed the defector onto the ballot of the election it just opened", async () => {
    const holder = new ObjectId();
    seatLeaders(db, ["majority_whip_senate"], holder, "MAJ");
    seatHolder(db, holder, "senate", "OPP");

    const { reconcileLeadershipPartyEligibility } = await import("./reconcilePartyEligibility");
    await reconcileLeadershipPartyEligibility(db as unknown as Db, "senate", SENATE_CTX, NOW);

    expect(db.collectionMocks["senateLeadershipNominations"]!.insertOne).not.toHaveBeenCalled();
  });

  it("lets only one concurrent pass claim the vacancy and announce it", async () => {
    // Two overlapping page loads both see the defector. The vacate is a
    // conditional update scoped to the holder still being seated, so the loser
    // matches nothing and must not open a second election or post a duplicate
    // notice to the feed.
    const holder = new ObjectId();
    seatLeaders(db, ["president_pro_tempore"], holder, "MAJ");
    seatHolder(db, holder, "senate", "independent");
    db.collectionMocks["congressLeaders"]!.updateOne.mockResolvedValue({ matchedCount: 0 });

    const { reconcileLeadershipPartyEligibility } = await import("./reconcilePartyEligibility");
    const vacated = await reconcileLeadershipPartyEligibility(
      db as unknown as Db,
      "senate",
      SENATE_CTX,
      NOW
    );

    expect(vacated).toEqual([]);
    expect(db.collectionMocks["senateLeadershipElections"]!.updateOne).not.toHaveBeenCalled();
    const { sendCountryGameEvent } = await import("@/lib/discordWebhooks");
    expect(sendCountryGameEvent).not.toHaveBeenCalled();
  });

  it("announces the vacancy to the country feed", async () => {
    const holder = new ObjectId();
    seatLeaders(db, ["president_pro_tempore"], holder, "MAJ");
    seatHolder(db, holder, "senate", "independent");

    const { reconcileLeadershipPartyEligibility } = await import("./reconcilePartyEligibility");
    await reconcileLeadershipPartyEligibility(db as unknown as Db, "senate", SENATE_CTX, NOW);

    const { sendCountryGameEvent } = await import("@/lib/discordWebhooks");
    expect(sendCountryGameEvent).toHaveBeenCalledWith(
      "US",
      expect.objectContaining({
        title: expect.stringContaining("President Pro Tempore"),
        description: expect.stringContaining("Estes Kefauver"),
      })
    );
  });
});

describe("openElectionsForVacatedMajorityRoles", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const name of [
      "senateLeadershipElections",
      "senateLeadershipNominations",
      "houseLeadershipElections",
      "houseLeadershipNominations",
      "congressLeaders",
      "electedOfficials",
      "characters",
    ]) {
      db.collection(name);
    }
    db.collectionMocks["senateLeadershipElections"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["houseLeadershipElections"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["congressLeaders"]!.findOne.mockResolvedValue(null);
  });

  it("opens a 24-turn race for each majority-gated role just vacated", async () => {
    const { openElectionsForVacatedMajorityRoles } = await import("./reconcilePartyEligibility");
    const opened = await openElectionsForVacatedMajorityRoles(
      db as unknown as Db,
      [{ leaderRole: "president_pro_tempore" }, { leaderRole: "majority_whip_senate" }],
      SENATE_CTX_BY_CHAMBER,
      NOW
    );

    expect(opened.sort()).toEqual(["majority_whip_senate", "president_pro_tempore"]);
    expect(db.collectionMocks["senateLeadershipElections"]!.updateOne).toHaveBeenCalledWith(
      { _id: "pro_tempore" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "voting", endsOnTurn: 524 }),
      }),
      { upsert: true }
    );
  });

  it("ignores roles outside the majority-gated set", async () => {
    // Minority leadership, the Speaker, and the DE/CN chairs share the
    // congressLeaders collection but are not this module's business.
    const { openElectionsForVacatedMajorityRoles } = await import("./reconcilePartyEligibility");
    const opened = await openElectionsForVacatedMajorityRoles(
      db as unknown as Db,
      [
        { leaderRole: "minority_leader_senate" },
        { leaderRole: "speaker_of_the_house" },
        { leaderRole: "chair_npcsc" },
      ],
      SENATE_CTX_BY_CHAMBER,
      NOW
    );

    expect(opened).toEqual([]);
    expect(db.collectionMocks["senateLeadershipElections"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["houseLeadershipElections"]!.updateOne).not.toHaveBeenCalled();
  });

  it("does not disturb a race that is already running", async () => {
    db.collectionMocks["senateLeadershipElections"]!.findOne.mockResolvedValue({
      _id: "pro_tempore",
      status: "voting",
      endsOnTurn: 510,
    });

    const { openElectionsForVacatedMajorityRoles } = await import("./reconcilePartyEligibility");
    const opened = await openElectionsForVacatedMajorityRoles(
      db as unknown as Db,
      [{ leaderRole: "president_pro_tempore" }],
      SENATE_CTX_BY_CHAMBER,
      NOW
    );

    expect(opened).toEqual([]);
    expect(db.collectionMocks["senateLeadershipElections"]!.updateOne).not.toHaveBeenCalled();
  });

  it("does nothing when the chamber has no majority party", async () => {
    const { openElectionsForVacatedMajorityRoles } = await import("./reconcilePartyEligibility");
    const opened = await openElectionsForVacatedMajorityRoles(
      db as unknown as Db,
      [{ leaderRole: "president_pro_tempore" }],
      {
        senate: buildChamberLeadershipContext({
          composition: [],
          majorityParty: null,
          majorityBloc: null,
        }),
        house: null,
      },
      NOW
    );

    expect(opened).toEqual([]);
    expect(db.collectionMocks["senateLeadershipElections"]!.updateOne).not.toHaveBeenCalled();
  });

  it("is a no-op when handed no roles, without touching a composition", async () => {
    const { openElectionsForVacatedMajorityRoles } = await import("./reconcilePartyEligibility");
    const opened = await openElectionsForVacatedMajorityRoles(
      db as unknown as Db,
      [],
      { senate: null, house: null },
      NOW
    );

    expect(opened).toEqual([]);
  });
});
