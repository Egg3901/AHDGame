/**
 * Shell for durable long-horizon telemetry (issues #2099, #2100).
 *
 * Called from the turn exactly where the bounded operational histories are
 * written (`stateEffectsPhase`: approval snapshot + metric history), so the
 * durable series can never drift a turn behind the pages. Operational reads
 * are untouched: pages keep their 20/96-point projections, and the dashboard
 * keeps consuming sanitized aggregates — reports gain the readers below.
 *
 * Sandbox isolation: every access goes through the passed `Db` handle, which
 * on sim runs is pinned to the isolated sandbox database. Nothing here opens
 * a second connection or touches the live game database.
 */
import type { AnyBulkWriteOperation, Db } from "mongodb";
import { STARTING_YEAR } from "@/lib/constants/turnTime";
import { yearOfTurn } from "@/lib/utils/gameDate";
import {
  getApprovalTelemetryCollection,
  getMacroTelemetryCollection,
} from "@/lib/db/collections/longHorizonTelemetry";
import type { GameState } from "@/lib/db/types/gameState";
import type { GovernmentApproval } from "@/lib/db/types/governmentApproval";
import type { StateApprovalHistory } from "@/lib/db/types/stateApproval";
import type { ElectedOfficial } from "@/lib/db/types/officials";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import type { State } from "@/lib/db/types/state";
import { COUNTRY_CONFIGS, getExecutiveOfficeKey, type CountryId } from "@/lib/constants/countries";
import {
  LONG_HORIZON_BOUNDED_FALLBACK_POLICY_ID,
  LONG_HORIZON_MACRO_PATHS,
  LONG_HORIZON_TELEMETRY_SCHEMA_VERSION,
  buildApprovalPoint,
  buildMacroPoint,
  buildWorldId,
  isFoundingTurn,
  resolveSourceClass,
} from "./rules";
import type {
  ApprovalTelemetryPoint,
  FoundingClock,
  LongHorizonSourceClass,
  MacroTelemetryPoint,
  TelemetryGoverningActor,
  TelemetryEffectiveManifest,
  TelemetryActorConfiguration,
} from "./rules";

/** Run manifest row (`simRuns`), read best-effort from the same database. */
interface SimRunManifest {
  runId?: string;
  _id?: string;
  seed?: string;
  source?: { executedCommit?: string | null };
  dbName?: string;
  status?: "running" | "completed" | "failed";
  startedAt?: Date;
  effectiveConfigInitial?: TelemetryEffectiveManifest;
  actorMode?: string;
  autonomyLevel?: string;
  difficulty?: string;
  actorCoverage?: { registryVersion?: number };
}

/** Everything a per-turn telemetry writer needs, resolved once per turn. */
export interface LongHorizonContext {
  worldId: string;
  sourceClass: LongHorizonSourceClass;
  runId?: string;
  seed?: string;
  codeVersion?: string;
  effectiveManifest?: TelemetryEffectiveManifest;
  actorConfiguration?: TelemetryActorConfiguration;
  preset: string;
  startingYear: number;
  /** In-game calendar year of the turn being recorded. */
  year: number;
  /** Whether the turn being recorded is in the founding-election interval. */
  foundingTurn: boolean;
  clock: FoundingClock;
  /** Latest party-bearing official per country, when one could be resolved. */
  governingByCountry: Map<string, TelemetryGoverningActor>;
}

/**
 * Resolve the provenance context for one turn: world identity from gameState,
 * run identity from the in-DB `simRuns` manifest when present (sandbox runs),
 * and the governing actor per country from the latest party-bearing elected
 * official and formed government. Four round trips, once per turn — never per
 * country or region.
 */
