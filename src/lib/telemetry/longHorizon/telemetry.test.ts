import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import {
  appendApprovalTelemetry,
  appendMacroTelemetry,
  readApprovalSeries,
  readApprovalSeriesWithFallback,
  readLongHorizonTelemetryReport,
  readMacroSeries,
  resolveLongHorizonContext,
} from "./telemetry";

interface MockDbOptions {
  databaseName?: string;
  gameState?: unknown;
  simRun?: unknown;
  officials?: unknown[];
  formations?: unknown[];
  macroDocs?: unknown[];
  states?: unknown[];
  approvalRows?: unknown[];
  macroRows?: unknown[];
  nationalApprovalDoc?: unknown;
  regionalApprovalDoc?: unknown;
}

function makeDb(opts: MockDbOptions) {
  const bulkWrites: Record<string, unknown[][]> = {};
  const findCalls: Array<{ collection: string; filter: unknown; options: unknown }> = [];

  const rowsFor = (name: string): unknown[] => {
    if (name === "approvalTelemetry") return opts.approvalRows ?? [];
    if (name === "macroTelemetry") return opts.macroRows ?? [];
    return [];
  };

  const db = {
    databaseName: opts.databaseName ?? "ahd_sim_1991_r3",
    collection: vi.fn((name: string) => {
      if (name === "gameState") {
        return { findOne: async () => opts.gameState ?? null };
      }
      if (name === "simRuns") {
        return {
          findOne: async (filter: unknown, options: unknown) => {
            findCalls.push({ collection: name, filter, options });
            return opts.simRun ?? null;
          },
        };
      }
      if (name === "electedOfficials") {
        return {
          find: () => ({ toArray: async () => opts.officials ?? [] }),
        };
      }
      if (name === "governmentFormations") {
        return {
          find: () => ({ toArray: async () => opts.formations ?? [] }),
        };
      }
      if (name === "macroMetrics") {
        return {
          find: (filter: unknown, options: unknown) => {
            findCalls.push({ collection: name, filter, options });
            return { toArray: async () => opts.macroDocs ?? [] };
          },
        };
      }
      if (name === "states") {
        return {
          find: (filter: unknown, options: unknown) => {
            findCalls.push({ collection: name, filter, options });
            return { toArray: async () => opts.states ?? [] };
          },
        };
      }
      if (name === "governmentApprovals") {
        return { findOne: async () => opts.nationalApprovalDoc ?? null };
      }
      if (name === "stateApprovalHistory") {
        return { findOne: async () => opts.regionalApprovalDoc ?? null };
      }
      if (name === "approvalTelemetry" || name === "macroTelemetry") {
        return {
          bulkWrite: async (ops: unknown[]) => {
            (bulkWrites[name] ??= []).push(ops);
            return { ok: 1 };
          },
          find: (filter: unknown, options: unknown) => {
            findCalls.push({ collection: name, filter, options });
            const sorted = () => ({
              toArray: async () =>
                [...rowsFor(name)].sort(
                  (a, b) =>
                    ((a as { turn?: number }).turn ?? 0) - ((b as { turn?: number }).turn ?? 0)
                ),
            });
            return {
              sort: sorted,
              toArray: async () => rowsFor(name),
            };
          },
        };
      }
      throw new Error(`Unexpected collection: ${name}`);
    }),
  };
  return { db: db as unknown as Db, bulkWrites, findCalls };
}

const GAME_STATE = {
  _id: "current",
  currentTurn: 10,
  currentYear: 1991,
  startingYear: 1991,
  preset: "1991-default",
  iteration: { type: "Beta", number: 3 },
  preIterationTurns: 5,
};

const SIM_RUN = {
  _id: "1991-r3",
  runId: "1991-r3",
  seed: "seed-7",
  source: { executedCommit: "abc123" },
  dbName: "ahd_sim_1991_r3",
  status: "running",
  startedAt: new Date("2026-01-01T00:00:00Z"),
  effectiveConfigInitial: {
    capturedAtTurn: 0,
    gameState: { macroGrowthV1: true },
    gameConfig: { labourSystemMode: "full" },
  },
  actorMode: "pure-npp",
  autonomyLevel: "v4",
  actorCoverage: { registryVersion: 2 },
};

