import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type {
  Election,
  ElectionCandidate,
  ElectedOfficial,
  NPP,
  SlateCandidate,
} from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { NPPContext } from "./context";
import { processElectionEntry } from "./electionEntry";

vi.mock("@/lib/events/substrate/rng", () => ({
  makeSeededRng: vi.fn(() => () => 0.5),
}));
import { makeSeededRng } from "@/lib/events/substrate/rng";

function createTestNpp(overrides: Partial<NPP> = {}): NPP {
  return {
    _id: new ObjectId(),
    name: "Test NPP",
    homeState: "CA",
    party: "democrat",
    politicalInfluence: 50,
    favorability: 50,
    policies: { economic: 0, social: 0 },
    currentOffice: { type: "house", state: "CA", seatsHeld: 1 },
    personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
    generatedAt: new Date(),
    retiredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createTestElection(overrides: Partial<Election> = {}): Election {
  return {
    _id: new ObjectId(),
    electionType: "house",
    state: "CA",
    countryId: "US",
    cycle: 1,
    status: "active",
    startTime: new Date(),
    endTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    primaryEndTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Election;
}

function createOfficial(npp: NPP, election: Election): ElectedOfficial {
  const officeType =
    election.electionType === "senate"
      ? "senate"
      : election.electionType === "stateSenate"
        ? "stateSenate"
        : election.electionType === "regionalCouncil"
          ? "regionalCouncil"
          : election.electionType === "sangiin"
            ? "sangiin"
            : "house";
  return {
    _id: new ObjectId(),
    officeType,
    state: election.state,
    senateClass: election.senateClass,
    chamberClass: election.chamberClass,
    district: 1,
    characterId: npp._id,
    characterName: npp.name,
    party: npp.party,
    isNPP: true,
    nppId: npp._id,
    electedAt: new Date(),
    termEnds: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ElectedOfficial;
}

function buildContext(
  db: MockDb,
  election: Election,
  npps: NPP[],
  candidates: ElectionCandidate[],
  incumbentIds: string[] = []
) {
  const officialsByNPP = new Map<string, ElectedOfficial[]>();
  for (const npp of npps) {
    if (incumbentIds.includes(npp._id.toString())) {
      officialsByNPP.set(npp._id.toString(), [createOfficial(npp, election)]);
    }
  }

  const ctx: NPPContext = {
    now: new Date(),
    db: db as unknown as Db,
    allNPPs: npps,
    nppMap: new Map(npps.map((npp) => [npp._id.toString(), npp])),
    openPrimaries: [election],
    nppCandidacies: new Set<string>(),
    candidatesByElection: new Map([[election._id.toString(), [...candidates]]]),
    nppOfficials: [],
    officialsByNPP,
    activeBills: [],
    billWhips: new Map(),
    activeStateBills: [],
    stateBillWhips: new Map(),
    speakerElection: null,
    speakerNominations: [],
    houseLeadershipElections: [],
    houseLeadershipNominations: [],
    senateLeadershipElections: [],
    senateLeadershipNominations: [],
    leadershipWhips: [],
    statePartyOrgs: new Map(),
    partyByCompositeKey: new Map(),
    partyCountries: new Map(),
    legislationTypeMap: new Map(),
    stateDemographicsMap: new Map(),
    statesById: new Map(),
    currentTurn: 0,
  };

  return ctx;
}

describe("processElectionEntry", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("slateCandidates");
    db.collectionMocks.slateCandidates.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
  });

  it("does not abort the whole pass when a candidacy insert hits the active-candidate duplicate-key index", async () => {
    // Reproduces the production crash: an incumbent who already holds an active
    // candidacy in an upcoming election (not tracked) triggers a second active
    // insert → E11000. The pass must swallow it gracefully, not throw.
    const election = createTestElection();
    const incumbent = createTestNpp();

    db.collection("electionCandidates");
    db.collectionMocks.electionCandidates.insertOne.mockRejectedValue(
      Object.assign(
        new Error(
          "E11000 duplicate key error collection: app.electionCandidates index: unique_active_election_candidate_per_character"
        ),
        { code: 11000, keyPattern: { characterId: 1 } }
      )
    );

    const ctx = buildContext(db, election, [incumbent], [], [incumbent._id.toString()]);

    await expect(processElectionEntry(ctx)).resolves.toBeTypeOf("number");
  });

  it("lets an incumbent re-enter their defending primary despite cooldown and same-party player candidate", async () => {
    const election = createTestElection();
    const incumbent = createTestNpp({
      electionCooldowns: {
        [election._id.toString()]: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    const playerCandidate = {
      _id: new ObjectId(),
      electionId: election._id,
      characterId: new ObjectId(),
      characterName: "Player Challenger",
      party: incumbent.party,
      status: "active",
      enteredAt: new Date(),
      isNPP: false,
    } as ElectionCandidate;

    const entered = await processElectionEntry(
      buildContext(db, election, [incumbent], [playerCandidate], [incumbent._id.toString()])
    );

    expect(entered).toBe(1);
    expect(db.collectionMocks.electionCandidates.insertOne).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.electionCandidates.insertOne.mock.calls[0]?.[0]).toMatchObject({
      electionId: election._id,
      characterId: incumbent._id,
      party: incumbent.party,
      isNPP: true,
    });
  });

  it("lets an incumbent re-enter even when a same-party NPP challenger was already active", async () => {
    const election = createTestElection();
    const incumbent = createTestNpp({
      name: "Incumbent",
      electionCooldowns: {
        [election._id.toString()]: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    const priorChallenger = createTestNpp({ name: "Prior Challenger" });
    const challengerCandidate = {
      _id: new ObjectId(),
      electionId: election._id,
      characterId: priorChallenger._id,
      characterName: priorChallenger.name,
      party: incumbent.party,
      status: "active",
      enteredAt: new Date(),
      isNPP: true,
      nppId: priorChallenger._id,
    } as ElectionCandidate;

    const entered = await processElectionEntry(
      buildContext(
        db,
        election,
        [incumbent, priorChallenger],
        [challengerCandidate],
        [incumbent._id.toString()]
      )
    );

    expect(entered).toBe(1);
    expect(db.collectionMocks.electionCandidates.insertOne).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.electionCandidates.insertOne.mock.calls[0]?.[0]).toMatchObject({
      electionId: election._id,
      characterId: incumbent._id,
      characterName: "Incumbent",
    });
  });

  it("only re-enters incumbents into the matching senate class for their state", async () => {
    const classOneElection = createTestElection({
      electionType: "senate",
      state: "WA",
      senateClass: 1,
    });
    const classThreeElection = createTestElection({
      electionType: "senate",
      state: "WA",
      senateClass: 3,
    });
    const incumbent = createTestNpp({
      name: "Class One Senator",
      homeState: "WA",
      currentOffice: { type: "senate", state: "WA", senateClass: 1 },
    });

    const ctx = buildContext(db, classOneElection, [incumbent], [], [incumbent._id.toString()]);
    ctx.openPrimaries = [classThreeElection, classOneElection];
    ctx.candidatesByElection = new Map([
      [classOneElection._id.toString(), []],
      [classThreeElection._id.toString(), []],
    ]);
    ctx.officialsByNPP.set(incumbent._id.toString(), [createOfficial(incumbent, classOneElection)]);

    const entered = await processElectionEntry(ctx);

    expect(entered).toBe(1);
    expect(db.collectionMocks.electionCandidates.insertOne).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.electionCandidates.insertOne.mock.calls[0]?.[0]).toMatchObject({
      electionId: classOneElection._id,
      characterId: incumbent._id,
      characterName: "Class One Senator",
    });
  });

  it("only re-enters incumbents into the matching chamber class for staggered chambers", async () => {
    const classOneElection = createTestElection({
      electionType: "sangiin",
      state: "JP-13",
      countryId: "JP",
      chamberClass: 1,
    });
    const classTwoElection = createTestElection({
      electionType: "sangiin",
      state: "JP-13",
      countryId: "JP",
      chamberClass: 2,
    });
    const incumbent = createTestNpp({
      name: "Class One Councillor",
      homeState: "JP-13",
      countryId: "JP",
      currentOffice: { type: "sangiin", state: "JP-13", chamberClass: 1 },
    });

    const ctx = buildContext(db, classOneElection, [incumbent], [], [incumbent._id.toString()]);
    ctx.openPrimaries = [classTwoElection, classOneElection];
    ctx.candidatesByElection = new Map([
      [classOneElection._id.toString(), []],
      [classTwoElection._id.toString(), []],
    ]);
    ctx.officialsByNPP.set(incumbent._id.toString(), [createOfficial(incumbent, classOneElection)]);

    const entered = await processElectionEntry(ctx);

    expect(entered).toBe(1);
    expect(db.collectionMocks.electionCandidates.insertOne).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.electionCandidates.insertOne.mock.calls[0]?.[0]).toMatchObject({
      electionId: classOneElection._id,
      characterId: incumbent._id,
      characterName: "Class One Councillor",
    });
  });

  it("still files an accepted same-party slate challenger after the incumbent defends", async () => {
    const election = createTestElection();
    const incumbent = createTestNpp({ name: "Incumbent" });
    const challenger = createTestNpp({ name: "Slate Challenger" });

    const acceptedSlateRow = {
      _id: new ObjectId(),
      slateId: new ObjectId(),
      electionId: election._id,
      candidateId: challenger._id,
      candidateType: "npp",
      partyId: challenger.party,
      status: "accepted",
      filedAt: null,
      invitedAt: new Date(),
      updatedAt: new Date(),
    } as SlateCandidate;

    db.collection("elections");
    db.collection("electionCandidates");
    db.collectionMocks.slateCandidates.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([acceptedSlateRow]),
    });
    db.collectionMocks.elections.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([election]),
    });
    db.collectionMocks.electionCandidates.findOne.mockResolvedValue(null);

    const entered = await processElectionEntry(
      buildContext(db, election, [incumbent, challenger], [], [incumbent._id.toString()])
    );

    expect(entered).toBe(2);
    expect(db.collectionMocks.electionCandidates.insertOne).toHaveBeenCalledTimes(2);

    const insertedNames = db.collectionMocks.electionCandidates.insertOne.mock.calls.map(
      (call) => call[0]?.characterName
    );
    expect(insertedNames).toContain("Incumbent");
    expect(insertedNames).toContain("Slate Challenger");
  });

  it("caps same-party slate challengers at one alongside a defending incumbent", async () => {
    const election = createTestElection();
    const incumbent = createTestNpp({ name: "Incumbent" });
    const firstChallenger = createTestNpp({ name: "First Slate Challenger" });
    const secondChallenger = createTestNpp({ name: "Second Slate Challenger" });

    const acceptedRows = [
      {
        _id: new ObjectId(),
        slateId: new ObjectId(),
        electionId: election._id,
        candidateId: firstChallenger._id,
        candidateType: "npp",
        partyId: incumbent.party,
        status: "accepted",
        filedAt: null,
        invitedAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
      },
      {
        _id: new ObjectId(),
        slateId: new ObjectId(),
        electionId: election._id,
        candidateId: secondChallenger._id,
        candidateType: "npp",
        partyId: incumbent.party,
        status: "accepted",
        filedAt: null,
        invitedAt: new Date("2026-01-03T00:00:00Z"),
        updatedAt: new Date("2026-01-04T00:00:00Z"),
      },
    ] as SlateCandidate[];

    db.collection("elections");
    db.collection("electionCandidates");
    db.collectionMocks.slateCandidates.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(acceptedRows),
    });
    db.collectionMocks.elections.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([election]),
    });
    db.collectionMocks.electionCandidates.findOne.mockResolvedValue(null);

    const entered = await processElectionEntry(
      buildContext(
        db,
        election,
        [incumbent, firstChallenger, secondChallenger],
        [],
        [incumbent._id.toString()]
      )
    );

    expect(entered).toBe(2);
    expect(db.collectionMocks.electionCandidates.insertOne).toHaveBeenCalledTimes(2);

    const insertedNames = db.collectionMocks.electionCandidates.insertOne.mock.calls.map(
      (call) => call[0]?.characterName
    );
    expect(insertedNames).toContain("Incumbent");
    expect(insertedNames).toContain("Second Slate Challenger");
    expect(insertedNames).not.toContain("First Slate Challenger");
  });

  it("reserves an autonomous presidential candidate before regional races consume the pool", async () => {
    const president = createTestElection({
      countryId: "NG",
      electionType: "president",
      state: "NG",
    });
    const house = createTestElection({
      countryId: "NG",
      electionType: "house",
      state: "NORTH_WEST",
    });
    const npp = createTestNpp({
      countryId: "NG",
      homeState: "NORTH_WEST",
      party: "1",
      currentOffice: null,
    });

    db.collection("gameState");
    db.collection("countryGameStates");
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      nppAutonomyEnabled: true,
      nppAutonomyLevel: "v4",
    });
    db.collectionMocks.countryGameStates.findOne.mockResolvedValue({
      _id: "NG",
      enabledForPlayers: false,
      status: "beta",
    });

    const ctx = buildContext(db, house, [npp], []);
    ctx.openPrimaries = [house, president];
    ctx.candidatesByElection = new Map([
      [house._id.toString(), []],
      [president._id.toString(), []],
    ]);
    ctx.nppElectionEligiblePartyKeys = new Set(["NG:1"]);

    const entered = await processElectionEntry(ctx);

    expect(entered).toBe(1);
    expect(db.collectionMocks.electionCandidates.insertOne).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.electionCandidates.insertOne.mock.calls[0]?.[0]).toMatchObject({
      electionId: president._id,
      characterId: npp._id,
      countryId: "NG",
      party: "1",
    });
  });

  it("files an Irish NPP for the nationwide uachtaran primary", async () => {
    const uachtaran = createTestElection({
      countryId: "IE",
      electionType: "uachtaran",
      state: "IE",
    });
    const npp = createTestNpp({
      countryId: "IE",
      homeState: "DUB",
      party: "fianna_fail",
      currentOffice: null,
    });

    const ctx = buildContext(db, uachtaran, [npp], []);
    ctx.openPrimaries = [uachtaran];
    ctx.candidatesByElection = new Map([[uachtaran._id.toString(), []]]);
    ctx.nppElectionEligiblePartyKeys = new Set(["IE:fianna_fail"]);

    const entered = await processElectionEntry(ctx);

    expect(entered).toBe(1);
    expect(db.collectionMocks.electionCandidates.insertOne).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.electionCandidates.insertOne.mock.calls[0]?.[0]).toMatchObject({
      electionId: uachtaran._id,
      characterId: npp._id,
      countryId: "IE",
      party: "fianna_fail",
    });
  });
});