export async function resolveLongHorizonContext(
  db: Db,
  turn: number
): Promise<LongHorizonContext | null> {
  const [gameState, simRun, officials, formations] = await Promise.all([
    db.collection<GameState>("gameState").findOne({ _id: "current" as never }),
    db
      .collection<SimRunManifest>("simRuns")
      .findOne(
        { dbName: db.databaseName, status: "running" },
        { sort: { startedAt: -1, _id: -1 } }
      ),
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find(
        {},
        {
          projection: {
            countryId: 1,
            officeType: 1,
            party: 1,
            characterId: 1,
            nppId: 1,
            electedAt: 1,
          },
        }
      )
      .toArray(),
    db
      .collection<GovernmentFormation>("governmentFormations")
      .find(
        { status: "formed" },
        {
          projection: {
            countryId: 1,
            governingPartyId: 1,
            pmCharacterId: 1,
            pmNppId: 1,
            presidentNppId: 1,
          },
        }
      )
      .toArray(),
  ]);

  // A durable audit series must not invent a plausible world when bootstrap
  // has not produced its identity row yet.
  if (!gameState || typeof gameState.preset !== "string") return null;

  const preset = gameState.preset;
  const startingYear = gameState.startingYear ?? STARTING_YEAR;
  const clock: FoundingClock = {
    ...(gameState?.preIteration?.active !== undefined
      ? { preIterationActive: gameState.preIteration.active }
      : {}),
    ...(gameState?.preIterationTurns !== undefined
      ? { preIterationTurns: gameState.preIterationTurns }
      : {}),
  };
  const sourceClass = resolveSourceClass({
    dbName: db.databaseName ?? "",
    hasSingleplayerConfig: !!gameState.singleplayerConfig,
  });
  if (
    sourceClass === "singleplayer" &&
    gameState.singleplayerConfig?.longHorizonTelemetryEnabled !== true
  ) {
    return null;
  }

  return {
    worldId: buildWorldId({
      preset,
      iterationType: gameState?.iteration?.type ?? null,
      iterationNumber: gameState?.iteration?.number ?? null,
    }),
    sourceClass,
    ...((simRun?.runId ?? simRun?._id) ? { runId: (simRun.runId ?? simRun._id) as string } : {}),
    ...(simRun?.seed ? { seed: simRun.seed } : {}),
    ...(simRun?.source?.executedCommit ? { codeVersion: simRun.source.executedCommit } : {}),
    ...(simRun?.effectiveConfigInitial ? { effectiveManifest: simRun.effectiveConfigInitial } : {}),
    ...((simRun?.actorMode ?? simRun?.autonomyLevel ?? simRun?.difficulty ?? simRun?.actorCoverage)
      ? {
          actorConfiguration: {
            ...(simRun?.actorMode ? { mode: simRun.actorMode } : {}),
            ...(simRun?.autonomyLevel ? { autonomyLevel: simRun.autonomyLevel } : {}),
            ...(simRun?.difficulty ? { difficulty: simRun.difficulty } : {}),
            ...(simRun?.actorCoverage?.registryVersion !== undefined
              ? { coverageRegistryVersion: simRun.actorCoverage.registryVersion }
              : {}),
          },
        }
      : {}),
    preset,
    startingYear,
    year: yearOfTurn(turn, startingYear, {
      preIterationActive: clock.preIterationActive,
      preIterationTurns: clock.preIterationTurns,
    }),
    foundingTurn: isFoundingTurn(turn, clock),
    clock,
    governingByCountry: governingActorByCountry(officials, formations, preset),
  };
}

/**
 * Latest party-bearing elected official per country. Best-effort provenance:
 * a country with no officials (or none carrying a party) simply gets no
 * governing actor on its points, rather than a fabricated one.
 */
function governingActorByCountry(
  officials: ElectedOfficial[],
  formations: GovernmentFormation[],
  preset: string
): Map<string, TelemetryGoverningActor> {
  const byCountry = new Map<string, TelemetryGoverningActor>();
  const electedTime = (o: ElectedOfficial): number => {
    const t = o.electedAt ? new Date(o.electedAt).getTime() : Number.NEGATIVE_INFINITY;
    return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
  };
  const ranked = [...officials]
    .filter((o) => {
      if (typeof o.countryId !== "string" || !(o.countryId in COUNTRY_CONFIGS)) return false;
      return o.officeType === getExecutiveOfficeKey(o.countryId as CountryId, preset);
    })
    .sort((a, b) => electedTime(b) - electedTime(a));
  for (const o of ranked) {
    if (byCountry.has(o.countryId as string)) continue;
    byCountry.set(o.countryId as string, {
      ...(typeof o.officeType === "string" ? { officeType: o.officeType } : {}),
      ...(typeof o.party === "string" ? { party: o.party } : {}),
      ...(o.characterId ? { characterId: o.characterId.toString() } : {}),
      ...(o.nppId ? { nppId: o.nppId.toString() } : {}),
    });
  }
  for (const formation of formations) {
    const country = formation.countryId as string;
    const existing = byCountry.get(country) ?? {};
    const governingNppId = formation.pmNppId ?? formation.presidentNppId;
    byCountry.set(country, {
      ...existing,
      ...(formation.governingPartyId ? { party: formation.governingPartyId } : {}),
      ...(formation.pmCharacterId ? { characterId: formation.pmCharacterId.toString() } : {}),
      ...(governingNppId ? { nppId: governingNppId.toString() } : {}),
    });
  }
  return byCountry;
}

