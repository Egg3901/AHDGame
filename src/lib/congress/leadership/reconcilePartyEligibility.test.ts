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
vi.mock("@/lib/db/partyMap", () => ({ getPartyMap: vi.fn().mockResolvedValue(new Map()) }));
vi.mock("@/lib/congress/senateComposition", () => ({ getSenateComposition: vi.fn() }));
vi.mock("@/lib/congress/houseComposition", () => ({ getHouseComposition: vi.fn() }));

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
    // No electedOfficials row: `vacateLeadershipForLostSeats` owns that case,
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

describe("openElectionsForVacatedRoles", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const name of [
      "senateLeadershipElections",
      "senateLeadershipNominations",
      "houseLeadershipElections",
      "houseLeadershipNominations",
      "speakerElections",
      "speakerNominations",
      "congressLeaders",
      "electedOfficials",
      "characters",
    ]) {
      db.collection(name);
    }
    db.collectionMocks["senateLeadershipElections"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["houseLeadershipElections"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["speakerElections"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["congressLeaders"]!.findOne.mockResolvedValue(null);
  });

  it("opens a 24-turn race for each majority-gated role just vacated", async () => {
    const { openElectionsForVacatedRoles } = await import("./reconcilePartyEligibility");
    const opened = await openElectionsForVacatedRoles(
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

  it.each([
    ["president_pro_tempore", "senateLeadershipElections", "pro_tempore"],
    ["majority_leader_senate", "senateLeadershipElections", "majority_leader"],
    ["majority_whip_senate", "senateLeadershipElections", "majority_whip"],
    ["majority_leader_house", "houseLeadershipElections", "majority_leader"],
    ["majority_whip_house", "houseLeadershipElections", "majority_whip"],
  ] as const)("opens %s as %s/%s", async (leaderRole, collection, electionId) => {
    // The canonical role and the per-chamber election id are different
    // vocabularies, and getting the pairing wrong opens a real race under the
    // wrong key — the seat stays vacant while a phantom election runs elsewhere.
    const { openElectionsForVacatedRoles } = await import("./reconcilePartyEligibility");
    await openElectionsForVacatedRoles(
      db as unknown as Db,
      [{ leaderRole }],
      SENATE_CTX_BY_CHAMBER,
      NOW
    );

    expect(db.collectionMocks[collection]!.updateOne).toHaveBeenCalledWith(
      { _id: electionId },
      expect.objectContaining({ $set: expect.objectContaining({ status: "voting" }) }),
      { upsert: true }
    );
  });

  it("opens the Speaker race in its own collection, with both close anchors", async () => {
    // The Speaker keeps a singleton election doc rather than a per-role one.
    // Leaving it out is what let a vacated chair sit with no race at all: the
    // Speaker's own auto-open early-returns once characterId is already null.
    const { openElectionsForVacatedRoles } = await import("./reconcilePartyEligibility");
    const opened = await openElectionsForVacatedRoles(
      db as unknown as Db,
      [{ leaderRole: "speaker_of_the_house", formerHolderName: "Sam Rayburn" }],
      SENATE_CTX_BY_CHAMBER,
      NOW
    );

    expect(opened).toEqual(["speaker_of_the_house"]);
    expect(db.collectionMocks["speakerElections"]!.updateOne).toHaveBeenCalledWith(
      { _id: "current" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "voting", endsOnTurn: 524 }),
      }),
      { upsert: true }
    );
  });

  it("leaves a Speaker race that is already running alone", async () => {
    db.collectionMocks["speakerElections"]!.findOne.mockResolvedValue({
      _id: "current",
      status: "voting",
      endsOnTurn: 510,
    });

    const { openElectionsForVacatedRoles } = await import("./reconcilePartyEligibility");
    const opened = await openElectionsForVacatedRoles(
      db as unknown as Db,
      [{ leaderRole: "speaker_of_the_house" }],
      SENATE_CTX_BY_CHAMBER,
      NOW
    );

    expect(opened).toEqual([]);
    expect(db.collectionMocks["speakerElections"]!.updateOne).not.toHaveBeenCalled();
  });

  it.each([
    ["minority_leader_house", "houseLeadershipElections", "minority_leader"],
    ["minority_whip_house", "houseLeadershipElections", "minority_whip"],
    ["minority_leader_senate", "senateLeadershipElections", "minority_leader"],
    ["minority_whip_senate", "senateLeadershipElections", "minority_whip"],
  ] as const)("opens %s as %s/%s", async (leaderRole, collection, electionId) => {
    // The minority seats were vacated on a party switch like every other role,
    // but nothing reopened them — the same hole the Speaker fell through.
    const { openElectionsForVacatedRoles } = await import("./reconcilePartyEligibility");
    await openElectionsForVacatedRoles(
      db as unknown as Db,
      [{ leaderRole }],
      SENATE_CTX_BY_CHAMBER,
      NOW
    );

    expect(db.collectionMocks[collection]!.updateOne).toHaveBeenCalledWith(
      { _id: electionId },
      expect.objectContaining({ $set: expect.objectContaining({ status: "voting" }) }),
      { upsert: true }
    );
  });

  it("ignores roles whose race is run by another module", async () => {
    // The DE/CN chairs share the congressLeaders collection but keep their own
    // election collections and openers.
    const { openElectionsForVacatedRoles } = await import("./reconcilePartyEligibility");
    const opened = await openElectionsForVacatedRoles(
      db as unknown as Db,
      [{ leaderRole: "chair_npcsc" }, { leaderRole: "chair_cppcc" }],
      SENATE_CTX_BY_CHAMBER,
      NOW
    );

    expect(opened).toEqual([]);
    expect(db.collectionMocks["senateLeadershipElections"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["houseLeadershipElections"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["speakerElections"]!.updateOne).not.toHaveBeenCalled();
  });

  it("does not disturb a race that is already running", async () => {
    db.collectionMocks["senateLeadershipElections"]!.findOne.mockResolvedValue({
      _id: "pro_tempore",
      status: "voting",
      endsOnTurn: 510,
    });

    const { openElectionsForVacatedRoles } = await import("./reconcilePartyEligibility");
    const opened = await openElectionsForVacatedRoles(
      db as unknown as Db,
      [{ leaderRole: "president_pro_tempore" }],
      SENATE_CTX_BY_CHAMBER,
      NOW
    );

    expect(opened).toEqual([]);
    expect(db.collectionMocks["senateLeadershipElections"]!.updateOne).not.toHaveBeenCalled();
  });

  it("does nothing when the chamber has no majority party", async () => {
    const { openElectionsForVacatedRoles } = await import("./reconcilePartyEligibility");
    const opened = await openElectionsForVacatedRoles(
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
    const { openElectionsForVacatedRoles } = await import("./reconcilePartyEligibility");
    const opened = await openElectionsForVacatedRoles(
      db as unknown as Db,
      [],
      { senate: null, house: null },
      NOW
    );

    expect(opened).toEqual([]);
  });
});

describe("vacateRolesLostToPartySwitch", () => {
  let db: MockDb;
  const holder = new ObjectId();

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const name of [
      "senateLeadershipElections",
      "senateLeadershipNominations",
      "houseLeadershipElections",
      "houseLeadershipNominations",
      "speakerElections",
      "speakerNominations",
      "congressLeaders",
      "electedOfficials",
      "characters",
    ]) {
      db.collection(name);
    }
    db.collectionMocks["senateLeadershipElections"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["houseLeadershipElections"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["speakerElections"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["congressLeaders"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["congressLeaders"]!.updateOne.mockResolvedValue({ matchedCount: 1 });

    const { getSenateComposition } = await import("@/lib/congress/senateComposition");
    const { getHouseComposition } = await import("@/lib/congress/houseComposition");
    // A chamber with no coalitions still has a majority bloc: `computeBlocsForCountry`
    // makes every standalone party its own bloc and takes the largest. Mocking it
    // as null would make `non-coalition` admit the majority party itself.
    const composition = {
      composition: [{ party: "MAJ" }, { party: "OPP" }, { party: "THIRD" }],
      majorityParty: "MAJ",
      majorityBloc: {
        kind: "party",
        id: "MAJ",
        displayName: "Democratic Party",
        displayColor: "#000",
        partySlugs: new Set(["MAJ"]),
        seats: 3,
        dominantPartySlug: "MAJ",
        dominantPartySeats: 3,
      },
    } as never;
    vi.mocked(getSenateComposition).mockResolvedValue(composition);
    vi.mocked(getHouseComposition).mockResolvedValue(composition);
  });

  it("leaves the Speaker in the chair, because that office is held on a seat not a party", async () => {
    // This is the bug: a party switch emptied the chair, and nothing refilled it.
    // The Speaker is `any-seated`, so the switch never cost them the office at all.
    const { vacateRolesLostToPartySwitch } = await import("./reconcilePartyEligibility");
    const vacated = await vacateRolesLostToPartySwitch(
      db as unknown as Db,
      [{ leaderRole: "speaker_of_the_house", holderId: holder, formerHolderName: "Sam Rayburn" }],
      "OPP",
      NOW
    );

    expect(vacated).toEqual([]);
    expect(db.collectionMocks["congressLeaders"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["speakerElections"]!.updateOne).not.toHaveBeenCalled();
  });

  it("vacates a majority-gated role the holder has just left the majority party for", async () => {
    const { vacateRolesLostToPartySwitch } = await import("./reconcilePartyEligibility");
    const vacated = await vacateRolesLostToPartySwitch(
      db as unknown as Db,
      [{ leaderRole: "president_pro_tempore", holderId: holder, formerHolderName: "Kefauver" }],
      "OPP",
      NOW
    );

    expect(vacated).toEqual(["president_pro_tempore"]);
    // Scoped to the holder, so two overlapping switches cannot both claim the
    // vacancy and both open a race.
    expect(db.collectionMocks["congressLeaders"]!.updateOne).toHaveBeenCalledWith(
      { role: "president_pro_tempore", characterId: holder },
      expect.objectContaining({
        $set: expect.objectContaining({ characterId: null, characterName: "Vacant" }),
      }),
      { upsert: false }
    );
    expect(db.collectionMocks["senateLeadershipElections"]!.updateOne).toHaveBeenCalledWith(
      { _id: "pro_tempore" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "voting" }) }),
      { upsert: true }
    );
  });

  it("keeps a minority role when the holder moves to another non-majority party", async () => {
    const { vacateRolesLostToPartySwitch } = await import("./reconcilePartyEligibility");
    const vacated = await vacateRolesLostToPartySwitch(
      db as unknown as Db,
      [{ leaderRole: "minority_leader_house", holderId: holder }],
      "THIRD",
      NOW
    );

    expect(vacated).toEqual([]);
    expect(db.collectionMocks["congressLeaders"]!.updateOne).not.toHaveBeenCalled();
  });

  it("vacates a minority role whose holder has joined the majority party", async () => {
    const { vacateRolesLostToPartySwitch } = await import("./reconcilePartyEligibility");
    const vacated = await vacateRolesLostToPartySwitch(
      db as unknown as Db,
      [{ leaderRole: "minority_leader_house", holderId: holder }],
      "MAJ",
      NOW
    );

    expect(vacated).toEqual(["minority_leader_house"]);
    expect(db.collectionMocks["houseLeadershipElections"]!.updateOne).toHaveBeenCalledWith(
      { _id: "minority_leader" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "voting" }) }),
      { upsert: true }
    );
  });

  it("counts the holder's own seat toward the party they are joining", async () => {
    // Whether the chamber composition already shows the new party depends on
    // which caller this is: the party `leave` route relabels the seat row before
    // running the cleanup, while `performRelocation` deliberately runs it first.
    // Without this the same defection keeps the post down one path and loses it
    // down the other. The holder holds a seat, so their new party has one.
    const { vacateRolesLostToPartySwitch } = await import("./reconcilePartyEligibility");
    const vacated = await vacateRolesLostToPartySwitch(
      db as unknown as Db,
      [{ leaderRole: "minority_leader_house", holderId: holder }],
      // "independent" is not in the mocked composition — the seat row has not
      // been relabelled yet.
      "independent",
      NOW
    );

    expect(vacated).toEqual([]);
    expect(db.collectionMocks["congressLeaders"]!.updateOne).not.toHaveBeenCalled();
  });

  it("vacates a party-gated role it has no way to evaluate", async () => {
    // The CN chair is `largest-single-party` but sits in neither US chamber, so
    // there is no context to judge it by. Falling back to the vacate is the
    // behaviour this path had before the eligibility gate existed.
    const { vacateRolesLostToPartySwitch } = await import("./reconcilePartyEligibility");
    const vacated = await vacateRolesLostToPartySwitch(
      db as unknown as Db,
      [{ leaderRole: "chair_cppcc", holderId: holder }],
      "MAJ",
      NOW
    );

    expect(vacated).toEqual(["chair_cppcc"]);
    expect(db.collectionMocks["congressLeaders"]!.updateOne).toHaveBeenCalled();
  });

  it("does not tell the feed a removed holder changed party", async () => {
    // `vacateAllLeadershipRoles` serves bans as well as switches, and a ban is
    // not a party change. Posting one would be a public claim about a player
    // that is simply untrue.
    const { sendCountryGameEvent } = await import("@/lib/discordWebhooks");
    const { vacateAllLeadershipRoles } = await import("./reconcilePartyEligibility");
    await vacateAllLeadershipRoles(
      db as unknown as Db,
      [{ leaderRole: "president_pro_tempore", holderId: holder, formerHolderName: "Kefauver" }],
      NOW,
      { reason: "removal" }
    );

    expect(sendCountryGameEvent).toHaveBeenCalledWith(
      "US",
      expect.objectContaining({ description: expect.not.stringContaining("changed party") })
    );
  });

  it("still vacates party-gated roles when the composition read fails", async () => {
    // Degrading to the old unconditional vacate is the safe direction: an
    // ineligible holder must not keep the office just because a read failed.
    const { getSenateComposition } = await import("@/lib/congress/senateComposition");
    vi.mocked(getSenateComposition).mockRejectedValue(new Error("composition unavailable"));

    const { vacateRolesLostToPartySwitch } = await import("./reconcilePartyEligibility");
    const vacated = await vacateRolesLostToPartySwitch(
      db as unknown as Db,
      [
        { leaderRole: "president_pro_tempore", holderId: holder },
        { leaderRole: "speaker_of_the_house", holderId: holder },
      ],
      "OPP",
      NOW
    );

    expect(vacated).toEqual(["president_pro_tempore"]);
  });
});