function requireContext<T>(value: T | null): T {
  expect(value).not.toBeNull();
  if (value === null) throw new Error("expected telemetry context");
  return value;
}

function pipelineValue(update: unknown, field: string): unknown {
  const pipeline = update as Array<{ $set: Record<string, { $ifNull: [string, unknown] }> }>;
  return pipeline[0].$set[field]?.$ifNull[1];
}

describe("resolveLongHorizonContext", () => {
  it("derives world, run, year, and governing-actor provenance from live docs", async () => {
    const characterId = new ObjectId();
    const { db, findCalls } = makeDb({
      gameState: GAME_STATE,
      simRun: SIM_RUN,
      officials: [
        {
          countryId: "US",
          officeType: "president",
          party: "9",
          characterId,
          electedAt: new Date("1991-02-01T00:00:00Z"),
        },
      ],
    });

    const ctx = requireContext(await resolveLongHorizonContext(db, 10));

    expect(ctx.worldId).toBe("1991-default:Beta-3");
    expect(ctx.sourceClass).toBe("sandbox");
    expect(ctx.runId).toBe("1991-r3");
    expect(ctx.seed).toBe("seed-7");
    expect(ctx.codeVersion).toBe("abc123");
    expect(ctx.effectiveManifest).toEqual(SIM_RUN.effectiveConfigInitial);
    expect(ctx.actorConfiguration).toEqual({
      mode: "pure-npp",
      autonomyLevel: "v4",
      coverageRegistryVersion: 2,
    });
    expect(findCalls.find((call) => call.collection === "simRuns")).toEqual({
      collection: "simRuns",
      filter: { dbName: "ahd_sim_1991_r3", status: "running" },
      options: { sort: { startedAt: -1, _id: -1 } },
    });
    // Raw turn 10 with a 5-turn founding offset resumes the calendar at turn 5.
    expect(ctx.year).toBe(1991);
    expect(ctx.foundingTurn).toBe(false);
    expect(ctx.governingByCountry.get("US")).toEqual({
      officeType: "president",
      party: "9",
      characterId: characterId.toString(),
    });
  });

  it("flags founding turns and degrades without a run manifest", async () => {
    const { db } = makeDb({
      databaseName: "ahd_game",
      gameState: { ...GAME_STATE, preIteration: { active: true, startedTurn: 1 } },
      simRun: null,
      officials: [],
    });

    const ctx = requireContext(await resolveLongHorizonContext(db, 3));

    expect(ctx.sourceClass).toBe("multiplayer");
    expect(ctx.runId).toBeUndefined();
    expect(ctx.foundingTurn).toBe(true);
    expect(ctx.governingByCountry.size).toBe(0);
  });

  it("skips unidentified worlds and single-player worlds without explicit consent", async () => {
    const missing = makeDb({ gameState: null });
    expect(await resolveLongHorizonContext(missing.db, 1)).toBeNull();

    const optedOut = makeDb({
      databaseName: "ahd_local",
      gameState: {
        ...GAME_STATE,
        singleplayerConfig: { mode: "normal", longHorizonTelemetryEnabled: false },
      },
    });
    expect(await resolveLongHorizonContext(optedOut.db, 1)).toBeNull();

    const optedIn = makeDb({
      databaseName: "ahd_local",
      gameState: {
        ...GAME_STATE,
        singleplayerConfig: { mode: "normal", longHorizonTelemetryEnabled: true },
      },
    });
    expect(requireContext(await resolveLongHorizonContext(optedIn.db, 1)).sourceClass).toBe(
      "singleplayer"
    );
  });

  it("uses the configured executive and formed government, not the newest legislator", async () => {
    const presidentNppId = new ObjectId();
    const pmNppId = new ObjectId();
    const { db } = makeDb({
      gameState: GAME_STATE,
      officials: [
        { countryId: "US", officeType: "senate", party: "8", electedAt: new Date("1992-01-01") },
        {
          countryId: "US",
          officeType: "president",
          party: "9",
          isNPP: true,
          nppId: presidentNppId,
          electedAt: new Date("1991-01-01"),
        },
      ],
      formations: [
        {
          countryId: "UK",
          status: "formed",
          governingPartyId: "4",
          pmCharacterId: null,
          pmNppId,
        },
      ],
    });
    const ctx = requireContext(await resolveLongHorizonContext(db, 10));
    expect(ctx.governingByCountry.get("US")).toMatchObject({
      party: "9",
      nppId: presidentNppId.toString(),
    });
    expect(ctx.governingByCountry.get("US")?.characterId).toBeUndefined();
    expect(ctx.governingByCountry.get("UK")).toMatchObject({
      party: "4",
      nppId: pmNppId.toString(),
    });
    expect(ctx.governingByCountry.get("UK")?.characterId).toBeUndefined();
  });
});