export interface ApprovalRatings {
  approval: number;
  net: number;
  states: Array<{ stateId: string; approval: number; net: number }>;
}

function retryEnrichingUpdate<T extends ApprovalTelemetryPoint | MacroTelemetryPoint>(point: T) {
  // A pipeline makes retries monotonic: absent fields are filled from a richer
  // retry, while every value already recorded for that turn wins. In
  // particular, a delayed retry cannot rewrite a measured approval/metric.
  return [
    {
      $set: Object.fromEntries(
        Object.entries(point).map(([field, value]) => [field, { $ifNull: [`$${field}`, value] }])
      ),
    },
  ];
}

/**
 * Append one durable approval point for the country plus one per region
 * (#2099). Idempotent upserts on (world, country, region, turn): a retried
 * turn keeps its first measured value while enriching any provenance that was
 * unavailable to the first attempt. The bounded `history` arrays are written
 * by their existing code path and are not touched here.
 */
export async function appendApprovalTelemetry(
  db: Db,
  ctx: LongHorizonContext,
  countryId: string,
  turn: number,
  ratings: ApprovalRatings
): Promise<{ pointsWritten: number }> {
  const base = {
    worldId: ctx.worldId,
    sourceClass: ctx.sourceClass,
    ...(ctx.runId !== undefined ? { runId: ctx.runId } : {}),
    ...(ctx.seed !== undefined ? { seed: ctx.seed } : {}),
    ...(ctx.codeVersion !== undefined ? { codeVersion: ctx.codeVersion } : {}),
    ...(ctx.effectiveManifest !== undefined ? { effectiveManifest: ctx.effectiveManifest } : {}),
    ...(ctx.actorConfiguration !== undefined ? { actorConfiguration: ctx.actorConfiguration } : {}),
    country: countryId,
    turn,
    year: ctx.year,
    foundingTurn: ctx.foundingTurn,
  };
  const actor = ctx.governingByCountry.get(countryId);
  const points: ApprovalTelemetryPoint[] = [
    buildApprovalPoint({
      ...base,
      region: null,
      approval: ratings.approval,
      net: ratings.net,
      ...(actor ? { governingActor: actor } : {}),
    }),
    ...ratings.states.map((s) =>
      buildApprovalPoint({ ...base, region: s.stateId, approval: s.approval, net: s.net })
    ),
  ];

  const ops: AnyBulkWriteOperation<ApprovalTelemetryPoint>[] = points.map((point) => {
    return {
      updateOne: {
        filter: {
          worldId: point.worldId,
          country: point.country,
          region: point.region,
          turn: point.turn,
        },
        update: retryEnrichingUpdate(point),
        upsert: true,
      },
    };
  });
  if (ops.length > 0) {
    await getApprovalTelemetryCollection(db).bulkWrite(ops);
  }
  return { pointsWritten: points.length };
}

/**
 * Append durable GDP/population levels for every region and a summed national
 * aggregate (#2100). These values come from the canonical state rows, not the
 * growth-rate metrics that reports previously used to reconstruct levels
 * backwards. Non-finite values are skipped and counted: absence is never zero.
 */
