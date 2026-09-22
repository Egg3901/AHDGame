/**
 * Focused #860 route tests: the five Commons vacancy/recall endpoints.
 *
 * Each route runs against the in-memory fake Commons db (no mocks of the
 * seat commands or petition shells), with only the auth guard and the db
 * accessor mocked. Rate limiting is real; every test authenticates as a
 * fresh user id so buckets never leak between cases.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { createFakeCommonsDb } from "@/lib/uk/elections/commonsTestDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));

const TURN = 500;

interface FakeHandle {
  db: ReturnType<typeof createFakeCommonsDb>["db"];
  seed: ReturnType<typeof createFakeCommonsDb>["seed"];
  read: ReturnType<typeof createFakeCommonsDb>["read"];
}

let fake: FakeHandle;

function mpCharacter(over: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    userId: new ObjectId(),
    countryId: "UK",
    name: "Test MP",
    homeState: "LON",
    party: "1",
    favorability: 60,
    infamy: 0,
    currentOffice: { type: "commons", state: "LON" },
    ...over,
  };
}

function commonsSeat(characterId: ObjectId, over: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    officeType: "commons",
    countryId: "UK",
    state: "LON",
    characterId,
    nppId: null,
    characterName: "Test MP",
    party: "1",
    ...over,
  };
}

/** Authenticate all subsequent route calls as `character` (fresh rate bucket). */
async function authAs(character: Record<string, unknown>) {
  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId(), character },
  } as never);
}

async function authFails() {
  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: false,
    response: NextResponse.json({ error: "Authentication required" }, { status: 401 }),
  });
}

function post(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  fake = createFakeCommonsDb() as unknown as FakeHandle;
  fake.seed("gameState", [{ _id: "current", currentTurn: TURN }]);
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(fake.db as never);
});