describe("processElectionEntry — OPS regime gating", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("slateCandidates");
    db.collectionMocks.slateCandidates.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    // Eagerly create the electionCandidates collection mock so the
    // "not.toHaveBeenCalled" assertion can read .insertOne even when the
    // production code never reaches the insert call (banned/independent paths).
    db.collection("electionCandidates");
  });

  function buildOpsContext(
    db: MockDb,
    election: Election,
    npp: NPP,
    nppPartyRegimeStatus: "ruling" | "approved" | "banned" | null | undefined,
    countryId: "CN" | "US" = "CN"
  ) {
    const ctx = buildContext(db, election, [npp], []);
    // partyByCompositeKey only carries an entry when the NPP has a recognised
    // party affiliation — independents (no entry) resolve to `undefined`.
    if (nppPartyRegimeStatus !== undefined) {
      ctx.partyByCompositeKey.set(`${countryId}:${npp.party}`, {
        regimeStatus: nppPartyRegimeStatus,
        // Other fields are unused by the gate; cast to satisfy the type.
      } as never);
    }
    return ctx;
  }

  it("skips a banned-party NPP in a CN primary", async () => {
    const election = createTestElection({
      countryId: "CN",
      electionType: "npcDelegate",
      state: "DB",
    });
    const npp = createTestNpp({
      countryId: "CN",
      homeState: "DB",
      party: "3",
      currentOffice: null,
    });
    const ctx = buildOpsContext(db, election, npp, "banned");

    const entered = await processElectionEntry(ctx);
    expect(entered).toBe(0);
    expect(db.collectionMocks.electionCandidates.insertOne).not.toHaveBeenCalled();
  });

  it("skips an independent NPP (no party doc) in a CN primary", async () => {
    const election = createTestElection({
      countryId: "CN",
      electionType: "npcDelegate",
      state: "DB",
    });
    const npp = createTestNpp({
      countryId: "CN",
      homeState: "DB",
      party: "independent",
      currentOffice: null,
    });
    // No party doc registered in partyByCompositeKey — independent.
    const ctx = buildOpsContext(db, election, npp, undefined);

    const entered = await processElectionEntry(ctx);
    expect(entered).toBe(0);
    expect(db.collectionMocks.electionCandidates.insertOne).not.toHaveBeenCalled();
  });

  it("allows a ruling-party NPP in a CN primary", async () => {
    const election = createTestElection({
      countryId: "CN",
      electionType: "npcDelegate",
      state: "DB",
    });
    const npp = createTestNpp({
      countryId: "CN",
      homeState: "DB",
      party: "1",
      currentOffice: null,
    });
    const ctx = buildOpsContext(db, election, npp, "ruling");

    const entered = await processElectionEntry(ctx);
    expect(entered).toBe(1);
    expect(db.collectionMocks.electionCandidates.insertOne).toHaveBeenCalledTimes(1);
  });

  it("allows an approved-party NPP in a CN primary", async () => {
    const election = createTestElection({
      countryId: "CN",
      electionType: "npcDelegate",
      state: "DB",
    });
    const npp = createTestNpp({
      countryId: "CN",
      homeState: "DB",
      party: "2",
      currentOffice: null,
    });
    const ctx = buildOpsContext(db, election, npp, "approved");

    const entered = await processElectionEntry(ctx);
    expect(entered).toBe(1);
    expect(db.collectionMocks.electionCandidates.insertOne).toHaveBeenCalledTimes(1);
  });

  it("still lets an independent NPP enter a US primary (gate is no-op for non-OPS)", async () => {
    const election = createTestElection({
      countryId: "US",
      electionType: "house",
      state: "CA",
    });
    const npp = createTestNpp({
      countryId: "US",
      homeState: "CA",
      party: "independent",
      currentOffice: null,
    });
    const ctx = buildOpsContext(db, election, npp, undefined, "US");

    const entered = await processElectionEntry(ctx);
    expect(entered).toBe(1);
    expect(db.collectionMocks.electionCandidates.insertOne).toHaveBeenCalledTimes(1);
  });
});