export async function appendMacroTelemetry(
  db: Db,
  ctx: LongHorizonContext,
  turn: number
): Promise<{ pointsWritten: number; skipped: number }> {
  const states = await db
    .collection<State>("states")
    .find({}, { projection: { _id: 1, countryId: 1, gdp: 1, population: 1 } })
    .toArray();

  const ops: AnyBulkWriteOperation<MacroTelemetryPoint>[] = [];
  let skipped = 0;
  const national = new Map<
    string,
    { gdp: number; population: number; validGdp: boolean; validPopulation: boolean }
  >();
  const scopes: Array<{ country: string; region: string | null; gdp: number; population: number }> =
    [];
  for (const state of states) {
    if (typeof state.countryId !== "string") {
      skipped += LONG_HORIZON_MACRO_PATHS.length;
      continue;
    }
    scopes.push({
      country: state.countryId,
      region: String(state._id),
      gdp: state.gdp,
      population: state.population,
    });
    const sum = national.get(state.countryId) ?? {
      gdp: 0,
      population: 0,
      validGdp: true,
      validPopulation: true,
    };
    if (Number.isFinite(state.gdp)) sum.gdp += state.gdp;
    else sum.validGdp = false;
    if (Number.isFinite(state.population)) sum.population += state.population;
    else sum.validPopulation = false;
    national.set(state.countryId, sum);
  }
  for (const [country, sum] of national) {
    scopes.push({
      country,
      region: null,
      gdp: sum.validGdp ? sum.gdp : Number.NaN,
      population: sum.validPopulation ? sum.population : Number.NaN,
    });
  }

  for (const scope of scopes) {
    for (const { path, units } of LONG_HORIZON_MACRO_PATHS) {
      const value = path === "economic.gdp" ? scope.gdp : scope.population;
      const point = buildMacroPoint({
        worldId: ctx.worldId,
        sourceClass: ctx.sourceClass,
        ...(ctx.runId !== undefined ? { runId: ctx.runId } : {}),
        ...(ctx.seed !== undefined ? { seed: ctx.seed } : {}),
        ...(ctx.codeVersion !== undefined ? { codeVersion: ctx.codeVersion } : {}),
        ...(ctx.effectiveManifest !== undefined
          ? { effectiveManifest: ctx.effectiveManifest }
          : {}),
        ...(ctx.actorConfiguration !== undefined
          ? { actorConfiguration: ctx.actorConfiguration }
          : {}),
        country: scope.country,
        region: scope.region,
        turn,
        year: ctx.year,
        foundingTurn: ctx.foundingTurn,
        metric: path,
        value,
        units,
      });
      if (!point) {
        skipped += 1;
        continue;
      }
      ops.push({
        updateOne: {
          filter: {
            worldId: point.worldId,
            country: point.country,
            region: point.region,
            metric: point.metric,
            turn: point.turn,
          },
          update: retryEnrichingUpdate(point),
          upsert: true,
        },
      });
    }
  }
  if (ops.length > 0) {
    await getMacroTelemetryCollection(db).bulkWrite(ops);
  }
  return { pointsWritten: ops.length, skipped };
}

/** Read one durable approval series, oldest turn first, for report use. */
export async function readApprovalSeries(
  db: Db,
  filter: { worldId: string; country: string; region: string | null }
): Promise<ApprovalTelemetryPoint[]> {
  return getApprovalTelemetryCollection(db)
    .find({ worldId: filter.worldId, country: filter.country, region: filter.region })
    .sort({ turn: 1 })
    .toArray();
}

/** Read one durable GDP/population series, oldest turn first, for report use. */
export async function readMacroSeries(
  db: Db,
  filter: { worldId: string; country: string; region: string | null; metric: string }
): Promise<MacroTelemetryPoint[]> {
  return getMacroTelemetryCollection(db)
    .find({
      worldId: filter.worldId,
      country: filter.country,
      region: filter.region,
      metric: filter.metric,
    })
    .sort({ turn: 1 })
    .toArray();
}

export interface LongHorizonSeriesCoverage {
  country: string;
  region: string | null;
  metric?: string;
  expectedPoints: number;
  observedPoints: number;
  missingTurns: number[];
}

export interface LongHorizonTelemetryReport {
  schemaVersion: 1;
  availability: "observed-complete" | "observed-partial" | "missing";
  worldId: string;
  runId: string;
  turnRange: { from: number; to: number };
  cardinalityPolicy: {
    cadence: "every-completed-turn";
    range: "inclusive";
    scopeDiscovery: "observed-series";
    missingValue: null;
  };
  approval: {
    points: ApprovalTelemetryPoint[];
    series: LongHorizonSeriesCoverage[];
  };
  macro: {
    points: MacroTelemetryPoint[];
    series: LongHorizonSeriesCoverage[];
  };
}

function seriesCoverage<T extends { country: string; region: string | null; turn: number }>(
  points: readonly T[],
  turnRange: { from: number; to: number },
  metricOf?: (point: T) => string
): LongHorizonSeriesCoverage[] {
  const expectedTurns = Math.max(0, turnRange.to - turnRange.from + 1);
  const grouped = new Map<string, { sample: T; turns: Set<number> }>();
  for (const point of points) {
    const metric = metricOf?.(point);
    const key = `${point.country}\u0000${point.region ?? ""}\u0000${metric ?? ""}`;
    const group = grouped.get(key) ?? { sample: point, turns: new Set<number>() };
    if (point.turn >= turnRange.from && point.turn <= turnRange.to) group.turns.add(point.turn);
    grouped.set(key, group);
  }
  return [...grouped.values()]
    .map(({ sample, turns }) => {
      const missingTurns: number[] = [];
      for (let turn = turnRange.from; turn <= turnRange.to; turn++) {
        if (!turns.has(turn)) missingTurns.push(turn);
      }
      const metric = metricOf?.(sample);
      return {
        country: sample.country,
        region: sample.region,
        ...(metric !== undefined ? { metric } : {}),
        expectedPoints: expectedTurns,
        observedPoints: turns.size,
        missingTurns,
      };
    })
    .sort(
      (a, b) =>
        a.country.localeCompare(b.country) ||
        (a.region ?? "").localeCompare(b.region ?? "") ||
        (a.metric ?? "").localeCompare(b.metric ?? "")
    );
}

