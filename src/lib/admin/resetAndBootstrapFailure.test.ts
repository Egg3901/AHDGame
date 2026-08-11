/**
 * The orchestrator's failure behaviour.
 *
 * The real phases call ~100 seeders and reach `getDb()`, so they are mocked;
 * what is under test is the orchestration around them — that a run is always
 * recorded, that a structural abort is recorded as such, and that the record is
 * opened BEFORE anything is destroyed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/admin/resetGameWorld", () => ({ resetGameWorld: vi.fn() }));
vi.mock("@/lib/admin/bootstrapGameWorld", () => ({ bootstrapGameWorld: vi.fn() }));
vi.mock("@/lib/admin/finalizeResetGameWorld", () => ({ finalizeResetGameWorld: vi.fn() }));
vi.mock("@/lib/maintenanceStatus", () => ({
  enableMaintenanceMode: vi.fn(),
  normalizeMaintenanceMode: vi.fn(),
}));
vi.mock("@/lib/admin/seedDiagnostic", () => ({
  runSeedDiagnostic: vi.fn().mockResolvedValue({ summary: { critical: 0 } }),
  formatDiagnosticSummary: vi.fn().mockReturnValue("diagnostic ok"),
  captureSeedBaseline: vi.fn(),
  diagnosticErrorReport: vi.fn().mockReturnValue({}),
}));

const okTeardown = {
  message: "reset done",
  details: {
    officialsDeleted: 0,
    electionsDeleted: 0,
    nppsDeleted: 0,
    statePartyElectionsDeleted: 0,
    stateBillsDeleted: 0,
  },
};

const okFinalize = {
  demographicsReset: 0,
  customPartiesDeleted: 0,
  partyOrgRecordsDeleted: 0,
  finalizeLog: [],
  adminDetails: "Game reset: 0 characters retired",
};

describe("resetAndBootstrapGameWorld — failure handling", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { resetGameWorld } = await import("@/lib/admin/resetGameWorld");
    const { bootstrapGameWorld } = await import("@/lib/admin/bootstrapGameWorld");
    const { finalizeResetGameWorld } = await import("@/lib/admin/finalizeResetGameWorld");
    vi.mocked(resetGameWorld).mockResolvedValue(okTeardown as never);
    vi.mocked(bootstrapGameWorld).mockResolvedValue({} as never);
    vi.mocked(finalizeResetGameWorld).mockResolvedValue(okFinalize as never);
  });

  const run = async () => {
    const { resetAndBootstrapGameWorld } = await import("./resetAndBootstrapGameWorld");
    return resetAndBootstrapGameWorld({
      db: db as unknown as Db,
      preset: "1953-default",
      adminUsername: "arlebina",
    } as never);
  };

  const closeUpdate = () =>
    db.collectionMocks.adminLogs!.updateOne.mock.calls[0]![1] as { $set: Record<string, unknown> };

  it("opens the audit row BEFORE teardown runs", async () => {
    // If this inverts, the design reproduces the exact bug it fixes: a reset
    // that dies in teardown leaves no trace at all.
    const { resetGameWorld } = await import("@/lib/admin/resetGameWorld");
    const order: string[] = [];
    // `createMockDb` builds collection stubs lazily, so prime this one before
    // reaching for it — the orchestrator has not touched it yet.
    db.collection("adminLogs").insertOne.mockImplementation(async () => {
      order.push("open");
      return { insertedId: "x" };
    });
    vi.mocked(resetGameWorld).mockImplementation(async () => {
      order.push("teardown");
      return okTeardown as never;
    });

    await run();
    expect(order).toEqual(["open", "teardown"]);
  });

  it("closes the row failed with the phase when teardown throws", async () => {
    const { resetGameWorld } = await import("@/lib/admin/resetGameWorld");
    vi.mocked(resetGameWorld).mockRejectedValue(new Error("wipe died"));

    await expect(run()).rejects.toThrow("wipe died");

    expect(closeUpdate().$set["resetRun.status"]).toBe("failed");
    expect(closeUpdate().$set["resetRun.phaseReached"]).toBe("teardown");
    expect(db.collectionMocks.gameConfig!.updateOne).toHaveBeenCalled();
  });

  it("closes the row failed when the BUILD phase throws", async () => {
    const { bootstrapGameWorld } = await import("@/lib/admin/bootstrapGameWorld");
    vi.mocked(bootstrapGameWorld).mockRejectedValue(new Error("seed died"));

    await expect(run()).rejects.toThrow("seed died");
    expect(closeUpdate().$set["resetRun.status"]).toBe("failed");
    expect(closeUpdate().$set["resetRun.phaseReached"]).toBe("build");
  });

  it("marks a clean run succeeded and captures the baseline", async () => {
    const { captureSeedBaseline } = await import("@/lib/admin/seedDiagnostic");
    await run();
    expect(closeUpdate().$set["resetRun.status"]).toBe("succeeded");
    expect(captureSeedBaseline).toHaveBeenCalled();
  });

  it("threads the run record into the build phase so its blocks can be contained", async () => {
    const { bootstrapGameWorld } = await import("@/lib/admin/bootstrapGameWorld");
    vi.mocked(bootstrapGameWorld).mockImplementation((async (opts: {
      run?: { step: (p: string, n: string, fn: () => Promise<unknown>) => Promise<unknown> };
    }) => {
      await opts.run?.step("build", "seedUnions", async () => {
        throw new Error("unions died");
      });
      return {};
    }) as never);

    await run();

    expect(closeUpdate().$set["resetRun.status"]).toBe("partial");
    expect(closeUpdate().$set["resetRun.failures"]).toEqual([
      { phase: "build", name: "seedUnions", error: "unions died" },
    ]);
  });

  it("degrades to partial and skips the baseline when finalize is contained", async () => {
    // A contained failure means the world is knowingly incomplete. Capturing a
    // baseline from it would make every future drift check compare against a
    // broken reference.
    const { finalizeResetGameWorld } = await import("@/lib/admin/finalizeResetGameWorld");
    const { captureSeedBaseline } = await import("@/lib/admin/seedDiagnostic");
    vi.mocked(finalizeResetGameWorld).mockRejectedValue(new Error("finalize died"));

    await run();

    expect(closeUpdate().$set["resetRun.status"]).toBe("partial");
    expect(closeUpdate().$set["resetRun.failures"]).toEqual([
      { phase: "finalize", name: "finalizeResetGameWorld", error: "finalize died" },
    ]);
    expect(captureSeedBaseline).not.toHaveBeenCalled();
  });

  it("announces a PARTIAL outcome in the logs the admin is watching", async () => {
    // The status reaches the audit row either way; this is about the operator
    // seeing it live rather than discovering it later in the admin log.
    const { finalizeResetGameWorld } = await import("@/lib/admin/finalizeResetGameWorld");
    vi.mocked(finalizeResetGameWorld).mockRejectedValue(new Error("finalize died"));

    const result = await run();
    const logs = (result as unknown as { logs: string[] }).logs.join(" | ");

    expect(logs).toContain("finalizeResetGameWorld");
    expect(logs).toContain("PARTIAL");
    expect(logs).toContain("no seed baseline was captured");
  });
});

describe("build-phase containment boundary", () => {
  it("leaves the structural steps unwrapped, so they still abort", async () => {
    // A world without these is not a world. Containing them would let the rest
    // of the build seed on top of the damage and then report `partial`, which
    // reads as "mostly fine" — the opposite of the truth.
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.join(process.cwd(), "src", "lib", "admin", "bootstrapGameWorld.ts"),
      "utf8"
    );

    for (const structural of [
      "await seedAllCountryData(",
      "await initializeGameState(",
      'commandEconomyEnabledBy: "system:bootstrap"',
    ]) {
      const idx = src.indexOf(structural);
      expect(idx, `${structural} not found — update this test, do not delete it`).toBeGreaterThan(
        -1
      );
      const lineStart = src.lastIndexOf("\n", idx);
      expect(src.slice(lineStart, idx), `${structural} must not be contained`).not.toContain(
        "guarded("
      );
    }
  });

  it("does contain the recoverable blocks", async () => {
    // The other half: if these lost their containment the run would abort on a
    // seeder failure again, silently undoing the whole point.
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.join(process.cwd(), "src", "lib", "admin", "bootstrapGameWorld.ts"),
      "utf8"
    );
    for (const name of [
      "seedForex",
      "seedUnions",
      "seedUnownedSectors",
      "seedSovereignBondInstruments",
      "electionBattery",
      "spawnFoundingElections",
    ]) {
      expect(src, `${name} is no longer contained`).toContain(`guarded("${name}"`);
    }
  });
});
