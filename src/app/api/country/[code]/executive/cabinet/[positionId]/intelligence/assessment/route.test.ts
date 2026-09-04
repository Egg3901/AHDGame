import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  ASSESS_ESTIMATE_COVERAGE,
  ASSESS_EXACT_COVERAGE,
  ASSESS_EXISTENCE_COVERAGE,
} from "@/lib/intelligence/config";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/cabinet/officeVisibility", () => ({ resolveCabinetOfficeVisibility: vi.fn() }));
vi.mock("@/lib/countryAccess", () => ({ getCountryAccessFromDb: vi.fn() }));
vi.mock("@/lib/db/collections/nuclearPrograms", () => ({ getNuclearProgram: vi.fn() }));
vi.mock("@/lib/db/collections/covertNuclearPrograms", () => ({
  getCovertNuclearProgram: vi.fn(),
}));
vi.mock("@/lib/db/collections/conflicts", () => ({ listActiveConflicts: vi.fn(async () => []) }));
vi.mock("@/lib/db/collections/militaryUnits", () => ({
  getMilitaryUnitsCollection: () => ({
    find: () => ({ project: () => ({ toArray: async () => militaryUnits }) }),
  }),
}));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const { resolveCabinetOfficeVisibility } = await import("@/lib/cabinet/officeVisibility");
const { getCountryAccessFromDb } = await import("@/lib/countryAccess");
const { getNuclearProgram } = await import("@/lib/db/collections/nuclearPrograms");
const { getCovertNuclearProgram } = await import("@/lib/db/collections/covertNuclearPrograms");

let militaryUnits: Array<{ readiness: number }> = [];

const HOLDER = "char_holder";
const TURN = 10;

let db: MockDb;

const call = (positionId = "director_of_intelligence", code = "us") => ({
  params: Promise.resolve({ code, positionId }),
});

async function get(target = "RU", positionId?: string, code?: string, domain?: string) {
  const { GET } = await import("./route");
  const q = `http://t?target=${target}${domain ? `&domain=${domain}` : ""}`;
  const res = await GET(new Request(q), call(positionId, code));
  if (!res) throw new Error("route returned no response");
  return res;
}

function setCoverage(value: number | null) {
  db.collectionMocks.intelligenceCoverage.findOne.mockResolvedValue(
    value === null ? null : { valueAtCollection: value, lastCollectedTurn: TURN }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { isAdmin: false, character: { _id: HOLDER }, userId: "u1" },
  } as never);
  vi.mocked(resolveCabinetOfficeVisibility).mockResolvedValue({
    canView: true,
    canAct: true,
  } as never);
  vi.mocked(getCountryAccessFromDb).mockResolvedValue({ registered: true } as never);
  vi.mocked(getNuclearProgram).mockResolvedValue({
    _id: "RU",
    adopted: { fission: 1, boosted: 2 },
    warheads: 200,
    productionRate: 0,
    updatedAt: new Date(0),
  } as never);
  vi.mocked(getCovertNuclearProgram).mockResolvedValue({
    _id: "DD",
    stage: 3,
    progress: 0,
    funding: "steady",
    suspicion: 40,
    exposureCount: 0,
    completed: false,
    updatedAt: new Date(0),
  } as never);

  db.collection("gameState");
  db.collection("cabinetMembers");
  db.collection("intelligenceCoverage");
  db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: TURN });
  db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
    _id: "m1",
    countryId: "US",
    positionId: "director_of_intelligence",
    characterId: HOLDER,
  });
  setCoverage(null);
  militaryUnits = [];
});