describe("processElectionEntry — v3 ambitious challenger pass", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(makeSeededRng).mockReturnValue(() => 0.5);
    db = createMockDb();
    db.collection("slateCandidates");
    db.collectionMocks.slateCandidates.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collection("electionCandidates");
  });

  function buildChallengerScenario() {
    const election = createTestElection({ countryId: "US", electionType: "house", state: "CA" });
    const existingNpp = createTestNpp({ homeState: "CA", party: "democrat", currentOffice: null });
    const challengerNpp = createTestNpp({
      homeState: "CA",
      party: "democrat",
      currentOffice: null,
    });
    const existingCandidate = {
      _id: new ObjectId(),
      electionId: election._id,
      countryId: "US",
      characterId: existingNpp._id,
      characterName: existingNpp.name,
      party: "democrat",
      status: "active",
      support: 50,
      enteredAt: new Date(),
      isNPP: true,
      nppId: existingNpp._id,
    } as ElectionCandidate;

    const ctx = buildContext(db, election, [existingNpp, challengerNpp], [existingCandidate]);
    return { ctx, existingNpp, challengerNpp };
  }

  it("adds a second same-party challenger when v3 is active, exactly one candidate exists, and the roll succeeds", async () => {
    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue({ nppAutonomyLevel: "v3" });
    vi.mocked(makeSeededRng).mockReturnValue(() => 0); // guaranteed success

    const { ctx, challengerNpp } = buildChallengerScenario();
    const entered = await processElectionEntry(ctx);

    expect(entered).toBe(1);
    expect(db.collectionMocks.electionCandidates.insertOne).toHaveBeenCalledTimes(1);
    const inserted = db.collectionMocks.electionCandidates.insertOne.mock.calls[0][0];
    expect(inserted.characterId).toEqual(challengerNpp._id);
    expect(inserted.party).toBe("democrat");
  });

  it("does not add a challenger when autonomy is below v3", async () => {
    // No gameState mock override — default findOne resolves null, so the
    // configured level is "off" and the v3 gate never opens.
    vi.mocked(makeSeededRng).mockReturnValue(() => 0); // would succeed if the gate were open

    const { ctx } = buildChallengerScenario();
    const entered = await processElectionEntry(ctx);

    expect(entered).toBe(0);
    expect(db.collectionMocks.electionCandidates.insertOne).not.toHaveBeenCalled();
  });

  it("does not add a challenger when v3 is active but the roll fails", async () => {
    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue({ nppAutonomyLevel: "v3" });
    vi.mocked(makeSeededRng).mockReturnValue(() => 0.99); // guaranteed failure (max prob 0.225)

    const { ctx } = buildChallengerScenario();
    const entered = await processElectionEntry(ctx);

    expect(entered).toBe(0);
    expect(db.collectionMocks.electionCandidates.insertOne).not.toHaveBeenCalled();
  });

  it("does not add a second challenger when a primary is already contested (2 active candidates)", async () => {
    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue({ nppAutonomyLevel: "v3" });
    vi.mocked(makeSeededRng).mockReturnValue(() => 0); // would succeed if attempted

    const election = createTestElection({ countryId: "US", electionType: "house", state: "CA" });
    const npp1 = createTestNpp({ homeState: "CA", party: "democrat", currentOffice: null });
    const npp2 = createTestNpp({ homeState: "CA", party: "democrat", currentOffice: null });
    const npp3 = createTestNpp({ homeState: "CA", party: "democrat", currentOffice: null });
    const mkCandidate = (npp: NPP) =>
      ({
        _id: new ObjectId(),
        electionId: election._id,
        countryId: "US",
        characterId: npp._id,
        characterName: npp.name,
        party: "democrat",
        status: "active",
        support: 50,
        enteredAt: new Date(),
        isNPP: true,
        nppId: npp._id,
      }) as ElectionCandidate;

    const ctx = buildContext(
      db,
      election,
      [npp1, npp2, npp3],
      [mkCandidate(npp1), mkCandidate(npp2)]
    );
    const entered = await processElectionEntry(ctx);

    expect(entered).toBe(0);
    expect(db.collectionMocks.electionCandidates.insertOne).not.toHaveBeenCalled();
  });

  it("challenges a lone PLAYER candidate at most once, never repeatedly", async () => {
    // A player candidate carries no `nppId`. The pool filter excludes the
    // sitting candidate by comparing NPP ids against it — which silently
    // excluded nothing when the value was undefined. Latent while the pass was
    // scoped to NPP-only countries; live the moment v4 lets it into a player
    // country. The player is still challengeable (an unopposed primary forever
    // is not a game) but exactly once, tracked by the challenger budget.
    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue({ nppAutonomyLevel: "v3" });
    vi.mocked(makeSeededRng).mockReturnValue(() => 0); // guaranteed success

    const election = createTestElection({ countryId: "US", electionType: "house", state: "CA" });
    const challenger1 = createTestNpp({ homeState: "CA", party: "democrat", currentOffice: null });
    const challenger2 = createTestNpp({ homeState: "CA", party: "democrat", currentOffice: null });

    const playerCandidate = {
      _id: new ObjectId(),
      electionId: election._id,
      countryId: "US",
      characterId: new ObjectId(),
      characterName: "Human Player",
      party: "democrat",
      status: "active",
      support: 50,
      enteredAt: new Date(),
      // No isNPP, no nppId — this is a human.
    } as ElectionCandidate;

    const ctx = buildContext(db, election, [challenger1, challenger2], [playerCandidate]);
    const entered = await processElectionEntry(ctx);

    expect(entered).toBeLessThanOrEqual(1);
    expect(db.collectionMocks.electionCandidates.insertOne.mock.calls.length).toBeLessThanOrEqual(
      1
    );
  });
});
