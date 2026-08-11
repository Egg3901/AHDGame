import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { presetDefaultsToFoundingPhase } from "@/lib/seeds/presetSelector";

/**
 * The founding phase existed in code but never activated on a real world,
 * because `preIteration` had to be passed by hand and nothing passed it. These
 * tests pin the resolution rule that makes a normal 1953 admin reset found:
 *
 *   explicit option  >  preset default  >  off
 *   ...and never for `seedOnly` / `mode: "vacant"`, which spawn no founding
 *   races and would pin the calendar to the era start forever.
 */

vi.mock("@/lib/admin/resetGameWorld", () => ({
  resetGameWorld: vi.fn(async () => ({
    success: true as const,
    message: "reset",
    details: {},
  })),
}));
vi.mock("@/lib/admin/bootstrapGameWorld", () => ({ bootstrapGameWorld: vi.fn(async () => ({})) }));
vi.mock("@/lib/npp/seedHistorical", () => ({
  seedHistoricalOfficials: vi.fn(async () => ({ officialsCreated: 0, nppsCreated: 0 })),
}));
vi.mock("@/lib/maintenanceStatus", () => ({ enableMaintenanceMode: vi.fn(async () => {}) }));
vi.mock("@/lib/admin/finalizeResetGameWorld", () => ({
  finalizeResetGameWorld: vi.fn(async () => ({
    demographicsReset: 0,
    customPartiesDeleted: 0,
    partyOrgRecordsDeleted: 0,
    finalizeLog: [],
  })),
}));
vi.mock("@/lib/admin/seedDiagnostic", () => ({
  runSeedDiagnostic: vi.fn(async () => ({ summary: { critical: 0 } })),
  formatDiagnosticSummary: vi.fn(() => "diagnostic ok"),
  captureSeedBaseline: vi.fn(async () => {}),
  diagnosticErrorReport: vi.fn(() => ({})),
}));

const { resetAndBootstrapGameWorld } = await import("@/lib/admin/resetAndBootstrapGameWorld");
const { resetGameWorld } = await import("@/lib/admin/resetGameWorld");
const { bootstrapGameWorld } = await import("@/lib/admin/bootstrapGameWorld");

// `collection` is exercised because the orchestrator now stamps
// `isActive: false` on gameState as step 0, sealing the world before the reset
// touches anything. Nothing here asserts on that write; the stub just has to
// exist so the founding-flag resolution can be reached.
const db = {
  collection: () => ({ updateOne: async () => ({}), insertOne: async () => ({}) }),
} as unknown as Db;

/** The founding flag as it reached BOTH downstream phases. */
async function resolvedPreIteration(
  options: Partial<Parameters<typeof resetAndBootstrapGameWorld>[0]>
): Promise<{ reset: boolean; bootstrap: boolean }> {
  vi.clearAllMocks();
  await resetAndBootstrapGameWorld({ db, preset: "2019-default", ...options });
  return {
    reset: vi.mocked(resetGameWorld).mock.calls[0]![1].preIteration === true,
    bootstrap: vi.mocked(bootstrapGameWorld).mock.calls[0]![0].preIteration === true,
  };
}

describe("presetDefaultsToFoundingPhase", () => {
  it("founds a fresh 1953 world", () => {
    expect(presetDefaultsToFoundingPhase("1953-default")).toBe(true);
  });

  it("leaves every other era preset alone — modern presets ship full chamber rosters", () => {
    for (const preset of [
      "1979-default",
      "1991-default",
      "1999-default",
      "2007-default",
      "2019-default",
      "2023-default",
      "empty",
      "2019-no-parties",
    ]) {
      expect(presetDefaultsToFoundingPhase(preset)).toBe(false);
    }
  });
});

describe("resetAndBootstrapGameWorld — founding phase resolution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("activates the founding phase on a plain 1953 historical bootstrap", async () => {
    // Exactly what the admin "Reset + Historical Bootstrap" button sends:
    // bootstrap + historical, and no preIteration key at all.
    expect(await resolvedPreIteration({ preset: "1953-default", mode: "historical" })).toEqual({
      reset: true,
      bootstrap: true,
    });
  });

  it("leaves modern presets untouched", async () => {
    for (const preset of ["1991-default", "1999-default", "2007-default", "2019-default"]) {
      expect(await resolvedPreIteration({ preset, mode: "historical" })).toEqual({
        reset: false,
        bootstrap: false,
      });
    }
  });

  it("lets an explicit false opt a 1953 reset out", async () => {
    expect(
      await resolvedPreIteration({
        preset: "1953-default",
        mode: "historical",
        preIteration: false,
      })
    ).toEqual({ reset: false, bootstrap: false });
  });

  it("lets an explicit true opt a non-defaulting preset in", async () => {
    expect(
      await resolvedPreIteration({
        preset: "1979-default",
        mode: "historical",
        preIteration: true,
      })
    ).toEqual({ reset: true, bootstrap: true });
  });

  it("refuses to found a seedOnly reset even when asked — no ensure* battery runs", async () => {
    expect(
      await resolvedPreIteration({
        preset: "1953-default",
        mode: "historical",
        seedOnly: true,
        preIteration: true,
      })
    ).toEqual({ reset: false, bootstrap: false });
  });

  it("refuses to found a vacant bootstrap even when asked — no candidate pool", async () => {
    expect(
      await resolvedPreIteration({
        preset: "1953-default",
        mode: "vacant",
        preIteration: true,
      })
    ).toEqual({ reset: false, bootstrap: false });
  });

  it("announces the founding phase in the reset log", async () => {
    vi.clearAllMocks();
    const { logs } = await resetAndBootstrapGameWorld({
      db,
      preset: "1953-default",
      mode: "historical",
    });
    expect(logs.join("\n")).toContain("Pre-iteration founding phase ON for 1953-default");
    expect(logs.join("\n")).toContain("(preset default)");
  });
});