describe("GET nuclear assessment", () => {
  it("404s a position that is not the intelligence seat", async () => {
    expect((await get("RU", "secretary_of_defense")).status).toBe(404);
  });

  it("400s a missing or unknown target", async () => {
    expect((await get("")).status).toBe(400);
    expect((await get("zz")).status).toBe(400);
  });

  it("404s a target dissolved out of the registry", async () => {
    vi.mocked(getCountryAccessFromDb).mockResolvedValue({ registered: false } as never);
    expect((await get("RU")).status).toBe(404);
  });

  it("403s a viewer who may not read the office", async () => {
    vi.mocked(resolveCabinetOfficeVisibility).mockResolvedValue({
      canView: false,
      canAct: false,
    } as never);
    expect((await get("RU")).status).toBe(403);
  });

  it("knows nothing with no coverage at all", async () => {
    const body = await (await get("RU")).json();
    expect(body.coverage).toBe(0);
    expect(body.assessment.tier).toBe("none");
    expect(body.assessment.hasProgramme).toBeNull();
    expect(body.assessment.warheads).toBeNull();
  });

  it("answers only the existence question at the existence tier", async () => {
    setCoverage(ASSESS_EXISTENCE_COVERAGE);
    const body = await (await get("RU")).json();
    expect(body.assessment.hasProgramme).toBe(true);
    expect(body.assessment.warheads).toBeNull();
  });

  it("gives a fogged estimate at the estimate tier", async () => {
    setCoverage(ASSESS_ESTIMATE_COVERAGE);
    const body = await (await get("RU")).json();
    expect(body.assessment.warheadsAreEstimate).toBe(true);
    expect(body.assessment.warheads).not.toBe(200);
  });

  it("gives the exact count at the exact tier", async () => {
    setCoverage(ASSESS_EXACT_COVERAGE);
    const body = await (await get("RU")).json();
    expect(body.assessment.warheadsAreEstimate).toBe(false);
    expect(body.assessment.warheads).toBe(200);
  });

  it("never serves the raw facts or a fog factor", async () => {
    setCoverage(ASSESS_ESTIMATE_COVERAGE);
    const raw = await (await get("RU")).text();
    // Publishing the factor makes every estimate invertible.
    expect(raw).not.toContain("fogFactor");
    expect(raw).not.toContain("productionRate");
    expect(raw).not.toContain("suspicion");
  });

  it("does not look for a covert programme in a country that cannot run one", async () => {
    setCoverage(ASSESS_EXACT_COVERAGE);
    const body = await (await get("RU")).json();
    expect(getCovertNuclearProgram).not.toHaveBeenCalled();
    expect(body.assessment.covertSuspected).toBe(false);
    expect(body.assessment.covertStage).toBeNull();
  });

  it("suspects but does not size East Germany's covert programme at the estimate tier", async () => {
    setCoverage(ASSESS_ESTIMATE_COVERAGE);
    const body = await (await get("DD")).json();
    expect(body.assessment.covertSuspected).toBe(true);
    expect(body.assessment.covertStage).toBeNull();
  });

  it("reveals the covert stage only at the exact tier", async () => {
    setCoverage(ASSESS_EXACT_COVERAGE);
    const body = await (await get("DD")).json();
    expect(body.assessment.covertStage).toBe(3);
    expect(body.assessment.covertStageCount).toBe(5);
  });

  it("treats an unstarted covert programme as nothing to find", async () => {
    vi.mocked(getCovertNuclearProgram).mockResolvedValue({
      _id: "DD",
      stage: 0,
      progress: 0,
      funding: "none",
      suspicion: 0,
      exposureCount: 0,
      completed: false,
      updatedAt: new Date(0),
    } as never);
    setCoverage(ASSESS_EXACT_COVERAGE);
    const body = await (await get("DD")).json();
    expect(body.assessment.covertSuspected).toBe(false);
  });

  it("decays stored coverage before grading the tier", async () => {
    db.collectionMocks.intelligenceCoverage.findOne.mockResolvedValue({
      valueAtCollection: 100,
      lastCollectedTurn: 0,
    });
    const body = await (await get("RU")).json();
    // 100 collected on turn 0, read on turn 10, decaying 2 a turn: 80.
    expect(body.coverage).toBe(80);
  });
});

describe("military assessment", () => {
  it("400s an unknown domain", async () => {
    expect((await get("RU", undefined, undefined, "political")).status).toBe(400);
  });

  it("reads nothing without military coverage", async () => {
    const body = await (await get("RU", undefined, undefined, "military")).json();
    expect(body.domain).toBe("military");
    expect(body.assessment.atWar).toBeNull();
    expect(body.assessment.formationCount).toBeNull();
  });

  it("reads coverage from the MILITARY row, not the strategic one", async () => {
    // A service deep in a country's nuclear programme has not thereby earned a
    // reading of its order of battle.
    db.collectionMocks.intelligenceCoverage.findOne.mockImplementation(
      async (f: Record<string, unknown>) =>
        f.domain === "military"
          ? { valueAtCollection: ASSESS_EXISTENCE_COVERAGE, lastCollectedTurn: TURN }
          : { valueAtCollection: ASSESS_EXACT_COVERAGE, lastCollectedTurn: TURN }
    );
    const body = await (await get("RU", undefined, undefined, "military")).json();
    expect(body.assessment.tier).toBe("existence");
  });

  it("counts formations and reports peace at the exact tier", async () => {
    setCoverage(ASSESS_EXACT_COVERAGE);
    militaryUnits = [{ readiness: 80 }, { readiness: 60 }];
    const body = await (await get("RU", undefined, undefined, "military")).json();
    expect(body.assessment.formationCount).toBe(2);
    expect(body.assessment.meanReadiness).toBe(70);
    expect(body.assessment.atWar).toBe(false);
    expect(body.assessment.fronts).toEqual([]);
  });

  it("never serves per-front supply below the exact tier", async () => {
    setCoverage(ASSESS_ESTIMATE_COVERAGE);
    militaryUnits = [{ readiness: 80 }];
    const body = await (await get("RU", undefined, undefined, "military")).json();
    expect(body.assessment.fronts).toBeNull();
    expect(body.assessment.figuresAreEstimate).toBe(true);
  });

  it("defaults to the strategic domain when none is asked for", async () => {
    setCoverage(ASSESS_EXISTENCE_COVERAGE);
    const body = await (await get("RU")).json();
    expect(body.domain).toBe("strategic");
  });
});
