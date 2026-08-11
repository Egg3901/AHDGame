// The env matrix.
//
// `Defect.envs` says where a heal MAY run. It has never said where one HAS
// run, and that gap is the whole "we always forget to heal the sandbox"
// problem: prod gets fixed because prod is the one being complained about,
// sandbox stays broken until somebody trips over it weeks later.
//
// This runs every defect's detector against every configured environment and
// returns one grid. It is cheap (detectors are read-only counts), so it is
// safe to call constantly — from `heal_list`, from a nightly job, from a
// dashboard.

import type { Db } from "mongodb";
import { defectWarnings, HEAL_RUNS_COLLECTION } from "./runner";
import type { Defect, DefectStatus, EnvStatus, HealEnv, HealRun } from "./types";

/**
 * How the caller reaches each environment. The MCP and the CLI each know a
 * different way to get a Db per env, so that is injected rather than assumed.
 * `null` means the env exists as a concept but is not configured on this box.
 */
export type EnvResolver = (env: HealEnv) => Promise<Db | null>;

async function lastRunFor(db: Db, defectId: string, env: HealEnv): Promise<EnvStatus["lastRun"]> {
  const run = await db
    .collection<HealRun>(HEAL_RUNS_COLLECTION)
    .find({ defectId, env })
    .sort({ startedAt: -1 })
    .limit(1)
    .next();
  if (!run) return undefined;
  return { runId: run._id, at: run.startedAt, status: run.status, operator: run.operator };
}

async function statusForEnv(
  defect: Defect,
  env: HealEnv,
  resolve: EnvResolver,
  now: Date
): Promise<EnvStatus> {
  if (!defect.envs.includes(env)) {
    return {
      env,
      configured: true,
      affected: null,
      state: "unconfigured",
      error: `defect is not registered for ${env}`,
    };
  }

  let db: Db | null;
  try {
    db = await resolve(env);
  } catch (error) {
    return {
      env,
      configured: false,
      affected: null,
      state: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (!db) return { env, configured: false, affected: null, state: "unconfigured" };

  try {
    const detect = await defect.detect(db, { env, dryRun: true, now });
    return {
      env,
      configured: true,
      affected: detect.affected,
      state: detect.affected === 0 ? "clean" : "dirty",
      lastRun: await lastRunFor(db, defect.id, env),
    };
  } catch (error) {
    return {
      env,
      configured: true,
      affected: null,
      state: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function defectStatus(
  defect: Defect,
  envs: HealEnv[],
  resolve: EnvResolver,
  now = new Date()
): Promise<DefectStatus> {
  const rows: EnvStatus[] = [];
  for (const env of envs) {
    rows.push(await statusForEnv(defect, env, resolve, now));
  }

  const warnings = defectWarnings(defect);
  // An env whose detector could not run is NOT evidence of cleanliness. Say so
  // here, or a matrix full of connection errors reads as "all clear".
  for (const row of rows.filter((r) => r.state === "error")) {
    warnings.push(`${row.env}: detector could not run — ${row.error ?? "unknown error"}`);
  }

  return {
    defectId: defect.id,
    title: defect.title,
    severity: defect.severity,
    seedFix: defect.seedFix,
    envs: rows,
    anyDirty: rows.some((r) => r.state === "dirty"),
    warnings,
  };
}

export interface LedgerStatus {
  defects: DefectStatus[];
  dirty: DefectStatus[];
  /** Defects whose detector failed somewhere. Unknown, NOT clean. */
  errored: DefectStatus[];
  checkedEnvs: HealEnv[];
  /** True when every configured env answered and every answer was clean. */
  allClean: boolean;
}

export async function ledgerStatus(
  defects: Defect[],
  envs: HealEnv[],
  resolve: EnvResolver,
  now = new Date()
): Promise<LedgerStatus> {
  const rows: DefectStatus[] = [];
  for (const defect of defects) {
    rows.push(await defectStatus(defect, envs, resolve, now));
  }
  const dirty = rows.filter((r) => r.anyDirty);
  const errored = rows.filter((r) => r.envs.some((e) => e.state === "error"));
  return {
    defects: rows,
    dirty,
    errored,
    checkedEnvs: envs,
    allClean: dirty.length === 0 && errored.length === 0,
  };
}

/** One line per defect, for a terminal or a Discord alert. */
export function formatMatrix(status: DefectStatus[], envs: HealEnv[]): string {
  const cell = (row: DefectStatus, env: HealEnv): string => {
    const found = row.envs.find((e) => e.env === env);
    if (!found) return "?";
    if (found.state === "clean") return "clean";
    if (found.state === "dirty") return `DIRTY ${found.affected}`;
    if (found.state === "unconfigured") return "-";
    return "err";
  };

  const width = Math.max(24, ...status.map((s) => s.defectId.length + 2));
  const header = "defect".padEnd(width) + envs.map((e) => e.padEnd(14)).join("");
  const lines = status.map((row) => {
    const seed = row.seedFix.status === "unknown" ? "  [seed?]" : "";
    return row.defectId.padEnd(width) + envs.map((e) => cell(row, e).padEnd(14)).join("") + seed;
  });
  return [header, ...lines].join("\n");
}