/**
 * Read the complete durable telemetry payload for one simulation report.
 * The run id is mandatory and included in both queries so a repeated preset
 * cannot borrow points from another sandbox. Missing turns are enumerated per
 * observed series. A renderer therefore never has to interpret an absent point
 * as zero or infer the expected cardinality from chart data.
 */
export async function readLongHorizonTelemetryReport(
  db: Db,
  input: { worldId: string; runId: string; turnRange: { from: number; to: number } }
): Promise<LongHorizonTelemetryReport> {
  const [approvalPoints, macroPoints] = await Promise.all([
    getApprovalTelemetryCollection(db)
      .find({
        worldId: input.worldId,
        runId: input.runId,
        turn: { $gte: input.turnRange.from, $lte: input.turnRange.to },
      })
      .sort({ country: 1, region: 1, turn: 1 })
      .toArray(),
    getMacroTelemetryCollection(db)
      .find({
        worldId: input.worldId,
        runId: input.runId,
        turn: { $gte: input.turnRange.from, $lte: input.turnRange.to },
      })
      .sort({ country: 1, region: 1, metric: 1, turn: 1 })
      .toArray(),
  ]);
  const approvalSeries = seriesCoverage(approvalPoints, input.turnRange);
  const macroSeries = seriesCoverage(macroPoints, input.turnRange, (point) => point.metric);
  const allSeries = [...approvalSeries, ...macroSeries];
  const hasBothFamilies = approvalSeries.length > 0 && macroSeries.length > 0;
  const availability =
    allSeries.length === 0
      ? "missing"
      : hasBothFamilies && allSeries.every((series) => series.missingTurns.length === 0)
        ? "observed-complete"
        : "observed-partial";

  return {
    schemaVersion: 1,
    availability,
    worldId: input.worldId,
    runId: input.runId,
    turnRange: input.turnRange,
    cardinalityPolicy: {
      cadence: "every-completed-turn",
      range: "inclusive",
      scopeDiscovery: "observed-series",
      missingValue: null,
    },
    approval: { points: approvalPoints, series: approvalSeries },
    macro: { points: macroPoints, series: macroSeries },
  };
}

export interface FallbackProvenance {
  worldId: string;
  sourceClass: LongHorizonSourceClass;
  startingYear: number;
  clock: FoundingClock;
}

/**
 * Report read path: prefer the durable series, and only when it holds no
 * points map the bounded operational `history` arrays into the same shape.
 * Fallback points carry the `operational-bounded` retention label and an
 * unknown calculation version (0) so a report can never mistake them for
 * full-provenance telemetry.
 */
export async function readApprovalSeriesWithFallback(
  db: Db,
  provenance: FallbackProvenance,
  country: string,
  region: string | null
): Promise<ApprovalTelemetryPoint[]> {
  const durable = await readApprovalSeries(db, {
    worldId: provenance.worldId,
    country,
    region,
  });
  if (durable.length > 0) return durable;

  const bounded =
    region === null
      ? ((
          await db
            .collection<GovernmentApproval>("governmentApprovals")
            .findOne({ _id: country as never }, { projection: { history: 1 } })
        )?.history ?? [])
      : ((
          await db
            .collection<StateApprovalHistory>("stateApprovalHistory")
            .findOne({ _id: region }, { projection: { history: 1 } })
        )?.history ?? []);

  return bounded.map((entry) => ({
    worldId: provenance.worldId,
    sourceClass: provenance.sourceClass,
    country,
    region,
    turn: entry.turn,
    year: yearOfTurn(entry.turn, provenance.startingYear, {
      preIterationActive: provenance.clock.preIterationActive,
      preIterationTurns: provenance.clock.preIterationTurns,
    }),
    foundingTurn: isFoundingTurn(entry.turn, provenance.clock),
    approval: entry.approval,
    netApproval: entry.net,
    schemaVersion: LONG_HORIZON_TELEMETRY_SCHEMA_VERSION,
    calcVersion: 0,
    retentionPolicy: LONG_HORIZON_BOUNDED_FALLBACK_POLICY_ID,
    retentionVersion: 1,
  }));
}