describe("GET /api/uk/commons/vacancies", () => {
  const URL = "http://localhost/api/uk/commons/vacancies";

  it("401s without a character", async () => {
    await authFails();
    const { GET } = await import("./vacancies/route");
    const res = await GET(new Request(URL));
    expect(res.status).toBe(401);
  });

  it("400s on an invalid state filter", async () => {
    await authAs(mpCharacter());
    const { GET } = await import("./vacancies/route");
    const res = await GET(new Request(`${URL}?state=!!!`));
    expect(res.status).toBe(400);
  });

  it("returns vacancies, petitions, covering races, and the viewer seat with no-store", async () => {
    const character = mpCharacter();
    const seat = commonsSeat(character._id as ObjectId);
    fake.seed("characters", [character]);
    fake.seed("electedOfficials", [seat]);
    const vacancyId = new ObjectId();
    fake.seed("ukCommonsVacancies", [
      {
        _id: vacancyId,
        countryId: "UK",
        state: "LON",
        seats: 1,
        reason: "resignation",
        status: "open",
        vacatedTurn: TURN - 2,
        priorCharacterName: "Gone MP",
        priorParty: "1",
      },
    ]);
    const petitionId = new ObjectId();
    fake.seed("ukRecallPetitions", [
      {
        _id: petitionId,
        countryId: "UK",
        state: "LON",
        officialId: seat._id,
        targetCharacterId: character._id,
        targetCharacterName: "Test MP",
        targetParty: "1",
        status: "open",
        trigger: "infamy",
        signatures: [],
        declarations: [],
        supportSamples: [],
      },
    ]);
    const electionId = new ObjectId();
    fake.seed("elections", [
      {
        _id: electionId,
        countryId: "UK",
        electionType: "special_commons",
        state: "LON",
        status: "active",
        endTurn: TURN + 40,
        totalSeats: 1,
        byElectionCarve: 1 / 75,
        byElectionVacancyIds: [vacancyId],
      },
    ]);
    fake.seed("electionCandidates", [
      {
        _id: new ObjectId(),
        electionId,
        characterName: "Hopeful",
        party: "1",
        status: "active",
      },
    ]);
    await authAs(character);

    const { GET } = await import("./vacancies/route");
    const res = await GET(new Request(URL));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toMatch(/no-store/);
    const body = (await res.json()) as {
      currentTurn: number;
      vacancies: Array<{ id: string; state: string }>;
      petitions: Array<{ id: string; signaturesRequired: number }>;
      elections: Array<{ id: string; carve: number; candidates: unknown[] }>;
      viewer: { officialId: string | null };
    };
    expect(body.currentTurn).toBe(TURN);
    expect(body.vacancies).toHaveLength(1);
    expect(body.vacancies[0].id).toBe(vacancyId.toString());
    expect(body.petitions).toHaveLength(1);
    expect(body.petitions[0].signaturesRequired).toBeGreaterThan(0);
    expect(body.elections).toHaveLength(1);
    expect(body.elections[0].carve).toBeCloseTo(1 / 75, 9);
    expect(body.elections[0].candidates).toHaveLength(1);
    expect(body.viewer.officialId).toBe((seat._id as ObjectId).toString());
  });

  it("applies the state filter and reports no seat for non-MPs", async () => {
    const viewer = mpCharacter({ currentOffice: null });
    fake.seed("characters", [viewer]);
    fake.seed("ukCommonsVacancies", [
      { _id: new ObjectId(), countryId: "UK", state: "LON", status: "open" },
      { _id: new ObjectId(), countryId: "UK", state: "SCO", status: "open" },
    ]);
    await authAs(viewer);

    const { GET } = await import("./vacancies/route");
    const res = await GET(new Request(`${URL}?state=sco`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      vacancies: Array<{ state: string }>;
      viewer: { officialId: string | null };
    };
    expect(body.vacancies).toHaveLength(1);
    expect(body.vacancies[0].state).toBe("SCO");
    expect(body.viewer.officialId).toBeNull();
  });
});

describe("POST /api/uk/commons/resign", () => {
  it("401s without a character", async () => {
    await authFails();
    const { POST } = await import("./resign/route");
    expect((await POST()).status).toBe(401);
  });

  it("resigns the caller seat, records a resignation vacancy, and is no-store", async () => {
    const character = mpCharacter();
    fake.seed("characters", [character]);
    fake.seed("electedOfficials", [commonsSeat(character._id as ObjectId)]);
    await authAs(character);

    const { POST } = await import("./resign/route");
    const res = await POST();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toMatch(/no-store/);
    const body = (await res.json()) as { success: boolean; vacancyId: string };
    expect(body.success).toBe(true);
    const vacancies = fake.read<Record<string, unknown>>("ukCommonsVacancies");
    expect(vacancies).toHaveLength(1);
    expect(vacancies[0].reason).toBe("resignation");
    expect((vacancies[0]._id as ObjectId).toString()).toBe(body.vacancyId);
  });

  it("404s when the caller holds no Commons seat", async () => {
    const character = mpCharacter({ currentOffice: null });
    fake.seed("characters", [character]);
    await authAs(character);

    const { POST } = await import("./resign/route");
    const res = await POST();
    expect(res.status).toBe(404);
  });
});

describe("POST /api/uk/commons/defect", () => {
  const URL = "http://localhost/api/uk/commons/defect";

  it("401s without a character", async () => {
    await authFails();
    const { POST } = await import("./defect/route");
    expect((await POST(post(URL, { toParty: "2" }))).status).toBe(401);
  });

  it("400s on a missing party and on defecting to the same party", async () => {
    const character = mpCharacter();
    fake.seed("characters", [character]);
    fake.seed("electedOfficials", [commonsSeat(character._id as ObjectId)]);
    await authAs(character);

    const { POST } = await import("./defect/route");
    expect((await POST(post(URL, {}))).status).toBe(400);
    expect((await POST(post(URL, { toParty: "1" }))).status).toBe(400);
  });

  it("moves the caller party and vacates with the defection reason", async () => {
    const character = mpCharacter();
    fake.seed("characters", [character]);
    fake.seed("electedOfficials", [commonsSeat(character._id as ObjectId)]);
    await authAs(character);

    const { POST } = await import("./defect/route");
    const res = await POST(post(URL, { toParty: "2" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toMatch(/no-store/);
    expect(fake.read<Record<string, unknown>>("characters")[0].party).toBe("2");
    const vacancies = fake.read<Record<string, unknown>>("ukCommonsVacancies");
    expect(vacancies).toHaveLength(1);
    expect(vacancies[0].reason).toBe("defection");
  });

  it("404s when the caller holds no Commons seat", async () => {
    const character = mpCharacter({ currentOffice: null });
    fake.seed("characters", [character]);
    await authAs(character);

    const { POST } = await import("./defect/route");
    expect((await POST(post(URL, { toParty: "2" }))).status).toBe(404);
  });
});

describe("POST /api/uk/commons/recall/sign", () => {
  const URL = "http://localhost/api/uk/commons/recall/sign";

  function openPetition(over: Record<string, unknown> = {}) {
    const petition = {
      _id: new ObjectId(),
      countryId: "UK",
      state: "LON",
      officialId: new ObjectId(),
      targetCharacterId: new ObjectId(),
      targetCharacterName: "Target MP",
      status: "open",
      trigger: "infamy",
      signatures: [],
      declarations: [],
      supportSamples: [],
      ...over,
    };
    fake.seed("ukRecallPetitions", [petition]);
    return petition;
  }

  it("401s without a character", async () => {
    await authFails();
    const { POST } = await import("./recall/sign/route");
    expect((await POST(post(URL, { petitionId: new ObjectId().toString() }))).status).toBe(401);
  });

  it("400s on a malformed petition id and 404s on an unknown one", async () => {
    await authAs(mpCharacter());
    const { POST } = await import("./recall/sign/route");
    expect((await POST(post(URL, { petitionId: "nope" }))).status).toBe(400);
    expect((await POST(post(URL, { petitionId: new ObjectId().toString() }))).status).toBe(404);
  });

  it("403s for non-UK characters", async () => {
    const petition = openPetition();
    await authAs(mpCharacter({ countryId: "US" }));
    const { POST } = await import("./recall/sign/route");
    const res = await POST(post(URL, { petitionId: (petition._id as ObjectId).toString() }));
    expect(res.status).toBe(403);
  });

  it("409s when the petition is not collecting signatures", async () => {
    const petition = openPetition({ status: "check" });
    await authAs(mpCharacter());
    const { POST } = await import("./recall/sign/route");
    const res = await POST(post(URL, { petitionId: (petition._id as ObjectId).toString() }));
    expect(res.status).toBe(409);
  });

  it("records a signature once: re-signing is a no-op success", async () => {
    const petition = openPetition();
    const signer = mpCharacter();
    await authAs(signer);
    const { POST } = await import("./recall/sign/route");
    const id = (petition._id as ObjectId).toString();

    const first = await POST(post(URL, { petitionId: id }));
    expect(first.status).toBe(200);
    expect(((await first.json()) as { added: boolean; signatures: number }).added).toBe(true);

    const second = await POST(post(URL, { petitionId: id }));
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { added: boolean; signatures: number };
    expect(secondBody).toMatchObject({ added: false, signatures: 1 });
  });
});

describe("POST /api/uk/commons/recall/declare", () => {
  const URL = "http://localhost/api/uk/commons/recall/declare";

  function checkPetition(over: Record<string, unknown> = {}) {
    const petition = {
      _id: new ObjectId(),
      countryId: "UK",
      state: "LON",
      officialId: new ObjectId(),
      targetCharacterId: new ObjectId(),
      targetCharacterName: "Target MP",
      status: "check",
      trigger: "lowApproval",
      signatures: [],
      declarations: [],
      supportSamples: [],
      ...over,
    };
    fake.seed("ukRecallPetitions", [petition]);
    return petition;
  }

  it("401s without a character", async () => {
    await authFails();
    const { POST } = await import("./recall/declare/route");
    expect(
      (await POST(post(URL, { petitionId: new ObjectId().toString(), side: "remove" }))).status
    ).toBe(401);
  });

  it("400s on an invalid side and 403s for non-UK characters", async () => {
    const petition = checkPetition();
    const id = (petition._id as ObjectId).toString();
    await authAs(mpCharacter());
    const { POST } = await import("./recall/declare/route");
    expect((await POST(post(URL, { petitionId: id, side: "maybe" }))).status).toBe(400);

    await authAs(mpCharacter({ countryId: "US" }));
    expect((await POST(post(URL, { petitionId: id, side: "remove" }))).status).toBe(403);
  });

  it("404s on an unknown petition and 409s outside the check window", async () => {
    await authAs(mpCharacter());
    const { POST } = await import("./recall/declare/route");
    expect(
      (await POST(post(URL, { petitionId: new ObjectId().toString(), side: "remove" }))).status
    ).toBe(404);

    const open = {
      _id: new ObjectId(),
      countryId: "UK",
      state: "LON",
      officialId: new ObjectId(),
      targetCharacterId: new ObjectId(),
      targetCharacterName: "Target MP",
      status: "open",
      trigger: "infamy",
      signatures: [],
      declarations: [],
      supportSamples: [],
    };
    fake.seed("ukRecallPetitions", [open]);
    expect(
      (await POST(post(URL, { petitionId: (open._id as ObjectId).toString(), side: "remove" })))
        .status
    ).toBe(409);
  });

  it("records, dedupes, and moves declarations between sides", async () => {
    const petition = checkPetition();
    const id = (petition._id as ObjectId).toString();
    await authAs(mpCharacter());
    const { POST } = await import("./recall/declare/route");

    const first = await POST(post(URL, { petitionId: id, side: "remove" }));
    expect(first.status).toBe(200);
    expect(((await first.json()) as { recorded: boolean }).recorded).toBe(true);

    const repeat = await POST(post(URL, { petitionId: id, side: "remove" }));
    expect(((await repeat.json()) as { recorded: boolean }).recorded).toBe(false);

    const moved = await POST(post(URL, { petitionId: id, side: "retain" }));
    expect(((await moved.json()) as { recorded: boolean }).recorded).toBe(true);
    const stored = fake.read<{
      declarations: Array<{ side: string }>;
    }>("ukRecallPetitions")[0];
    expect(stored.declarations).toHaveLength(1);
    expect(stored.declarations[0].side).toBe("retain");
  });
});