describe("appendApprovalTelemetry", () => {
  it("upserts one durable point per scope without touching the bounded arrays", async () => {
    const nppId = new ObjectId();
    const { db, bulkWrites } = makeDb({
      gameState: GAME_STATE,
      simRun: SIM_RUN,
      officials: [
        {
          countryId: "US",
          officeType: "president",
          party: "9",
          isNPP: true,
          nppId,
          electedAt: new Date("1991-01-01"),
        },
      ],
    });
    const ctx = requireContext(await resolveLongHorizonContext(db, 100));

    const res = await appendApprovalTelemetry(db, ctx, "US", 100, {
      approval: 52.4,
      net: 4.8,
      states: [{ stateId: "PA", approval: 48.1, net: -3.8 }],
    });

    expect(res.pointsWritten).toBe(2);
    const ops = bulkWrites["approvalTelemetry"][0] as Array<{
      updateOne: {
        filter: Record<string, unknown>;
        update: Record<string, unknown>;
        upsert: boolean;
      };
    }>;
    expect(ops).toHaveLength(2);
    // Idempotent upserts keyed on the full series coordinate.
    expect(ops[0].updateOne.filter).toEqual({
      worldId: ctx.worldId,
      country: "US",
      region: null,
      turn: 100,
    });
    expect(ops[0].updateOne.upsert).toBe(true);
    expect(pipelineValue(ops[0].updateOne.update, "approval")).toBe(52.4);
    expect(pipelineValue(ops[0].updateOne.update, "netApproval")).toBe(4.8);
    expect(pipelineValue(ops[0].updateOne.update, "runId")).toBe("1991-r3");
    expect(pipelineValue(ops[0].updateOne.update, "governingNpp")).toBe(nppId.toString());
    expect(pipelineValue(ops[0].updateOne.update, "governingCharacter")).toBeUndefined();
    expect(JSON.stringify(ops[0].updateOne.update)).toContain("$ifNull");
    expect(
      (
        ops[0].updateOne.update as unknown as Array<{
          $set: Record<string, { $ifNull: [string, unknown] }>;
        }>
      )[0].$set["approval"].$ifNull[0]
    ).toBe("$approval");
    expect(ops[1].updateOne.filter).toMatchObject({ country: "US", region: "PA", turn: 100 });
    // The bounded operational write is untouched: no $push/$slice here.
    expect(JSON.stringify(ops)).not.toContain("$push");
  });
});

describe("appendMacroTelemetry", () => {
  it("writes regional and summed national GDP/population levels and skips missing values", async () => {
    const { db, bulkWrites, findCalls } = makeDb({
      gameState: GAME_STATE,
      simRun: SIM_RUN,
      states: [
        { _id: "TX", countryId: "US", gdp: 2_300, population: 30_000_000 },
        { _id: "CA", countryId: "US", gdp: 4_100, population: 39_000_000 },
        { _id: "RU-MOW", countryId: "RU", gdp: Number.NaN, population: 12_000_000 },
      ],
    });
    const ctx = requireContext(await resolveLongHorizonContext(db, 200));

    const res = await appendMacroTelemetry(db, ctx, 200);

    // US yields two metrics for each region plus the national sum. RU's invalid
    // GDP is missing at both scopes, while population remains present.
    expect(res.pointsWritten).toBe(8);
    expect(res.skipped).toBe(2);
    const ops = bulkWrites["macroTelemetry"][0] as Array<{
      updateOne: {
        filter: Record<string, unknown>;
        update: unknown;
      };
    }>;
    const metrics = ops.map((o) => pipelineValue(o.updateOne.update, "metric"));
    expect(new Set(metrics)).toEqual(new Set(["economic.gdp", "population.population"]));
    const usNationalGdp = ops.find(
      (o) =>
        o.updateOne.filter["country"] === "US" &&
        o.updateOne.filter["region"] === null &&
        pipelineValue(o.updateOne.update, "metric") === "economic.gdp"
    );
    expect(pipelineValue(usNationalGdp?.updateOne.update, "value")).toBe(6_400);
    const statesFind = findCalls.find((c) => c.collection === "states");
    expect((statesFind?.options as { projection: Record<string, unknown> }).projection).toEqual({
      _id: 1,
      countryId: 1,
      gdp: 1,
      population: 1,
    });
  });
});

