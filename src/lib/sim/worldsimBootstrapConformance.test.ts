import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";

/**
 * #1992: fresh worldsim bootstraps must persist a seed conformance diagnostic
 * before any turn advances, so the audit can separate bad seed data from
 * mechanical drift. Resumed runs must never overwrite the original baseline,
 * findings must never abort the sim, and a diagnostic throw must stay visible.
 */

vi.mock("@/lib/admin/seedDiagnostic", () => ({
  runSeedDiagnostic: vi.fn(),
  captureSeedBaseline: vi.fn(),
  loadSeedBaseline: vi.fn(),
  diagnosticErrorReport: vi.fn(),
  formatDiagnosticSummary: vi.fn(
    (report: { summary: { ok: number; warn: number; critical: number } }) =>
      `Seed diagnostic (conformance): ${report.summary.ok} ok, ${report.summary.warn} warn, ${report.summary.critical} critical`
  ),
}));

const { runWorldsimBootstrapConformance, buildWorldsimFeatureManifest } =
  await import("./worldsimBootstrapConformance");
const seedDiagnostic = await import("@/lib/admin/seedDiagnostic");

function makeDb(existing: unknown): {
  db: Db;
  seedDiagnostics: { findOne: ReturnType<typeof vi.fn> };
} {
  const seedDiagnostics = { findOne: vi.fn(async () => existing) };
  const db = {
    collection: vi.fn((name: string) => {
      if (name === "seedDiagnostics") return seedDiagnostics;
      throw new Error(`unexpected collection ${name}`);
    }),
  } as unknown as Db;
  return { db, seedDiagnostics };
}

function provenance() {
  return {
    runId: "run-1",
    seed: "seed-1",
    preset: "1953-default",
    sourceRevision: "abc123",
    sourceWorktree: null,
    featureManifest: buildWorldsimFeatureManifest({
      autonomyLevel: "v3",
      actorMode: "pure-npp",
      simTurnPhaseMode: "full",
      preIteration: true,
      preservePlayerRail: false,
      commandEconomy: false,
      scarcityDrift: false,
      brandLoyalty: false,
      brandLoyaltySlice: false,
      sectorQuality: false,
      demographicsDemand: false,
      macroGrowth: false,
      allFeatureFlags: false,
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runWorldsimBootstrapConformance", () => {
  it("persists a worldsim-post-bootstrap conformance report with provenance before any turn", async () => {
    const { db } = makeDb(null);
    vi.mocked(seedDiagnostic.runSeedDiagnostic).mockResolvedValue({
      summary: { ok: 10, warn: 1, critical: 0 },
    } as never);
    vi.mocked(seedDiagnostic.loadSeedBaseline).mockResolvedValue(null);

    const result = await runWorldsimBootstrapConformance(db, provenance());

    expect(seedDiagnostic.runSeedDiagnostic).toHaveBeenCalledOnce();
    const opts = vi.mocked(seedDiagnostic.runSeedDiagnostic).mock.calls[0]![1];
    expect(opts).toMatchObject({
      mode: "conformance",
      trigger: "worldsim-post-bootstrap",
      preset: "1953-default",
      runId: "run-1",
      seed: "seed-1",
      sourceRevision: "abc123",
    });
    expect(opts).toHaveProperty("featureManifest");
    expect(result.status).toBe("reported");
    expect(result.baselineCaptured).toBe(true);
    expect(seedDiagnostic.captureSeedBaseline).toHaveBeenCalledOnce();
  });

  it("is idempotent on resume: never re-runs conformance or replaces the baseline", async () => {
    const { db } = makeDb({ mode: "conformance", trigger: "worldsim-post-bootstrap" });

    const result = await runWorldsimBootstrapConformance(db, provenance());

    expect(result.status).toBe("skipped-existing");
    expect(seedDiagnostic.runSeedDiagnostic).not.toHaveBeenCalled();
    expect(seedDiagnostic.captureSeedBaseline).not.toHaveBeenCalled();
    expect(result.baselineCaptured).toBe(false);
  });

  it("records critical findings without aborting and skips baseline capture", async () => {
    const { db } = makeDb(null);
    vi.mocked(seedDiagnostic.runSeedDiagnostic).mockResolvedValue({
      summary: { ok: 9, warn: 0, critical: 2 },
    } as never);

    const result = await runWorldsimBootstrapConformance(db, provenance());

    expect(result.status).toBe("reported");
    expect(result.baselineCaptured).toBe(false);
    expect(seedDiagnostic.captureSeedBaseline).not.toHaveBeenCalled();
    expect(seedDiagnostic.loadSeedBaseline).not.toHaveBeenCalled();
  });

  it("makes a diagnostic throw visible without throwing", async () => {
    const { db } = makeDb(null);
    vi.mocked(seedDiagnostic.runSeedDiagnostic).mockRejectedValue(new Error("boom"));
    vi.mocked(seedDiagnostic.diagnosticErrorReport).mockReturnValue({
      mode: "conformance",
    } as never);

    const result = await runWorldsimBootstrapConformance(db, provenance());

    expect(result.status).toBe("diagnostic-error");
    expect(seedDiagnostic.diagnosticErrorReport).toHaveBeenCalledOnce();
    expect(vi.mocked(seedDiagnostic.diagnosticErrorReport).mock.calls[0]![1]).toMatchObject({
      preset: "1953-default",
      trigger: "worldsim-post-bootstrap",
    });
    expect(seedDiagnostic.captureSeedBaseline).not.toHaveBeenCalled();
    expect(result.summary).toContain("boom");
  });
});

describe("buildWorldsimFeatureManifest", () => {
  it("records the effective run configuration deterministically", () => {
    const manifest = buildWorldsimFeatureManifest({
      autonomyLevel: "v3",
      actorMode: "pure-npp",
      simTurnPhaseMode: "full",
      preIteration: true,
      preservePlayerRail: false,
      commandEconomy: false,
      scarcityDrift: false,
      brandLoyalty: false,
      brandLoyaltySlice: false,
      sectorQuality: false,
      demographicsDemand: false,
      macroGrowth: false,
      allFeatureFlags: true,
      marketMode: "capital",
    });
    expect(manifest).toMatchObject({
      autonomyLevel: "v3",
      actorMode: "pure-npp",
      simTurnPhaseMode: "full",
      preIteration: true,
      allFeatureFlags: true,
      marketMode: "capital",
    });
    expect(JSON.stringify(manifest)).toBe(
      JSON.stringify(
        buildWorldsimFeatureManifest({
          autonomyLevel: "v3",
          actorMode: "pure-npp",
          simTurnPhaseMode: "full",
          preIteration: true,
          preservePlayerRail: false,
          commandEconomy: false,
          scarcityDrift: false,
          brandLoyalty: false,
          brandLoyaltySlice: false,
          sectorQuality: false,
          demographicsDemand: false,
          macroGrowth: false,
          allFeatureFlags: true,
          marketMode: "capital",
        })
      )
    );
  });
});