describe("buildContextsForRoles", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("fetches only the chambers the given roles need", async () => {
    const { getSenateComposition } = await import("@/lib/congress/senateComposition");
    const { getHouseComposition } = await import("@/lib/congress/houseComposition");
    vi.mocked(getHouseComposition).mockResolvedValue({
      composition: [{ party: "MAJ" }],
      majorityParty: "MAJ",
      majorityBloc: null,
    } as never);

    const { buildContextsForRoles } = await import("./reconcilePartyEligibility");
    const contexts = await buildContextsForRoles(db as unknown as Db, [
      { leaderRole: "majority_whip_house" },
    ]);

    expect(getHouseComposition).toHaveBeenCalled();
    expect(getSenateComposition).not.toHaveBeenCalled();
    expect(contexts.senate).toBeNull();
    expect(contexts.house?.majorityParty).toBe("MAJ");
  });

  it("fetches the House for the Speaker, whose race this module now opens", async () => {
    const { getSenateComposition } = await import("@/lib/congress/senateComposition");
    const { getHouseComposition } = await import("@/lib/congress/houseComposition");
    vi.mocked(getHouseComposition).mockResolvedValue({
      composition: [{ party: "MAJ" }],
      majorityParty: "MAJ",
      majorityBloc: null,
    } as never);

    const { buildContextsForRoles } = await import("./reconcilePartyEligibility");
    const contexts = await buildContextsForRoles(db as unknown as Db, [
      { leaderRole: "speaker_of_the_house" },
    ]);

    expect(getHouseComposition).toHaveBeenCalled();
    expect(getSenateComposition).not.toHaveBeenCalled();
    expect(contexts.house?.majorityParty).toBe("MAJ");
  });

  it("reads no composition at all when every role belongs to another module", async () => {
    const { getSenateComposition } = await import("@/lib/congress/senateComposition");
    const { getHouseComposition } = await import("@/lib/congress/houseComposition");

    const { buildContextsForRoles } = await import("./reconcilePartyEligibility");
    const contexts = await buildContextsForRoles(db as unknown as Db, [
      { leaderRole: "chair_npcsc" },
      { leaderRole: "speaker_of_the_bundestag" },
    ]);

    expect(contexts).toEqual({ house: null, senate: null });
    expect(getHouseComposition).not.toHaveBeenCalled();
    expect(getSenateComposition).not.toHaveBeenCalled();
  });
});

