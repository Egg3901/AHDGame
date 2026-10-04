/**
 * Route tests for POST /api/elections/[id]/enter.
 *
 * Initial scope: OPS filing gates (banned-party and independent
 * rejections) added by the 2026-05-27 OPS general-elections work.
 * Other route paths (auth, rate-limit, term-limit, home-state,
 * campaign-creation, etc.) are not covered here — they live behind
 * heavier integration tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { RUSSIAN_COUNCIL_SUBJECTS_1993 } from "@/lib/countries/ru/data/councilSubjects1993";
import { BG_1990_CONSTITUENCIES } from "@/lib/countries/bg/data/foundingDistricts1990";
import { buildBgFoundingSlates } from "@/lib/countries/bg/rules/foundingSlates1990";
import { projectBgFoundingBallots } from "@/lib/countries/bg/rules/foundingBallots1990";
import { countBgFoundingElection } from "@/lib/countries/bg/rules/foundingCount1990";

vi.mock("@/lib/db/runRequiredTransaction", () => ({
  runRequiredTransaction: vi.fn(async (body) => body({ inTransaction: () => true })),
}));

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
  ELECTION_LIMITS: { maxRequests: 100, windowMs: 60_000 },
}));
vi.mock("@/lib/api/requestLog", () => ({ logRequest: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({ effectiveNow: new Date("2026-04-01T00:00:00Z") }),
}));
vi.mock("@/lib/elections/electionParamResolution", () => ({
  resolveElectionRouteParam: vi.fn(),
}));
vi.mock("@/lib/elections/activeCandidacy", () => ({
  findBlockingActiveCandidacy: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/elections/executiveTermLimits", () => ({
  hasReachedExecutiveTermLimit: vi.fn().mockReturnValue(false),
}));
vi.mock("@/lib/campaigns/createInitialCampaign", () => ({
  createInitialCampaign: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/campaigns/isCampaignEligible", () => ({
  isCampaignEligibleElection: vi.fn().mockReturnValue(false),
}));
vi.mock("@/lib/elections/duplicateKey", () => ({
  isActiveElectionCandidateDuplicateKey: vi.fn().mockReturnValue(false),
  isActiveJapanShugiinNominationDuplicateKey: vi.fn((error: unknown) => {
    if (typeof error !== "object" || error === null || !("keyPattern" in error)) return false;
    const keyPattern = error.keyPattern as Record<string, unknown>;
    return Boolean(keyPattern.constituencyId || keyPattern.japanShugiinListOrder);
  }),
}));

import { POST } from "./route";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { resolveElectionRouteParam } from "@/lib/elections/electionParamResolution";

function makeReq(): Request {
  return new Request("http://test/route", { method: "POST" });
}

function emptyFindCursor() {
  const cursor = {
    toArray: vi.fn().mockResolvedValue([]),
    sort: vi.fn(),
    limit: vi.fn(),
    next: vi.fn().mockResolvedValue(null),
  };
  cursor.sort.mockReturnValue(cursor);
  cursor.limit.mockReturnValue(cursor);
  return cursor;
}

interface SetupOpts {
  electionCountry: "CN" | "US";
  characterCountry: "CN" | "US";
  characterParty: string | null;
  partyDocReturn: { regimeStatus: "ruling" | "approved" | "banned" | null } | null;
  pendingResidenceId?: string;
}

const electionOid = new ObjectId();
const characterOid = new ObjectId();

function setupScenario(opts: SetupOpts): MockDb {
  const db = createMockDb();
  // Eagerly create the collection mocks the route reaches.
  db.collection("politicalParties");
  db.collection("characters");
  db.collection("electionCandidates");

  db.collectionMocks.politicalParties.findOne.mockResolvedValue(opts.partyDocReturn);
  db.collectionMocks.characters.findOne.mockResolvedValue(null); // not a president
  db.collectionMocks.electionCandidates.findOne.mockResolvedValue(null);
  db.collectionMocks.electionCandidates.find.mockReturnValue(emptyFindCursor());
  db.collectionMocks.electionCandidates.insertOne.mockResolvedValue({
    insertedId: new ObjectId(),
    acknowledged: true,
  });

  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const election = {
    _id: electionOid,
    countryId: opts.electionCountry,
    electionType: opts.electionCountry === "CN" ? "npcDelegate" : "house",
    state: opts.electionCountry === "CN" ? "DB" : "CA",
    status: "active",
    primaryEndTime: new Date(Date.now() + 86_400_000),
    durationHours: 96,
  };
  vi.mocked(resolveElectionRouteParam).mockResolvedValue({ ok: true, election } as never);

  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: {
      userId: "u1",
      character: {
        _id: characterOid,
        countryId: opts.characterCountry,
        homeState: opts.electionCountry === "CN" ? "DB" : "CA",
        party: opts.characterParty,
        policies: { economic: 0, social: 0 },
        favorability: 50,
        politicalInfluence: 10,
        careerHistory: [],
        executiveTermsServed: 0,
        ...(opts.pendingResidenceId
          ? { federationPendingResidenceId: opts.pendingResidenceId }
          : {}),
      },
    },
  } as never);

  return db;
}

describe("POST /api/elections/[id]/enter — OPS filing gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("blocks protected relocation filing before database work or campaign creation", async () => {
    const db = setupScenario({
      electionCountry: "US",
      characterCountry: "US",
      characterParty: "1",
      partyDocReturn: null,
      pendingResidenceId: "settlement-application",
    });
    const response = await POST(makeReq(), {
      params: Promise.resolve({ id: electionOid.toHexString() }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Choose a playable residence before entering an election.",
    });
    expect(getDb).not.toHaveBeenCalled();
    expect(db.collectionMocks.electionCandidates.insertOne).not.toHaveBeenCalled();
  });

  it("returns 403 when a banned-party character files in CN", async () => {
    setupScenario({
      electionCountry: "CN",
      characterCountry: "CN",
      characterParty: "3",
      partyDocReturn: { regimeStatus: "banned" },
    });
    const res = await POST(makeReq(), {
      params: Promise.resolve({ id: electionOid.toString() }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/banned/i);
  });

  it("returns 403 when an independent character files in CN", async () => {
    setupScenario({
      electionCountry: "CN",
      characterCountry: "CN",
      characterParty: "independent",
      partyDocReturn: null,
    });
    const res = await POST(makeReq(), {
      params: Promise.resolve({ id: electionOid.toString() }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/independent|recognised party/i);
  });

  it("allows an approved-party character past the OPS gate in CN", async () => {
    // The route may still fail downstream (e.g. campaign creation) — we only
    // assert the OPS-gate didn't fire (no 403 with the OPS error messages).
    setupScenario({
      electionCountry: "CN",
      characterCountry: "CN",
      characterParty: "2",
      partyDocReturn: { regimeStatus: "approved" },
    });
    const res = await POST(makeReq(), {
      params: Promise.resolve({ id: electionOid.toString() }),
    });
    // The OPS gate must not have rejected us. Either 200 OK or a downstream
    // failure unrelated to regime status is acceptable here; the assertion
    // is specifically that we didn't get the OPS 403 messages.
    if (res.status === 403) {
      const body = (await res.json()) as { error: string };
      expect(body.error).not.toMatch(/banned|independent|recognised party/i);
    } else {
      expect(res.status).toBe(200);
    }
  });

  it("allows an independent past the OPS gate in US (gate is no-op for non-OPS)", async () => {
    setupScenario({
      electionCountry: "US",
      characterCountry: "US",
      characterParty: "independent",
      partyDocReturn: null,
    });
    const res = await POST(makeReq(), {
      params: Promise.resolve({ id: electionOid.toString() }),
    });
    if (res.status === 403) {
      const body = (await res.json()) as { error: string };
      expect(body.error).not.toMatch(/banned|independent|recognised party/i);
    } else {
      expect(res.status).toBe(200);
    }
  });
});

describe("POST /api/elections/[id]/enter — Senate class re-election restriction", () => {
  const senateElectionOid = new ObjectId();
  const senatorCharOid = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupSenateScenario(opts: {
    electionSenateClass: 1 | 2 | 3;
    heldOffice: { type: string; state?: string; senateClass?: 1 | 2 | 3 } | null;
  }): void {
    const db = createMockDb();
    db.collection("politicalParties");
    db.collection("characters");
    db.collection("electionCandidates");
    db.collectionMocks.politicalParties.findOne.mockResolvedValue(null);
    db.collectionMocks.characters.findOne.mockResolvedValue(null);
    db.collectionMocks.electionCandidates.findOne.mockResolvedValue(null);
    db.collectionMocks.electionCandidates.find.mockReturnValue(emptyFindCursor());
    db.collectionMocks.electionCandidates.insertOne.mockResolvedValue({
      insertedId: new ObjectId(),
      acknowledged: true,
    });
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const election = {
      _id: senateElectionOid,
      countryId: "US",
      electionType: "senate",
      state: "CA",
      senateClass: opts.electionSenateClass,
      status: "active",
      primaryEndTime: new Date(Date.now() + 86_400_000),
      durationHours: 96,
    };
    vi.mocked(resolveElectionRouteParam).mockResolvedValue({ ok: true, election } as never);

    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: "u1",
        character: {
          _id: senatorCharOid,
          countryId: "US",
          homeState: "CA",
          party: "1",
          currentOffice: opts.heldOffice,
          policies: { economic: 0, social: 0 },
          favorability: 50,
          politicalInfluence: 10,
          careerHistory: [],
          executiveTermsServed: 0,
        },
      },
    } as never);
  }

  it("returns 403 when a seated Class II Senator files for a different Senate class", async () => {
    setupSenateScenario({
      electionSenateClass: 3,
      heldOffice: { type: "senate", state: "CA", senateClass: 2 },
    });
    const res = await POST(makeReq(), {
      params: Promise.resolve({ id: senateElectionOid.toString() }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/may only run for re-election/i);
  });

  it("allows a seated Class II Senator to file for re-election to Class II", async () => {
    setupSenateScenario({
      electionSenateClass: 2,
      heldOffice: { type: "senate", state: "CA", senateClass: 2 },
    });
    const res = await POST(makeReq(), {
      params: Promise.resolve({ id: senateElectionOid.toString() }),
    });
    if (res.status === 403) {
      const body = (await res.json()) as { error: string };
      expect(body.error).not.toMatch(/may only run for re-election/i);
    } else {
      expect(res.status).toBe(200);
    }
  });

  it("allows a character who holds no Senate seat to file for any Senate class", async () => {
    setupSenateScenario({ electionSenateClass: 1, heldOffice: null });
    const res = await POST(makeReq(), {
      params: Promise.resolve({ id: senateElectionOid.toString() }),
    });
    if (res.status === 403) {
      const body = (await res.json()) as { error: string };
      expect(body.error).not.toMatch(/may only run for re-election/i);
    } else {
      expect(res.status).toBe(200);
    }
  });
});

describe("POST /api/elections/[id]/enter — UK regional party geography", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets an SNP character file in London now that geography is not a gate", async () => {
    const db = setupScenario({
      electionCountry: "US",
      characterCountry: "US",
      characterParty: "3",
      partyDocReturn: { regimeStatus: null },
    });
    db.collectionMocks.politicalParties.findOne.mockResolvedValue({
      sequentialId: 3,
      name: "Scottish National Party",
      abbreviation: "SNP",
    });
    vi.mocked(resolveElectionRouteParam).mockResolvedValue({
      ok: true,
      election: {
        _id: electionOid,
        countryId: "UK",
        electionType: "commons",
        state: "LON",
        status: "active",
        primaryEndTime: new Date(Date.now() + 86_400_000),
        durationHours: 96,
      },
    } as never);
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: "u1",
        character: {
          _id: characterOid,
          countryId: "UK",
          homeState: "LON",
          party: "3",
          policies: { economic: -2, social: -2 },
          favorability: 50,
          politicalInfluence: 10,
          careerHistory: [],
          executiveTermsServed: 0,
        },
      },
    } as never);

    const res = await POST(makeReq(), {
      params: Promise.resolve({ id: electionOid.toString() }),
    });
    expect(res.status).not.toBe(403);
    if (res.status >= 400) {
      const body = (await res.json()) as { error: string };
      expect(body.error).not.toMatch(/home nation/i);
    }
  });

  it("returns 403 when a sitting Commons MP files for a by-election in their own region", async () => {
    setupScenario({
      electionCountry: "US",
      characterCountry: "US",
      characterParty: "3",
      partyDocReturn: { regimeStatus: null },
    });
    vi.mocked(resolveElectionRouteParam).mockResolvedValue({
      ok: true,
      election: {
        _id: electionOid,
        countryId: "UK",
        electionType: "special_commons",
        state: "LON",
        status: "active",
        primaryEndTime: new Date(Date.now() + 86_400_000),
        durationHours: 96,
      },
    } as never);
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: "u1",
        character: {
          _id: characterOid,
          countryId: "UK",
          homeState: "LON",
          party: "3",
          policies: { economic: -2, social: -2 },
          favorability: 50,
          politicalInfluence: 10,
          careerHistory: [],
          executiveTermsServed: 0,
          currentOffice: { type: "commons", state: "LON" },
        },
      },
    } as never);

    const res = await POST(makeReq(), {
      params: Promise.resolve({ id: electionOid.toString() }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/already hold a Commons seat/);
  });
});

describe("Bound first-Duma filing", () => {
  const cohortId = new ObjectId();
  beforeEach(() => {
    vi.clearAllMocks();
  });
  async function setupDuma(tier: "list" | "constituency" = "list", party = "1") {
    const db = setupScenario({
      electionCountry: "US",
      characterCountry: "US",
      characterParty: party,
      partyDocReturn: null,
    });
    db.collection("gameState");
    db.collectionMocks.politicalParties.findOne.mockResolvedValue({
      _id: new ObjectId(),
      countryId: "RU",
      sequentialId: 1,
      regimeStatus: null,
    });
    db.collection("countryGameStates");
    db.collection("countryState");
    db.collectionMocks.countryState.findOne.mockResolvedValue({
      _id: "RU",
      governmentType: "parliamentaryRepublic",
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      preset: "1991-default",
    });
    db.collectionMocks.countryGameStates.findOne.mockResolvedValue({
      _id: "RU",
      ruSovietSuccessionSinceTurn: 48,
      ruFederalAssemblyMandateSinceTurn: 129,
      ruFirstDumaElectionCohortId: cohortId,
    });
    const { getGameTime } = await import("@/lib/time/gameTime");
    vi.mocked(getGameTime).mockResolvedValue({
      effectiveNow: new Date(1000),
      currentTurn: 130,
    } as never);
    const election = {
      _id: electionOid,
      countryId: "RU",
      electionType: "dumaDeputy",
      status: "active",
      primaryEndTurn: 139,
      primaryEndTime: new Date(10000),
      state: tier === "list" ? "RU" : "CEN",
      seatId: tier === "list" ? "RU-duma-national-list" : "RU-duma-CEN-1",
      totalSeats: tier === "list" ? 225 : 1,
      russianDumaRound: { cohortId, mandateSinceTurn: 129, tier, registeredVoters: 10000 },
    };
    vi.mocked(resolveElectionRouteParam).mockResolvedValue({ ok: true, election } as never);
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: "duma-player",
        character: {
          _id: characterOid,
          countryId: "RU",
          homeState: "CEN",
          name: "Duma player",
          party,
          careerHistory: [],
          executiveTermsServed: 0,
        },
      },
    } as never);
    return { db, election };
  }
  it("admits a Russian regional resident to the national list with a frozen one-seat nomination", async () => {
    const { db } = await setupDuma();
    const res = await POST(makeReq(), {
      params: Promise.resolve({ id: electionOid.toHexString() }),
    });
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(db.collectionMocks.electionCandidates.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        countryId: "RU",
        characterId: characterOid,
        russianDumaNomination: { registrationOrder: 1000, nominationOrder: 1000, capacity: 1 },
      })
    );
  });
  it.each(["list", "constituency"] as const)(
    "rejects a certified unseated Council winner before Duma %s filing side effects",
    async (tier) => {
      const { db } = await setupDuma(tier);
      const councilId = new ObjectId();
      const country = await db.collectionMocks.countryGameStates.findOne();
      country.ruFirstCouncilElectionCohortId = councilId;
      db.collection("russianCouncilElectionResults").findOne.mockResolvedValue({
        result: [{ winners: [{ ownerId: characterOid.toHexString(), isNpc: false }] }],
      });
      const res = await POST(makeReq(), {
        params: Promise.resolve({ id: electionOid.toHexString() }),
      });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toContain("Council mandate");
      expect(db.collectionMocks.electionCandidates.insertOne).not.toHaveBeenCalled();
      expect(db.collectionMocks.electionCandidates.updateOne).not.toHaveBeenCalled();
      expect(db.collectionMocks.electionCandidates.updateMany).not.toHaveBeenCalled();
    }
  );
  it.each(["eligible", "winner", "missing-journal", "wrong-ballot", "wrong-predecessor"])(
    "checks %s repeat filing against immutable generation lineage",
    async (reason) => {
      const { db, election } = await setupDuma("constituency");
      const roundId = new ObjectId();
      Object.assign(election.russianDumaRound, {
        cohortId: roundId,
        rootCohortId: cohortId,
        generation: 1,
      });
      db.collection("russianDumaRepeatOpenings");
      db.collection("russianDumaElectionResults");
      db.collectionMocks.russianDumaRepeatOpenings.findOne.mockResolvedValue(
        reason === "missing-journal"
          ? null
          : {
              rootCohortId: cohortId,
              cohortId: roundId,
              generation: 1,
              mandateSinceTurn: 129,
              previousResultId: cohortId.toHexString(),
              electionIds: [reason === "wrong-ballot" ? new ObjectId() : electionOid],
              seatIds: [election.seatId],
            }
      );
      db.collectionMocks.russianDumaElectionResults.findOne.mockResolvedValue({
        countryId: "RU",
        preset: "1991-default",
        cohortId: reason === "wrong-predecessor" ? new ObjectId() : cohortId,
        mandateSinceTurn: 129,
        result: {
          constituencyResults:
            reason === "winner"
              ? [{ winner: { isNpc: false, ownerId: characterOid.toHexString() } }]
              : [],
        },
      });
      const response = await POST(makeReq(), {
        params: Promise.resolve({ id: electionOid.toHexString() }),
      });
      expect(response.status, JSON.stringify(await response.clone().json())).toBe(
        reason === "eligible" ? 200 : 403
      );
      if (reason === "eligible")
        expect(db.collectionMocks.electionCandidates.insertOne).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ characterId: characterOid })
        );
      else {
        expect(db.collectionMocks.electionCandidates.insertOne).not.toHaveBeenCalled();
        if (reason === "winner")
          expect((await response.json()).error).toMatch(
            /already hold a certified Duma constituency/
          );
      }
    }
  );
  it("rejects an unbound cohort before inserting any candidate", async () => {
    const { db, election } = await setupDuma();
    election.russianDumaRound.cohortId = new ObjectId();
    const res = await POST(makeReq(), {
      params: Promise.resolve({ id: electionOid.toHexString() }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/ratified constitutional mandate/);
    expect(db.collectionMocks.electionCandidates.insertOne).not.toHaveBeenCalled();
  });
  it.each(["missing", "banned", "foreign", "malformed-id"])(
    "rejects a %s national list association",
    async (reason) => {
      const { db } = await setupDuma("list", reason === "malformed-id" ? "1x" : "1");
      db.collectionMocks.politicalParties.findOne.mockResolvedValue(
        reason === "missing"
          ? null
          : {
              _id: new ObjectId(),
              countryId: reason === "foreign" ? "PL" : "RU",
              sequentialId: 1,
              regimeStatus: reason === "banned" ? "banned" : null,
            }
      );
      const res = await POST(makeReq(), {
        params: Promise.resolve({ id: electionOid.toHexString() }),
      });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/existing unbanned Russian party/);
      expect(db.collectionMocks.electionCandidates.insertOne).not.toHaveBeenCalled();
    }
  );
  it("rejects independent national lists and accepts independent home constituencies", async () => {
    const { db } = await setupDuma("list", "independent");
    const list = await POST(makeReq(), {
      params: Promise.resolve({ id: electionOid.toHexString() }),
    });
    expect(list.status).toBe(403);
    expect((await list.json()).error).toMatch(/Independent/);
    expect(db.collectionMocks.electionCandidates.insertOne).not.toHaveBeenCalled();
    const district = await setupDuma("constituency", "independent");
    expect(
      (await POST(makeReq(), { params: Promise.resolve({ id: electionOid.toHexString() }) })).status
    ).toBe(200);
    expect(district.db.collectionMocks.electionCandidates.insertOne).toHaveBeenCalled();
  });
  it("does not exempt an out-of-home constituency from residence checks", async () => {
    const { db, election } = await setupDuma("constituency");
    election.state = "NWR";
    election.seatId = "RU-duma-NWR-1";
    const res = await POST(makeReq(), {
      params: Promise.resolve({ id: electionOid.toHexString() }),
    });
    expect(res.status).toBe(403);
    expect(db.collectionMocks.electionCandidates.insertOne).not.toHaveBeenCalled();
  });
  it("keeps the normal active-candidacy guard for a national list", async () => {
    const { db } = await setupDuma();
    const { findBlockingActiveCandidacy } = await import("@/lib/elections/activeCandidacy");
    vi.mocked(findBlockingActiveCandidacy).mockResolvedValueOnce({
      election: { electionType: "dumaDeputy", state: "CEN" },
    } as never);
    const res = await POST(makeReq(), {
      params: Promise.resolve({ id: electionOid.toHexString() }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/already running/);
    expect(db.collectionMocks.electionCandidates.insertOne).not.toHaveBeenCalled();
  });
});

describe("Bound first-Council player filing", () => {
  const cohortId = new ObjectId();
  beforeEach(() => vi.clearAllMocks());
  async function setupCouncil() {
    const db = setupScenario({
      electionCountry: "US",
      characterCountry: "US",
      characterParty: "1",
      partyDocReturn: null,
    });
    const ids = RUSSIAN_COUNCIL_SUBJECTS_1993.map(([number]) =>
      number === 77 ? electionOid : new ObjectId()
    );
    const opening = {
      _id: cohortId.toHexString(),
      countryId: "RU",
      preset: "1991-default",
      cohortId,
      mandateSinceTurn: 129,
      electionIds: ids,
      registeredBySubject: Object.fromEntries(
        RUSSIAN_COUNCIL_SUBJECTS_1993.map(([number]) => [`RU-council-${number}`, 1000])
      ),
    };
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      preset: "1991-default",
    });
    db.collection("countryGameStates").findOne.mockResolvedValue({
      _id: "RU",
      ruSovietSuccessionSinceTurn: 48,
      ruFederalAssemblyMandateSinceTurn: 129,
      ruFirstCouncilElectionCohortId: cohortId,
    });
    db.collection("countryState").findOne.mockResolvedValue({
      _id: "RU",
      governmentType: "parliamentaryRepublic",
    });
    db.collection("russianCouncilElectionOpenings").findOne.mockResolvedValue(opening);
    db.collectionMocks.politicalParties.findOne.mockResolvedValue({
      countryId: "RU",
      sequentialId: 1,
      regimeStatus: null,
    });
    const character = {
      _id: characterOid,
      countryId: "RU",
      homeState: "CEN",
      party: "1",
      name: "Council player",
      currentOffice: null,
      careerHistory: [],
      executiveTermsServed: 0,
    };
    db.collectionMocks.characters.findOne.mockResolvedValue(character);
    const { getGameTime } = await import("@/lib/time/gameTime");
    vi.mocked(getGameTime).mockResolvedValue({
      effectiveNow: new Date(1000),
      currentTurn: 130,
    } as never);
    const election = {
      _id: electionOid,
      countryId: "RU",
      electionType: "federationCouncilMember",
      status: "active",
      cycle: 1,
      primaryEndTurn: 139,
      primaryEndTime: new Date(10000),
      state: "CEN",
      seatId: "RU-council-77",
      totalSeats: 2,
      russianCouncilRound: {
        cohortId,
        mandateSinceTurn: 129,
        districtNumber: 77,
        registeredVoters: 1000,
      },
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    db.collection("elections").findOne.mockResolvedValue(election);
    vi.mocked(resolveElectionRouteParam).mockResolvedValue({ ok: true, election } as never);
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: "council-player", character },
    } as never);
    return { db, election, character, opening };
  }
  const post = () =>
    POST(makeReq(), { params: Promise.resolve({ id: electionOid.toHexString() }) });
  it("files a frozen individual nomination using a transaction", async () => {
    const { db } = await setupCouncil();
    const res = await post();
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(db.collectionMocks.electionCandidates.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: characterOid,
        russianCouncilNomination: { registrationOrder: 1000 },
      }),
      expect.objectContaining({ session: expect.anything() })
    );
    expect(db.collectionMocks.russianCouncilElectionOpenings.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      { $inc: { playerFilings: 1 } },
      expect.objectContaining({ session: expect.anything() })
    );
    expect(db.collectionMocks.campaigns.updateOne).toHaveBeenCalledWith(
      { electionId: electionOid, candidateId: characterOid, status: { $ne: "archived" } },
      { $set: { party: "1", updatedAt: new Date(1000) } },
      expect.objectContaining({ session: expect.anything() })
    );
  });
  it("replaces one bounded NPC without removing another player", async () => {
    const { db } = await setupCouncil();
    const npcId = new ObjectId();
    const rows = [
      {
        _id: new ObjectId(),
        electionId: electionOid,
        characterId: new ObjectId(),
        party: "1",
        isNPP: false,
      },
      {
        _id: npcId,
        electionId: electionOid,
        characterId: new ObjectId(),
        nppId: new ObjectId(),
        boundedNpcNomineeId: npcId,
        party: "1",
        isNPP: true,
        russianCouncilNomination: { registrationOrder: 500 },
      },
    ];
    const cursor = emptyFindCursor();
    cursor.toArray.mockResolvedValue(rows);
    db.collectionMocks.electionCandidates.find.mockReturnValue(cursor);
    db.collectionMocks.electionCandidates.updateMany.mockResolvedValue({ modifiedCount: 1 });
    const res = await post();
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(db.collectionMocks.electionCandidates.updateMany).toHaveBeenCalledWith(
      { _id: { $in: [npcId] }, electionId: electionOid, status: "active" },
      expect.objectContaining({ $set: { status: "withdrawn", withdrawnAt: new Date(1000) } }),
      expect.objectContaining({ session: expect.anything() })
    );
  });
  it.each([
    "cohort",
    "receipt",
    "subject-id",
    "register",
    "residence",
    "duma-seat",
    "council-seat",
    "party",
  ])("rejects invalid %s before writing", async (reason) => {
    const { db, election, character, opening } = await setupCouncil();
    if (reason === "cohort") election.russianCouncilRound.cohortId = new ObjectId();
    if (reason === "receipt")
      db.collectionMocks.russianCouncilElectionOpenings.findOne.mockResolvedValue(null);
    if (reason === "subject-id") opening.electionIds[76] = new ObjectId();
    if (reason === "register") election.russianCouncilRound.registeredVoters = 999;
    if (reason === "residence") character.homeState = "VOL";
    if (reason === "duma-seat" || reason === "council-seat")
      Object.assign(character, {
        currentOffice: { type: reason === "duma-seat" ? "dumaDeputy" : "federationCouncilMember" },
      });
    if (reason === "party") db.collectionMocks.politicalParties.findOne.mockResolvedValue(null);
    const res = await post();
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(403);
    expect(db.collectionMocks.electionCandidates.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.electionCandidates.updateMany).not.toHaveBeenCalled();
  });
  it("revalidates the character's party inside the transaction", async () => {
    const { db, character } = await setupCouncil();
    db.collectionMocks.characters.findOne.mockResolvedValue({ ...character, party: "2" });
    const res = await post();
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(403);
    expect(db.collectionMocks.electionCandidates.insertOne).not.toHaveBeenCalled();
  });
  it.each(["constituency", "list"])(
    "protects a certified but unseated Duma %s mandate",
    async (tier) => {
      const { db } = await setupCouncil();
      const root = new ObjectId();
      const nomination = new ObjectId();
      db.collectionMocks.countryGameStates.findOne.mockResolvedValue({
        _id: "RU",
        ruSovietSuccessionSinceTurn: 48,
        ruFederalAssemblyMandateSinceTurn: 129,
        ruFirstCouncilElectionCohortId: cohortId,
        ruFirstDumaElectionCohortId: root,
      });
      const cursor = emptyFindCursor();
      cursor.toArray.mockResolvedValue([
        {
          result: {
            constituencyResults:
              tier === "constituency"
                ? [{ winner: { ownerId: characterOid.toHexString(), isNpc: false } }]
                : [],
            listAssignment:
              tier === "list" ? { seatsByNominee: { [nomination.toHexString()]: 1 } } : null,
          },
          nominees: [{ candidateId: nomination, ownerId: characterOid, isNpc: false }],
        },
      ]);
      db.collection("russianDumaElectionResults").find.mockReturnValue(cursor);
      const res = await post();
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/already hold a Duma mandate/);
      expect(db.collectionMocks.electionCandidates.insertOne).not.toHaveBeenCalled();
    }
  );
});

describe("Hungarian 1991 constituency filing route", () => {
  async function setupHungary(round: 1 | 2 = 1) {
    const db = setupScenario({
      electionCountry: "US",
      characterCountry: "US",
      characterParty: "1",
      partyDocReturn: null,
    });
    const election = {
      _id: electionOid,
      countryId: "HU",
      electionType: "nationalAssembly",
      state: "HU_BUD",
      cycle: 1,
      status: "active",
      primaryEndTurn: 90,
      primaryEndTime: new Date("2026-04-02T00:00:00Z"),
      hungarianAssemblyRound: {
        ruleVersion: "mixed-1989-v1",
        receiptId: "HU:mixed1989:1",
        round,
        registeredVoters: 10000,
      },
    };
    vi.mocked(resolveElectionRouteParam).mockResolvedValue({ ok: true, election } as never);
    const character = {
      _id: characterOid,
      countryId: "HU",
      name: "Synthetic Hungarian player",
      homeState: "HU_BUD",
      party: "1",
      currentOffice: null,
      careerHistory: [],
    };
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toHexString(), character },
    } as never);
    const { getGameTime } = await import("@/lib/time/gameTime");
    vi.mocked(getGameTime).mockResolvedValue({
      effectiveNow: new Date("2026-04-01T00:00:00Z"),
      currentTurn: 50,
    } as never);
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      preset: "1991-default",
      currentTurn: 50,
    });
    db.collection("countryState").findOne.mockResolvedValue({
      _id: "HU",
      governmentType: "parliamentaryRepublic",
    });
    db.collection("elections").findOne.mockResolvedValue(election);
    db.collection("characters").findOne.mockResolvedValue(character);
    db.collection("politicalParties").findOne.mockResolvedValue({
      sequentialId: 1,
      countryId: "HU",
      regimeStatus: "legal",
    });
    db.collection("hu1991AssemblyFilingLocks").findOne.mockResolvedValue(null);
    db.collection("hu1991AssemblyFilingLocks").find.mockReturnValue(emptyFindCursor());
    return { db, election };
  }
  async function setupHungarianByElection() {
    const { db, election } = await setupHungary();
    const receiptId = "HU:mixed1989:1:by-election:1";
    const poll = {
      ...election,
      hungarianAssemblyRound: {
        ...election.hungarianAssemblyRound,
        receiptId,
        byElection: {
          parentReceiptId: "HU:mixed1989:1",
          generation: 1,
          districtIds: ["HU-constituency-01-12"],
        },
      },
    };
    vi.mocked(resolveElectionRouteParam).mockResolvedValue({ ok: true, election: poll } as never);
    db.collection("elections").findOne.mockResolvedValue(poll);
    db.collection("hu1991ConstituencyByElections").findOne.mockResolvedValue({
      _id: receiptId,
      parentReceiptId: "HU:mixed1989:1",
      round: 1,
      termEndTurn: 200,
      activeElectionIds: [electionOid.toHexString()],
      districtIds: ["HU-constituency-01-12"],
    });
    db.collection("hu1991AssemblyCounts").findOne.mockResolvedValue({ _id: "HU:mixed1989:1" });
    db.collection("electedOfficials").findOne.mockResolvedValue(null);
    return { db, poll };
  }
  it.each(["valid", "foreign", "superseded", "incumbent"])(
    "validates modern Hungarian vacancy filing through the authenticated route (%s)",
    async (kind) => {
      const { db, election } = await setupHungary();
      const receiptId = "HU:mixed2011:1:by-election:1";
      const poll = {
        ...election,
        hungarianAssemblyRound: undefined,
        hungarianModernByElection: {
          receiptId,
          parentReceiptId: "HU:mixed2011:1",
          districtId: "HU_BUD:1",
          registeredVoters: 100,
        },
      };
      vi.mocked(resolveElectionRouteParam).mockResolvedValue({ ok: true, election: poll } as never);
      db.collection("elections").findOne.mockResolvedValue(poll);
      db.collection("gameState").findOne.mockResolvedValue({
        preset: "1991-default",
        currentTurn: 50,
        huAssemblyReformedAtYear: 2014,
      });
      db.collection("hu2011ConstituencyByElections").findOne.mockResolvedValue({
        _id: receiptId,
        parentReceiptId: "HU:mixed2011:1",
        generation: 1,
        termEndTurn: 200,
        electionIds: [electionOid.toHexString()],
        districtIds: ["HU_BUD:1"],
        constituencies: [{ id: "HU_BUD:1", regionId: "HU_BUD" }],
      });
      db.collection("hu2011AssemblyCounts").findOne.mockResolvedValue({
        _id: kind === "superseded" ? "HU:mixed2011:2" : "HU:mixed2011:1",
      });
      db.collection("governmentFormations").updateOne.mockResolvedValue({
        matchedCount: 1,
        modifiedCount: 1,
      });
      db.collection("electedOfficials").findOne.mockResolvedValue(
        kind === "incumbent" ? { _id: new ObjectId() } : null
      );
      const response = await POST(
        new Request("http://test/route", {
          method: "POST",
          body: JSON.stringify({
            constituencyId: kind === "foreign" ? "HU-constituency-01-12" : "HU_BUD:1",
          }),
        }),
        { params: Promise.resolve({ id: electionOid.toHexString() }) }
      );
      expect(response.status, JSON.stringify(await response.clone().json())).toBe(
        kind === "valid" ? 200 : 403
      );
      if (kind === "valid")
        expect(db.collection("electionCandidates").insertOne).toHaveBeenCalledTimes(1);
      else expect(db.collection("electionCandidates").insertOne).not.toHaveBeenCalled();
    }
  );
  it("files only the vacant constituency in a journal-bound by-election", async () => {
    const { db } = await setupHungarianByElection();
    const response = await POST(
      new Request("http://test/route", {
        method: "POST",
        body: JSON.stringify({ constituencyId: "HU-constituency-01-12" }),
      }),
      { params: Promise.resolve({ id: electionOid.toHexString() }) }
    );
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect(db.collection("electionCandidates").insertOne).toHaveBeenCalledTimes(1);
  });
  it("refuses to file an occupied constituency during a by-election", async () => {
    const { db } = await setupHungarianByElection();
    const response = await POST(
      new Request("http://test/route", {
        method: "POST",
        body: JSON.stringify({ constituencyId: "HU-constituency-01-13" }),
      }),
      { params: Promise.resolve({ id: electionOid.toHexString() }) }
    );
    expect(response.status).toBe(403);
    expect(db.collection("electionCandidates").insertOne).not.toHaveBeenCalled();
  });
  it("refuses a second mandate and refuses a superseded by-election journal", async () => {
    const { db } = await setupHungarianByElection();
    db.collection("electedOfficials").findOne.mockResolvedValue({
      _id: new ObjectId(),
      characterId: characterOid,
    });
    expect(
      (await POST(makeReq(), { params: Promise.resolve({ id: electionOid.toHexString() }) })).status
    ).toBe(403);
    db.collection("electedOfficials").findOne.mockResolvedValue(null);
    db.collection("hu1991AssemblyCounts").findOne.mockResolvedValue({ _id: "HU:mixed1989:2" });
    expect(
      (await POST(makeReq(), { params: Promise.resolve({ id: electionOid.toHexString() }) })).status
    ).toBe(403);
    expect(db.collection("electionCandidates").insertOne).not.toHaveBeenCalled();
  });
  it("files the selected constituency in the atomic candidate writer", async () => {
    const { db } = await setupHungary();
    const request = new Request("http://test/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ constituencyId: "HU-constituency-01-12" }),
    });
    const result = await POST(request, {
      params: Promise.resolve({ id: electionOid.toHexString() }),
    });
    expect(result.status, JSON.stringify(await result.clone().json())).toBe(200);
    expect(db.collection("electionCandidates").insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        hungarianAssemblyNomination: { constituencyId: "HU-constituency-01-12" },
      }),
      expect.objectContaining({ session: expect.anything() })
    );
    expect(db.collection("hu1991AssemblyFilingLocks").insertOne).toHaveBeenCalledTimes(2);
  });
  it.each([
    "{broken",
    JSON.stringify({ constituencyId: 12 }),
    JSON.stringify({ constituencyId: "", unexpected: true }),
  ])("rejects malformed constituency bodies before any filing write", async (body) => {
    const { db } = await setupHungary();
    const result = await POST(new Request("http://test/route", { method: "POST", body }), {
      params: Promise.resolve({ id: electionOid.toHexString() }),
    });
    expect(result.status).toBe(400);
    expect(db.collection("electionCandidates").insertOne).not.toHaveBeenCalled();
    expect(db.collection("hu1991AssemblyFilingLocks").insertOne).not.toHaveBeenCalled();
  });
  it("refuses entrants to a qualified second round", async () => {
    const { db } = await setupHungary(2);
    const result = await POST(makeReq(), {
      params: Promise.resolve({ id: electionOid.toHexString() }),
    });
    expect(result.status).toBe(403);
    expect((await result.json()).error).toContain("qualified nominees");
    expect(db.collection("electionCandidates").insertOne).not.toHaveBeenCalled();
  });
  it("refuses a district outside the player's home region", async () => {
    const { db } = await setupHungary();
    const result = await POST(
      new Request("http://test/route", {
        method: "POST",
        body: JSON.stringify({ constituencyId: "HU-constituency-02-01" }),
      }),
      { params: Promise.resolve({ id: electionOid.toHexString() }) }
    );
    expect(result.status).toBe(403);
    expect(db.collection("electionCandidates").insertOne).not.toHaveBeenCalled();
  });
});

describe("Bulgarian founding constituency filing route", () => {
  it("accepts an authorized reopened district and refuses advertised eligibility without a receipt", async () => {
    const { db, election } = await setupBulgaria(2);
    const regions = [...new Set(BG_1990_CONSTITUENCIES.map((row) => row.regionId))];
    const district = BG_1990_CONSTITUENCIES.find((row) => row.regionId === "BG_SOF")!;
    const { nominations } = buildBgFoundingSlates(
      regions.map((regionId, index) => ({
        id: new ObjectId().toHexString(),
        ownerId: new ObjectId().toHexString(),
        isNpc: true,
        partyId: "9",
        regionId,
        listOrder: index,
      }))
    );
    const campaigns = regions.map((regionId) => ({
      regionId,
      registeredVoters: 10000,
      candidates: [
        ...new Set(
          nominations.people
            .filter((row) => row.regionId === regionId)
            .map((row) => row.candidateId)
        ),
      ].map((candidateId) => ({ candidateId, votes: 1000 })),
    }));
    const first = projectBgFoundingBallots(campaigns, nominations);
    const rootElectionId = new ObjectId().toHexString();
    Object.assign(election.bulgarianFoundingRound, {
      rootElectionId,
      newNominationDistrictIds: [district.id],
    });
    const receipt = {
      _id: election.bulgarianFoundingRound.receiptId,
      ruleVersion: "parallel-1990-v1",
      electionIds: [rootElectionId],
      nominations,
      nominees: [],
      first,
      count: countBgFoundingElection(first),
      activeRunoffElectionIds: [electionOid.toHexString()],
    };
    db.collection("bgFoundingAssemblyCounts").findOne.mockResolvedValue(receipt);
    db.collection("bgFoundingAssemblyCounts").updateOne.mockResolvedValue({ modifiedCount: 1 });
    const parameters = { params: Promise.resolve({ id: electionOid.toHexString() }) };
    const request = () =>
      new Request("http://test/route", {
        method: "POST",
        body: JSON.stringify({ constituencyId: district.id }),
      });
    expect((await POST(request(), parameters)).status).toBe(200);
    expect(db.collection("bgFoundingAssemblyCounts").updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ activeRunoffElectionIds: electionOid.toHexString() }),
      expect.objectContaining({
        $push: {
          nominees: expect.objectContaining({ ownerId: characterOid.toHexString(), isNpc: false }),
        },
      }),
      expect.objectContaining({ session: expect.anything() })
    );
    db.collection("bgFoundingAssemblyCounts").findOne.mockResolvedValue(null);
    expect((await POST(request(), parameters)).status).toBe(403);
  });
  async function setupBulgaria(round: 1 | 2 = 1) {
    const db = setupScenario({
      electionCountry: "US",
      characterCountry: "US",
      characterParty: "1",
      partyDocReturn: null,
    });
    const election = {
      _id: electionOid,
      countryId: "BG",
      electionType: "nationalAssembly",
      state: "BG_SOF",
      cycle: 1,
      status: "active",
      primaryEndTurn: 90,
      primaryEndTime: new Date("2026-04-02T00:00:00Z"),
      bulgarianFoundingRound: {
        ruleVersion: "parallel-1990-v1",
        receiptId: "BG:founding1990:0",
        round,
        registeredVoters: 10000,
      },
    };
    vi.mocked(resolveElectionRouteParam).mockResolvedValue({ ok: true, election } as never);
    const character = {
      _id: characterOid,
      countryId: "BG",
      name: "Synthetic Bulgarian player",
      homeState: "BG_SOF",
      party: "1",
      currentOffice: null,
      careerHistory: [],
    };
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: "synthetic-player", character },
    } as never);
    const { getGameTime } = await import("@/lib/time/gameTime");
    vi.mocked(getGameTime).mockResolvedValue({
      effectiveNow: new Date("2026-04-01T00:00:00Z"),
      currentTurn: 50,
    } as never);
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      preset: "1991-default",
      currentTurn: 50,
    });
    db.collection("countryState").findOne.mockResolvedValue({
      _id: "BG",
      governmentType: "parliamentaryRepublic",
    });
    db.collection("elections").findOne.mockResolvedValue(election);
    db.collection("characters").findOne.mockResolvedValue(character);
    db.collection("politicalParties").findOne.mockResolvedValue({
      sequentialId: 1,
      countryId: "BG",
      regimeStatus: "legal",
    });
    db.collection("bgFoundingAssemblyFilingLocks").findOne.mockResolvedValue(null);
    db.collection("bgFoundingAssemblyFilingLocks").find.mockReturnValue(emptyFindCursor());
    return { db, election };
  }
  it("files an explicit Bulgarian constituency through the atomic writer", async () => {
    const { db } = await setupBulgaria();
    const { BG_1990_CONSTITUENCIES } =
      await import("@/lib/countries/bg/data/foundingDistricts1990");
    const district = BG_1990_CONSTITUENCIES.find((row) => row.regionId === "BG_SOF")!;
    const response = await POST(
      new Request("http://test/route", {
        method: "POST",
        body: JSON.stringify({ constituencyId: district.id }),
      }),
      { params: Promise.resolve({ id: electionOid.toHexString() }) }
    );
    expect(response.status).toBe(200);
    expect(db.collection("electionCandidates").insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ bulgarianFoundingNomination: { constituencyId: district.id } }),
      expect.objectContaining({ session: expect.anything() })
    );
    expect(db.collection("bgFoundingAssemblyFilingLocks").insertOne).toHaveBeenCalledTimes(2);
  });
  it("rejects malformed filings, foreign districts and ordinary entries into qualified runoffs", async () => {
    const { db } = await setupBulgaria();
    const parameters = { params: Promise.resolve({ id: electionOid.toHexString() }) };
    expect(
      (
        await POST(
          new Request("http://test/route", {
            method: "POST",
            body: JSON.stringify({ forgedField: "x" }),
          }),
          parameters
        )
      ).status
    ).toBe(400);
    expect(
      (
        await POST(
          new Request("http://test/route", {
            method: "POST",
            body: JSON.stringify({ constituencyId: "HU-constituency-01-12" }),
          }),
          parameters
        )
      ).status
    ).toBe(403);
    await setupBulgaria(2);
    expect((await POST(makeReq(), parameters)).status).toBe(403);
    expect(db.collection("electionCandidates").insertOne).not.toHaveBeenCalled();
  });
});

describe("Japan mixed Shugiin filing route", () => {
  it("allows multiple independent constituency filings without reserving a party slot", async () => {
    const db = setupScenario({
      electionCountry: "US",
      characterCountry: "US",
      characterParty: "independent",
      partyDocReturn: null,
    });
    const election = {
      _id: electionOid,
      countryId: "JP",
      electionType: "shugiin",
      state: "KAN",
      cycle: 1,
      status: "active",
      primaryEndTime: new Date("2026-04-02T00:00:00Z"),
      japanShugiinRules: {
        ruleVersion: "mixed-1994-v1",
        districtSeats: 85,
        listSeats: 63,
      },
    };
    vi.mocked(resolveElectionRouteParam).mockResolvedValue({ ok: true, election } as never);
    const { getGameTime } = await import("@/lib/time/gameTime");
    vi.mocked(getGameTime).mockResolvedValue({
      effectiveNow: new Date("2026-04-01T00:00:00Z"),
      currentTurn: 50,
    } as never);
    db.collection("countryState");
    db.collectionMocks.countryState!.findOne.mockResolvedValue({ _id: "JP" });
    const district = { constituencyId: "JP-KAN-13-01" };

    for (const characterId of [characterOid, new ObjectId()]) {
      const character = {
        _id: characterId,
        countryId: "JP",
        name: `Independent ${characterId.toHexString()}`,
        homeState: "KAN",
        party: "independent",
        policies: { economic: 0, social: 0 },
        favorability: 50,
        politicalInfluence: 10,
        careerHistory: [],
        executiveTermsServed: 0,
        currentOffice: null,
      };
      vi.mocked(requireAuthWithCharacter).mockResolvedValue({
        ok: true,
        user: { userId: characterId.toHexString(), character },
      } as never);
      const response = await POST(
        new Request("http://test/route", {
          method: "POST",
          body: JSON.stringify(district),
        }),
        { params: Promise.resolve({ id: electionOid.toHexString() }) }
      );
      expect(response.status).toBe(200);
    }

    const filedRows = db.collectionMocks.electionCandidates!.insertOne.mock.calls.map(
      ([candidate]) => candidate as Record<string, unknown>
    );
    expect(filedRows).toHaveLength(2);
    expect(filedRows.every((candidate) => !("japanShugiinDistrictPartyKey" in candidate))).toBe(
      true
    );
  });

  it("stores the player's statutory district and separate party-list rank", async () => {
    const db = setupScenario({
      electionCountry: "US",
      characterCountry: "US",
      characterParty: "1",
      partyDocReturn: null,
    });
    const district = { id: "JP-KAN-13-01", regionId: "KAN" };
    const election = {
      _id: electionOid,
      countryId: "JP",
      electionType: "shugiin",
      state: "KAN",
      cycle: 1,
      status: "active",
      primaryEndTime: new Date("2026-04-02T00:00:00Z"),
      japanShugiinRules: {
        ruleVersion: "mixed-1994-v1",
        districtSeats: 85,
        listSeats: 63,
      },
    };
    vi.mocked(resolveElectionRouteParam).mockResolvedValue({ ok: true, election } as never);
    const character = {
      _id: characterOid,
      countryId: "JP",
      name: "Synthetic Shugiin candidate",
      homeState: "KAN",
      party: "1",
      policies: { economic: 0, social: 0 },
      favorability: 50,
      politicalInfluence: 10,
      careerHistory: [],
      executiveTermsServed: 0,
      currentOffice: null,
    };
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: "synthetic-player", character },
    } as never);
    const { getGameTime } = await import("@/lib/time/gameTime");
    vi.mocked(getGameTime).mockResolvedValue({
      effectiveNow: new Date("2026-04-01T00:00:00Z"),
      currentTurn: 50,
    } as never);
    db.collection("countryState");
    db.collectionMocks.politicalParties!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      countryId: "JP",
      sequentialId: 1,
      regimeStatus: "approved",
    } as never);
    db.collectionMocks.countryState!.findOne.mockResolvedValue({ _id: "JP" });
    db.collectionMocks.characters!.findOne.mockResolvedValue(null);

    const response = await POST(
      new Request("http://test/route", {
        method: "POST",
        body: JSON.stringify({ constituencyId: district.id, japanShugiinListOrder: 2 }),
      }),
      { params: Promise.resolve({ id: electionOid.toHexString() }) }
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks.electionCandidates!.createIndex).toHaveBeenCalledTimes(2);
    expect(db.collectionMocks.electionCandidates!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        constituencyId: district.id,
        japanShugiinListOrder: 2,
        countryId: "JP",
      })
    );
  });

  it("rejects a list nomination from an unregistered party", async () => {
    const db = setupScenario({
      electionCountry: "US",
      characterCountry: "US",
      characterParty: "999",
      partyDocReturn: null,
    });
    const election = {
      _id: electionOid,
      countryId: "JP",
      electionType: "shugiin",
      state: "KAN",
      cycle: 1,
      status: "active",
      primaryEndTime: new Date("2026-04-02T00:00:00Z"),
      japanShugiinRules: {
        ruleVersion: "mixed-1994-v1",
        districtSeats: 85,
        listSeats: 63,
      },
    };
    vi.mocked(resolveElectionRouteParam).mockResolvedValue({ ok: true, election } as never);
    const character = {
      _id: characterOid,
      countryId: "JP",
      name: "Synthetic Shugiin candidate",
      homeState: "KAN",
      party: "999",
      policies: { economic: 0, social: 0 },
      favorability: 50,
      politicalInfluence: 10,
      careerHistory: [],
      executiveTermsServed: 0,
      currentOffice: null,
    };
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: "synthetic-player", character },
    } as never);
    const { getGameTime } = await import("@/lib/time/gameTime");
    vi.mocked(getGameTime).mockResolvedValue({
      effectiveNow: new Date("2026-04-01T00:00:00Z"),
      currentTurn: 50,
    } as never);
    db.collection("countryState");
    db.collectionMocks.countryState!.findOne.mockResolvedValue({ _id: "JP" });
    db.collectionMocks.characters!.findOne.mockResolvedValue(null);

    const response = await POST(
      new Request("http://test/route", {
        method: "POST",
        body: JSON.stringify({ japanShugiinListOrder: 2 }),
      }),
      { params: Promise.resolve({ id: electionOid.toHexString() }) }
    );

    expect(response.status).toBe(403);
    expect(db.collectionMocks.electionCandidates!.insertOne).not.toHaveBeenCalled();
  });

  it("returns 409 when a concurrent filing wins the unique Shugiin ballot slot", async () => {
    const db = setupScenario({
      electionCountry: "US",
      characterCountry: "US",
      characterParty: "1",
      partyDocReturn: null,
    });
    const election = {
      _id: electionOid,
      countryId: "JP",
      electionType: "shugiin",
      state: "KAN",
      cycle: 1,
      status: "active",
      primaryEndTime: new Date("2026-04-02T00:00:00Z"),
      japanShugiinRules: {
        ruleVersion: "mixed-1994-v1",
        districtSeats: 85,
        listSeats: 63,
      },
    };
    vi.mocked(resolveElectionRouteParam).mockResolvedValue({ ok: true, election } as never);
    const character = {
      _id: characterOid,
      countryId: "JP",
      name: "Synthetic Shugiin candidate",
      homeState: "KAN",
      party: "1",
      policies: { economic: 0, social: 0 },
      favorability: 50,
      politicalInfluence: 10,
      careerHistory: [],
      executiveTermsServed: 0,
      currentOffice: null,
    };
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: "synthetic-player", character },
    } as never);
    const { getGameTime } = await import("@/lib/time/gameTime");
    vi.mocked(getGameTime).mockResolvedValue({
      effectiveNow: new Date("2026-04-01T00:00:00Z"),
      currentTurn: 50,
    } as never);
    db.collection("countryState");
    db.collectionMocks.politicalParties!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      countryId: "JP",
      sequentialId: 1,
      regimeStatus: "approved",
    } as never);
    db.collectionMocks.countryState!.findOne.mockResolvedValue({ _id: "JP" });
    db.collectionMocks.characters!.findOne.mockResolvedValue(null);
    db.collectionMocks.electionCandidates!.insertOne.mockRejectedValue(
      Object.assign(new Error("E11000 duplicate key"), {
        code: 11000,
        keyPattern: { electionId: 1, party: 1, japanShugiinListOrder: 1 },
      })
    );

    const response = await POST(
      new Request("http://test/route", {
        method: "POST",
        body: JSON.stringify({ japanShugiinListOrder: 2 }),
      }),
      { params: Promise.resolve({ id: electionOid.toHexString() }) }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "Your party already has a candidate in that Shugiin ballot position.",
    });
  });
});