describe("telemetry readers", () => {
  it("reads durable series in turn order", async () => {
    const { db } = makeDb({
      approvalRows: [
        { turn: 12, approval: 51 },
        { turn: 10, approval: 50 },
      ],
      macroRows: [{ turn: 10, metric: "economic.gdp", value: 2_100 }],
    });

    const approvals = await readApprovalSeries(db, { worldId: "w", country: "US", region: null });
    expect(approvals.map((p) => (p as { turn: number }).turn)).toEqual([10, 12]);

    const macros = await readMacroSeries(db, {
      worldId: "w",
      country: "US",
      region: "TX",
      metric: "economic.gdp",
    });
    expect(macros).toHaveLength(1);
  });

  it("builds a run-scoped report with explicit per-series missing turns", async () => {
    const approvalRows = [
      { worldId: "w", runId: "run-1", country: "US", region: null, turn: 1, approval: 51 },
      { worldId: "w", runId: "run-1", country: "US", region: null, turn: 3, approval: 53 },
    ];
    const macroRows = [
      {
        worldId: "w",
        runId: "run-1",
        country: "US",
        region: "TX",
        metric: "economic.gdp",
        turn: 1,
        value: 2_100,
      },
      {
        worldId: "w",
        runId: "run-1",
        country: "US",
        region: "TX",
        metric: "economic.gdp",
        turn: 2,
        value: 2_110,
      },
      {
        worldId: "w",
        runId: "run-1",
        country: "US",
        region: "TX",
        metric: "economic.gdp",
        turn: 3,
        value: 2_120,
      },
    ];
    const { db, findCalls } = makeDb({ approvalRows, macroRows });

    const report = await readLongHorizonTelemetryReport(db, {
      worldId: "w",
      runId: "run-1",
      turnRange: { from: 1, to: 3 },
    });

    expect(report.availability).toBe("observed-partial");
    expect(report.cardinalityPolicy.missingValue).toBeNull();
    expect(report.approval.series).toEqual([
      {
        country: "US",
        region: null,
        expectedPoints: 3,
        observedPoints: 2,
        missingTurns: [2],
      },
    ]);
    expect(report.macro.series[0]).toMatchObject({
      country: "US",
      region: "TX",
      metric: "economic.gdp",
      expectedPoints: 3,
      observedPoints: 3,
      missingTurns: [],
    });
    expect(
      findCalls.filter((call) => ["approvalTelemetry", "macroTelemetry"].includes(call.collection))
    ).toEqual([
      expect.objectContaining({
        filter: { worldId: "w", runId: "run-1", turn: { $gte: 1, $lte: 3 } },
      }),
      expect.objectContaining({
        filter: { worldId: "w", runId: "run-1", turn: { $gte: 1, $lte: 3 } },
      }),
    ]);
  });

  it("falls back to the bounded operational history when the durable series is empty", async () => {
    const { db } = makeDb({
      approvalRows: [],
      nationalApprovalDoc: {
        _id: "US",
        history: [
          { turn: 98, approval: 52, net: 4 },
          { turn: 99, approval: 53, net: 6 },
        ],
      },
    });

    const series = await readApprovalSeriesWithFallback(
      db,
      { worldId: "w", sourceClass: "sandbox", startingYear: 1991, clock: {} },
      "US",
      null
    );

    expect(series.map((p) => p.turn)).toEqual([98, 99]);
    expect(series[0].retentionPolicy).toBe("operational-bounded");
    expect(series[0].year).toBe(1991 + Math.floor(97 / 48));
  });
});