describe("reconcileAllLeadershipPartyEligibility", () => {
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
    db.collectionMocks["congressLeaders"]!.updateOne.mockResolvedValue({ matchedCount: 1 });
  });

  it("judges each chamber against its OWN composition", async () => {
    // Pinned because crossing the two fails SILENTLY. A House leader measured
    // against the Senate's majority reads as "the majority moved under them",
    // which is the one case the reconciler deliberately ignores — so the bug
    // shows up as leadership that never gets reconciled, not as an error. The
    // House holder below is a genuine defector, so a crossed context turns a
    // vacancy into a no-op and this test fails.
    const { getSenateComposition } = await import("@/lib/congress/senateComposition");
    const { getHouseComposition } = await import("@/lib/congress/houseComposition");
    vi.mocked(getSenateComposition).mockResolvedValue({
      composition: [{ party: "SEN_MAJ" }],
      majorityParty: "SEN_MAJ",
      majorityBloc: null,
    } as never);
    vi.mocked(getHouseComposition).mockResolvedValue({
      composition: [{ party: "HOUSE_MAJ" }],
      majorityParty: "HOUSE_MAJ",
      majorityBloc: null,
    } as never);

    const senator = new ObjectId();
    const rep = new ObjectId();
    db.collectionMocks["congressLeaders"]!.find.mockImplementation((query) => {
      const roles = (query as { role?: { $in?: string[] } }).role?.$in ?? [];
      return cursorOf(
        roles.includes("president_pro_tempore")
          ? [
              {
                role: "majority_leader_senate",
                characterId: senator,
                characterName: "Senate Leader",
                party: "SEN_MAJ",
              },
            ]
          : [
              {
                role: "majority_leader_house",
                characterId: rep,
                characterName: "House Leader",
                party: "HOUSE_MAJ",
              },
            ]
      );
    });
    db.collectionMocks["electedOfficials"]!.find.mockImplementation((query) => {
      const officeType = (query as { officeType?: string }).officeType;
      return cursorOf(
        officeType === "senate"
          ? [{ _id: new ObjectId(), officeType, characterId: senator, party: "SEN_MAJ" }]
          : // The House leader has walked out to a third party.
            [{ _id: new ObjectId(), officeType, characterId: rep, party: "DEFECTED" }]
      );
    });
    db.collectionMocks["characters"]!.find.mockImplementation(() =>
      cursorOf([
        { _id: senator, party: "SEN_MAJ" },
        { _id: rep, party: "DEFECTED" },
      ])
    );

    const { reconcileAllLeadershipPartyEligibility } = await import("./reconcilePartyEligibility");
    const vacated = await reconcileAllLeadershipPartyEligibility(db as unknown as Db, NOW);

    // The senator is still in the Senate majority and keeps their seat; the
    // representative left the House majority and loses theirs.
    expect(vacated.map((v) => v.leaderRole)).toEqual(["majority_leader_house"]);
    expect(db.collectionMocks["congressLeaders"]!.updateOne).toHaveBeenCalledWith(
      { role: "majority_leader_house", characterId: rep },
      expect.objectContaining({
        $set: expect.objectContaining({ characterId: null, characterName: "Vacant" }),
      }),
      { upsert: false }
    );
  });
});
