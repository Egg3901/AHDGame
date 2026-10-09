import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/elections/electionParamResolution", () => ({
  resolveElectionRouteParam: vi.fn(),
}));
vi.mock("@/lib/elections/primaryPartyDetail", () => ({ loadPrimaryPartyData: vi.fn() }));
vi.mock("@/lib/maps/subdivisionData", () => ({ loadSubdivisionFile: vi.fn() }));
vi.mock("@/lib/db/collections/gameState", () => ({
  getGameStatePresetOrDefault: vi.fn().mockResolvedValue("2027"),
}));
vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({ currentTurn: 10 }),
}));
vi.mock("@/lib/campaigns/fieldOffices/engine", () => ({
  loadFieldOfficesForElection: vi.fn().mockResolvedValue([]),
}));

const ELECTION_OID = new ObjectId();
const C1 = new ObjectId();
const C2 = new ObjectId();
const CH1 = new ObjectId();
const CH2 = new ObjectId();

function partyData(byState: Record<string, Record<string, number>>) {
  return {
    detail: {
      partyId: "1",
      partyName: "Democratic Party",
      partyColor: "#2563eb",
      candidates: [
        { id: C1.toString(), name: "Left Lane", color: "#2563eb" },
        { id: C2.toString(), name: "Centre Lane", color: "#16a34a" },
      ],
      byState,
      stateNameById: {},
      votedStateIds: ["IA"],
      viewerCampaign: null,
    },
    candidates: [
      { _id: C1, characterId: CH1, isNPP: false },
      { _id: C2, characterId: CH2, isNPP: false },
    ],
    charMap: new Map([
      [CH1.toString(), { policies: { economic: -3 } }],
      [CH2.toString(), { policies: { economic: 0 } }],
    ]),
    nppMap: new Map(),
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { clearPartyDataCache } = await import("@/lib/elections/primaryRegional/partyDataCache");
  clearPartyDataCache();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue({} as Db);
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({ ok: true, user: { userId: "u1" } } as never);
  const { resolveElectionRouteParam } = await import("@/lib/elections/electionParamResolution");
  vi.mocked(resolveElectionRouteParam).mockResolvedValue({
    ok: true,
    election: { _id: ELECTION_OID, electionType: "president", countryId: "US" },
  } as never);
  const { loadSubdivisionFile } = await import("@/lib/maps/subdivisionData");
  vi.mocked(loadSubdivisionFile).mockResolvedValue({
    viewBox: "0 0 10 10",
    subdivisions: [
      { id: "19001", name: "Left County", path: "M0 0", electorate: 1000, leanScalar: -20 },
      { id: "19003", name: "Right County", path: "M1 1", electorate: 1000, leanScalar: 20 },
    ],
  } as never);
});

async function call(stateId: string) {
  const { GET } = await import("./route");
  return GET(new Request("http://t"), {
    params: Promise.resolve({ id: ELECTION_OID.toString(), partyId: "1", stateId }),
  });
}

describe("GET primary county results", () => {
  it("splits the state's primary result across its counties by relative ideology", async () => {
    const { loadPrimaryPartyData } = await import("@/lib/elections/primaryPartyDetail");
    vi.mocked(loadPrimaryPartyData).mockResolvedValue(
      partyData({ IA: { [C1.toString()]: 1000, [C2.toString()]: 1000 } }) as never
    );
    const res = await call("ia");
    expect(res.status).toBe(200);
    const body = await res.json();
    const [left, right] = body.subdivisions;
    expect(left.winner).toBe(C1.toString());
    expect(right.winner).toBe(C2.toString());
    expect(body.candidateColors[C2.toString()]).toBe("#16a34a");
    expect(body.voted).toBe(true);
  });

  it("pulls a candidate's votes toward a county with their field office", async () => {
    const { loadPrimaryPartyData } = await import("@/lib/elections/primaryPartyDetail");
    vi.mocked(loadPrimaryPartyData).mockResolvedValue(
      partyData({ IA: { [C1.toString()]: 1000, [C2.toString()]: 1000 } }) as never
    );
    const base = await (await call("IA")).json();
    const { loadFieldOfficesForElection } = await import("@/lib/campaigns/fieldOffices/engine");
    vi.mocked(loadFieldOfficesForElection).mockResolvedValueOnce([
      {
        candidateId: CH2,
        regionId: "IA",
        subdivisionId: "19001",
        openedTurn: 1,
        yieldFactor: 1,
      },
    ] as never);
    const boosted = await (await call("IA")).json();
    const c2In = (b: { subdivisions: { id: string; votes: Record<string, number> }[] }) =>
      b.subdivisions.find((s) => s.id === "19001")!.votes[C2.toString()];
    expect(c2In(boosted)).toBeGreaterThan(c2In(base));
  });

  it("404s a state with no primary result yet", async () => {
    const { loadPrimaryPartyData } = await import("@/lib/elections/primaryPartyDetail");
    vi.mocked(loadPrimaryPartyData).mockResolvedValue(partyData({}) as never);
    expect((await call("IA")).status).toBe(404);
  });

  it("rejects a malformed state id", async () => {
    expect((await call("IOWA")).status).toBe(400);
  });

  it("requires a session", async () => {
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    } as never);
    expect((await call("IA")).status).toBe(401);
  });
});
