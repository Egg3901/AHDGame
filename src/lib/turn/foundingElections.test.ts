import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { COUNTRY_ELECTION_PHASES } from "@/lib/turn/countryPhases";
import { spawnFoundingElections } from "@/lib/turn/foundingElections";

/**
 * `spawnFoundingElections` is the bootstrap-side half of the pre-iteration
 * founding phase: it creates the cycle-0 race for every registered election
 * family. These tests pin the two properties the phase depends on —
 *
 *   1. the sweep covers the WHOLE turn-loop registry (the bootstrap ensure*
 *      battery does not, which is why the Warsaw Pact founded nothing), and
 *   2. it is a best-effort sweep: one broken family cannot abort a reset.
 */

// `vi.hoisted` so the (hoisted, lazily-invoked) mock factory below can reach
// this state without tripping over the temporal dead zone.
const registryState = vi.hoisted(() => ({
  spawned: [] as string[],
  failing: new Set<string>(),
}));

// The registry is replaced so the sweep can be observed without standing up the
// real election machinery. The REAL registry is asserted separately, below.
vi.mock("@/lib/turn/countryPhases", () => {
  const state = registryState;
  // `delayMs` exists to make the within-country ordering assertion mean
  // something. Each family records itself only AFTER yielding, and the second
  // entry of UK/DE resolves FASTER than the first — so if the sweep ever ran a
  // country's families concurrently instead of in sequence, the mirror family
  // would land first and the ordering test would fail. Without the yield every
  // fn completes synchronously and declaration order survives any scheduling,
  // which would make that test pass vacuously.
  const entry = (name: string, delayMs = 0) => ({
    name,
    fn: async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (state.failing.has(name)) throw new Error(`${name} exploded`);
      state.spawned.push(name);
    },
  });
  return {
    COUNTRY_ELECTION_PHASES: {
      UK: [entry("ukElections", 10), entry("ukRegionalCouncilElections", 0)],
      DE: [entry("deLandtagElections", 10), entry("deMinisterPresidentElections", 0)],
      PL: [entry("plSejmElections")],
      YU: [entry("yuFederalAssemblyElections")],
    },
  };
});

describe("spawnFoundingElections", () => {
  let db: MockDb;

  beforeEach(() => {
    registryState.spawned.length = 0;
    registryState.failing.clear();
    db = createMockDb();
    db.collection("elections").countDocuments.mockResolvedValue(7);
  });

  it("invokes every family in the turn-loop registry", async () => {
    const result = await spawnFoundingElections(db as unknown as Db, new Date());

    // Coverage, not sequence. Countries run concurrently, so the order families
    // land in ACROSS countries is not a contract — the turn loop drives this
    // same registry with one flat Promise.all and no per-country sequencing at
    // all. What must hold is that every family ran; the within-country order
    // that does matter has its own test below.
    expect([...registryState.spawned].sort()).toEqual(
      [
        "deLandtagElections",
        "deMinisterPresidentElections",
        "plSejmElections",
        "ukElections",
        "ukRegionalCouncilElections",
        "yuFederalAssemblyElections",
      ].sort()
    );
    expect(result.attempted).toBe(6);
    expect(result.failed).toBe(0);
  });

  it("preserves per-country declaration order (DE Minister-President follows the Landtag)", async () => {
    // The one ordering guarantee the registry actually claims: the MP spawner
    // mirrors live Landtag timing and documents that it must run after it. UK's
    // pair is asserted too — both second entries resolve faster than their
    // first, so a country whose families ran concurrently would invert here.
    await spawnFoundingElections(db as unknown as Db, new Date());
    expect(registryState.spawned.indexOf("deLandtagElections")).toBeLessThan(
      registryState.spawned.indexOf("deMinisterPresidentElections")
    );
    expect(registryState.spawned.indexOf("ukElections")).toBeLessThan(
      registryState.spawned.indexOf("ukRegionalCouncilElections")
    );
  });

  it("honors the bootstrap skipRegionalCouncil opt-out", async () => {
    const result = await spawnFoundingElections(db as unknown as Db, new Date(), {
      skipRegionalCouncil: true,
    });
    expect(registryState.spawned).not.toContain("ukRegionalCouncilElections");
    expect(registryState.spawned).toContain("ukElections");
    expect(result.attempted).toBe(5);
  });

  it("logs and continues when one family throws — a broken spawner cannot abort the reset", async () => {
    registryState.failing.add("plSejmElections");
    const log = vi.fn();

    const result = await spawnFoundingElections(db as unknown as Db, new Date(), { log });

    expect(result.failed).toBe(1);
    // Families declared AFTER the failure still ran.
    expect(registryState.spawned).toContain("yuFederalAssemblyElections");
    expect(log.mock.calls.flat().join("\n")).toContain(
      "Founding spawn failed for PL/plSejmElections"
    );
  });

  it("reports the resulting cycle-0 race count", async () => {
    db.collection("elections").countDocuments.mockResolvedValue(412);
    const result = await spawnFoundingElections(db as unknown as Db, new Date());
    expect(result.foundingRaces).toBe(412);
    expect(db.collection("elections").countDocuments).toHaveBeenCalledWith({ cycle: 0 });
  });

  it("uses the mocked registry in this file (guards the mock from leaking)", () => {
    expect(Object.keys(COUNTRY_ELECTION_PHASES)).toEqual(["UK", "DE", "PL", "YU"]);
  });
});

describe("founding scope — the real COUNTRY_ELECTION_PHASES registry", () => {
  it("registers the Warsaw-Pact six, so a 1953 founding phase reaches them", async () => {
    const actual = (await vi.importActual(
      "@/lib/turn/countryPhases"
    )) as typeof import("@/lib/turn/countryPhases");

    // The pre-existing bootstrapGameWorld ensure* battery calls none of these,
    // which is why the bloc's legislatures stayed empty. Driving the founding
    // sweep off this registry is what brings them in scope.
    for (const countryId of ["PL", "CS", "HU", "RO", "BG", "YU"] as const) {
      expect(actual.COUNTRY_ELECTION_PHASES[countryId]?.length ?? 0).toBeGreaterThan(0);
    }
    // ...alongside the Cold-War player nations.
    expect(actual.COUNTRY_ELECTION_PHASES.RU?.length ?? 0).toBeGreaterThan(0);
    expect(actual.COUNTRY_ELECTION_PHASES.DD?.length ?? 0).toBeGreaterThan(0);
  });
});
