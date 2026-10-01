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
