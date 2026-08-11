/**
 * Remediation CLI — the ground truth for the defect ledger.
 *
 * Every heal goes through here, and the heal-ops MCP is a thin wrapper over
 * this file rather than a second implementation. One code path means the MCP
 * cannot drift from what an operator gets at a terminal.
 *
 *   npx tsx scripts/remediation/cli.ts list
 *   npx tsx scripts/remediation/cli.ts detect  AHD-951 --env sandbox
 *   npx tsx scripts/remediation/cli.ts plan    AHD-951 --env sandbox
 *   npx tsx scripts/remediation/cli.ts apply   AHD-951 --env sandbox --token heal_...
 *   npx tsx scripts/remediation/cli.ts verify  AHD-951 --env sandbox
 *   npx tsx scripts/remediation/cli.ts history --defect AHD-951
 *   npx tsx scripts/remediation/cli.ts rollback run_20260808T120000_ab12cd34
 *   npx tsx scripts/remediation/cli.ts indexes
 *
 * Flags:
 *   --env dev|sandbox|prod   target environment (default sandbox)
 *   --operator <name>        recorded on the run, default $USER
 *   --deployed-sha <sha>     commit currently deployed to --env; drives the code gate
 *   --confirm-prod           required for --env prod
 *   --override-code-gate "reason"   bypass a failing gate; recorded on the run forever
 *   --json                   machine-readable output (what the MCP uses)
 *
 * Read commands (list/detect/plan/verify/history) never write game data. `plan`
 * writes only a confirm-token row. `apply` is the sole writer.
 */
import { config } from "dotenv";
// `quiet` matters: dotenv's banner goes to STDOUT, and --json output is parsed
// by the heal-ops MCP. Unquiet, the banner lands inside the payload.
config({ path: ".env.local", quiet: true });

import { execFileSync } from "child_process";
import { MongoClient, type Db } from "mongodb";
import { extractMongoDbNameFromUri } from "@/lib/mongodb";
import {
  ensureRemediationIndexes,
  listHistory,
  runApply,
  runDetect,
  runPlan,
  runRollback,
  runVerify,
} from "@/lib/remediation/runner";
import { DEFECTS, requireDefect } from "@/lib/remediation/registry";
import { compileAdhocDefect, validateAdhocSpec } from "@/lib/remediation/adhoc";
import { scaffoldFor } from "@/lib/remediation/scaffold";
import { listCollections, runCount, runDistinct, runQuery } from "@/lib/remediation/inspect";
import { formatMatrix, ledgerStatus, type EnvResolver } from "@/lib/remediation/status";
import { readTurnLock } from "@/lib/remediation/guards";
import type { AdhocSpec, CodeGateResult, Defect, HealEnv } from "@/lib/remediation/types";
import { HEAL_ENVS } from "@/lib/remediation/types";

const argv = process.argv.slice(2);
const command = argv[0];
const positional = argv.slice(1).filter((a) => !a.startsWith("--"));

function flag(name: string): string | undefined {
  const withEquals = argv.find((a) => a.startsWith(`--${name}=`));
  if (withEquals) return withEquals.slice(name.length + 3);
  const index = argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const next = argv[index + 1];
  return next && !next.startsWith("--") ? next : "";
}
function has(name: string): boolean {
  return argv.includes(`--${name}`) || argv.some((a) => a.startsWith(`--${name}=`));
}

const JSON_OUT = has("json");
const ENV = (flag("env") || "sandbox") as HealEnv;
const OPERATOR = flag("operator") || process.env.USER || "unknown";

function out(payload: unknown, human: () => void): void {
  if (JSON_OUT) console.log(JSON.stringify(payload, null, 2));
  else human();
}

function fail(message: string): never {
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  else console.error(`ERROR: ${message}`);
  process.exit(1);
}

/**
 * The code gate. `requiredCommit` must be an ancestor of what is actually
 * deployed to the target env — otherwise the heal repairs rows the running
 * build will corrupt again on the next turn.
 *
 * The deployed SHA has to be supplied (the railway MCP knows it; this process
 * does not). No SHA and a pinned defect means the gate fails closed.
 */
function computeCodeGate(defect: Defect): CodeGateResult | undefined {
  const required = defect.codeFix?.requiredCommit;
  if (!required) return undefined;

  const deployedSha = flag("deployed-sha");
  const overrideReason = flag("override-code-gate");
  const override = overrideReason ? { reason: overrideReason, operator: OPERATOR } : undefined;

  if (!deployedSha) {
    return {
      ok: false,
      requiredCommit: required,
      detail:
        `no --deployed-sha supplied, so it is unknown whether ${required} is live in ${ENV}. ` +
        "Get it from the railway MCP (railway_deployments) and pass it.",
      override,
    };
  }

  try {
    execFileSync("git", ["merge-base", "--is-ancestor", required, deployedSha], {
      stdio: "ignore",
    });
    return {
      ok: true,
      deployedSha,
      requiredCommit: required,
      detail: `${required} is an ancestor of deployed ${deployedSha}`,
      override,
    };
  } catch {
    return {
      ok: false,
      deployedSha,
      requiredCommit: required,
      detail:
        `${required} is NOT an ancestor of deployed ${deployedSha} — the code half of this ` +
        `defect has not reached ${ENV}. Healing now means the engine re-corrupts on the next turn.`,
      override,
    };
  }
}

/**
 * Database name, in the app's own precedence order. Per-env URIs may point at
 * differently named databases, so the name has to come from the URI when it
 * carries one rather than from a single ambient MONGODB_DB.
 */
function dbNameFor(uri: string): string {
  return process.env.MONGODB_DB || extractMongoDbNameFromUri(uri) || "a-house-divided";
}

/** directConnection is required by the single-node rs0 behind Railway's proxy. */
function withDirectConnection(uri: string): string {
  return uri.includes("directConnection=")
    ? uri
    : uri + (uri.includes("?") ? "&" : "?") + "directConnection=true";
}

async function withDb<T>(run: (db: Db) => Promise<T>): Promise<T> {
  const base = process.env.MONGODB_URI;
  if (!base) fail("MONGODB_URI is not set");
  const uri = withDirectConnection(base);
  const client = new MongoClient(uri);
  await client.connect();
  try {
    return await run(client.db(dbNameFor(uri)));
  } finally {
    await client.close();
  }
}

/**
 * Per-env Mongo URIs, for the status matrix. Same rule as the MCP: an env with
 * no URI is reported as unconfigured, never quietly resolved to another one.
 */
function envUriFor(env: HealEnv): string | undefined {
  const explicit = process.env[`HEAL_MONGODB_URI_${env.toUpperCase()}`];
  if (explicit) return explicit;
  // The env being operated on right now uses the ambient connection, so a
  // single-env invocation keeps working with just MONGODB_URI.
  return env === ENV ? process.env.MONGODB_URI : undefined;
}

/**
 * Parse a JSON flag, failing with the flag name rather than a parser message.
 * `undefined` is a legitimate default, so absence is signalled by arity rather
 * than by comparing the fallback against undefined.
 */
function jsonFlag<T>(name: string, ...fallback: [T?]): T {
  const raw = flag(name);
  if (raw == null || raw === "") {
    if (fallback.length > 0) return fallback[0] as T;
    return fail(`--${name} is required (JSON)`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fail(`--${name} is not valid JSON: ${raw}`);
  }
}

async function main(): Promise<void> {
  if (!command || command === "help" || has("help")) {
    console.log(
      [
        "ledger:  list | status | detect | plan | apply | verify | history | rollback | indexes",
        "ad-hoc:  adhoc-plan | adhoc-apply   (one-off repairs, same guards)",
        "inspect: query | count | distinct | collections   (read-only)",
        "author:  scaffold <DEFECT-ID>",
        "see the header of scripts/remediation/cli.ts for full usage",
      ].join("\n")
    );
    return;
  }

  if (!HEAL_ENVS.includes(ENV)) fail(`unknown env "${ENV}" (expected ${HEAL_ENVS.join("|")})`);

  // ── status matrix ─────────────────────────────────────────────────────────
  // The answer to "is sandbox still dirty". Runs every detector against every
  // configured env, so nobody has to remember to ask per environment.
  if (command === "status") {
    const envs = (flag("envs") || HEAL_ENVS.join(",")).split(",") as HealEnv[];
    const clients: MongoClient[] = [];
    const resolve: EnvResolver = async (env) => {
      const uri = envUriFor(env);
      if (!uri) return null;
      const client = new MongoClient(withDirectConnection(uri));
      await client.connect();
      clients.push(client);
      return client.db(dbNameFor(uri));
    };

    try {
      const only = flag("defect");
      const defects = only ? [requireDefect(only)] : DEFECTS;
      const result = await ledgerStatus(defects, envs, resolve);
      out({ ok: true, ...result }, () => {
        console.log(formatMatrix(result.defects, envs));
        const warned = result.defects.filter((d) => d.warnings.length > 0);
        if (warned.length > 0) {
          console.log("\nwarnings:");
          warned.forEach((d) => d.warnings.forEach((w) => console.log(`  ${d.defectId}: ${w}`)));
        }
        if (result.allClean) {
          console.log("\nall clean across " + envs.join(", "));
        } else {
          if (result.dirty.length > 0) {
            console.log(
              `\n${result.dirty.length} defect(s) DIRTY: ${result.dirty.map((d) => d.defectId).join(", ")}`
            );
          }
          // Reported separately and loudly: an env that could not be reached is
          // UNKNOWN, not clean, and folding it into "all clear" is how a broken
          // connection reads as a healthy world.
          if (result.errored.length > 0) {
            console.log(
              `${result.errored.length} defect(s) could NOT be checked in at least one env: ` +
                result.errored.map((d) => d.defectId).join(", ")
            );
          }
        }
      });
      // Non-zero exit so a cron can alert without parsing anything. Errors are
      // an alert too: silence on an unreachable env is the failure mode.
      if (!result.allClean) process.exitCode = 2;
    } finally {
      await Promise.all(clients.map((c) => c.close()));
    }
    return;
  }

  // ── read-only inspection ──────────────────────────────────────────────────
  // Here so that "I just want to look at prod" never requires a mongo shell.
  // An open shell is how an unlogged updateMany happens.
  if (command === "collections") {
    const rows = await withDb((db) => listCollections(db));
    out({ ok: true, collections: rows }, () =>
      rows.forEach((r) => console.log(`${String(r.count).padStart(10)}  ${r.name}`))
    );
    return;
  }

  if (command === "query") {
    const collection = positional[0] || flag("collection");
    if (!collection) fail("query needs a collection");
    const result = await withDb((db) =>
      runQuery(db, {
        collection,
        filter: jsonFlag("filter", {}),
        projection: jsonFlag<Record<string, 0 | 1> | undefined>("projection", undefined),
        sort: jsonFlag<Record<string, 1 | -1> | undefined>("sort", undefined),
        limit: Number(flag("limit") || 25),
      })
    );
    out({ ok: true, ...result }, () => {
      console.log(`${result.matched} matched, showing ${result.returned}`);
      result.docs.forEach((d) => console.log(JSON.stringify(d)));
    });
    return;
  }

  if (command === "count") {
    const collection = positional[0] || flag("collection");
    if (!collection) fail("count needs a collection");
    const n = await withDb((db) => runCount(db, collection, jsonFlag("filter", {})));
    out({ ok: true, collection, count: n }, () => console.log(String(n)));
    return;
  }

  if (command === "distinct") {
    const collection = positional[0] || flag("collection");
    const field = positional[1] || flag("field");
    if (!collection || !field) fail("distinct needs a collection and a field");
    const values = await withDb((db) => runDistinct(db, collection, field, jsonFlag("filter", {})));
    out({ ok: true, collection, field, values }, () =>
      values.forEach((v) => console.log(JSON.stringify(v)))
    );
    return;
  }

  // ── ad-hoc repairs ────────────────────────────────────────────────────────
  // A one-off with no ledger entry, run down the same path as a registered
  // defect: dry run, confirm token, turn lock, row cap, snapshot, audit row,
  // rollback. The point is that this is EASIER than mongosh, not just safer.
  if (command === "adhoc-plan" || command === "adhoc-apply") {
    const spec = jsonFlag<AdhocSpec>("spec");
    const problems = validateAdhocSpec(spec);
    if (problems.length > 0) {
      out({ ok: false, problems }, () => {
        console.error("ad-hoc spec rejected:");
        problems.forEach((p) => console.error(`  ${p.field}: ${p.detail}`));
      });
      process.exit(1);
    }
    const synthetic = compileAdhocDefect(spec);

    if (command === "adhoc-plan") {
      const outcome = await withDb((db) =>
        runPlan(db, synthetic, { env: ENV, operator: OPERATOR })
      );
      out({ ok: true, ...outcome, defectId: synthetic.id }, () => {
        console.log(`AD-HOC DRY RUN @ ${ENV}  (${synthetic.id})`);
        console.log(`  ${outcome.plan.summary}`);
        outcome.plan.notes?.forEach((n) => console.log(`    ${n}`));
        console.log("  guards:");
        outcome.guards.verdicts.forEach((v) =>
          console.log(`    [${v.ok ? "ok " : "REFUSE"}] ${v.guard}: ${v.detail}`)
        );
        outcome.warnings.forEach((w) => console.log(`  WARNING: ${w}`));
        if (outcome.token) {
          console.log(`\n  confirm token: ${outcome.token.id}  (10 min)`);
          console.log(
            `  apply with: --token ${outcome.token.id}` + (ENV === "prod" ? " --confirm-prod" : "")
          );
        } else {
          console.log(`\n  NO TOKEN ISSUED: ${outcome.tokenWithheld}`);
        }
      });
      return;
    }

    const tokenId = flag("token");
    if (!tokenId) fail("adhoc-apply needs --token from adhoc-plan");
    const result = await withDb((db) =>
      runApply(db, synthetic, {
        env: ENV,
        tokenId,
        operator: OPERATOR,
        confirmProd: has("confirm-prod"),
      })
    );
    out({ ...result, env: ENV, defectId: synthetic.id, spec }, () => {
      if (!result.ok) return console.error(`REFUSED / FAILED: ${result.refusal}`);
      console.log(`AD-HOC APPLIED — run ${result.runId}`);
      console.log(`  ${JSON.stringify(result.run?.result)}`);
      console.log(`  rollback: npx tsx scripts/remediation/cli.ts rollback ${result.runId}`);
      console.log("  if this repair recurs, promote it to src/lib/remediation/defects/");
    });
    if (!result.ok) process.exit(1);
    return;
  }

  // ── scaffold ──────────────────────────────────────────────────────────────
  // Lowers the cost of writing a proper defect. A framework people skip
  // because the boilerplate is tedious is a framework that does not exist.
  if (command === "scaffold") {
    const id = positional[0];
    if (!id) fail("scaffold needs a defect id, e.g. AHD-1234");
    const source = scaffoldFor(id, flag("collection") || undefined);
    out({ ok: true, defectId: id, path: `src/lib/remediation/defects/${id}.ts`, source }, () =>
      console.log(source)
    );
    return;
  }

  if (command === "list") {
    const rows = DEFECTS.map((d) => ({
      id: d.id,
      title: d.title,
      severity: d.severity,
      envs: d.envs,
      guards: d.guards,
      codeFix: d.codeFix ?? null,
      mintsMoney: d.mintsMoney === true,
    }));
    out({ ok: true, defects: rows }, () => {
      for (const row of rows) {
        console.log(`${row.id.padEnd(24)} ${row.severity}  ${row.title}`);
        console.log(`  envs=${row.envs.join(",")}  guards=${row.guards.join(",")}`);
      }
    });
    return;
  }

  if (command === "indexes") {
    await withDb(async (db) => {
      await ensureRemediationIndexes(db);
      out({ ok: true, detail: "healRuns, healBackups and healTokens indexes ensured" }, () =>
        console.log("indexes ensured")
      );
    });
    return;
  }

  if (command === "history") {
    const rows = await withDb((db) =>
      listHistory(db, {
        defectId: flag("defect"),
        env: has("env") ? ENV : undefined,
        limit: Number(flag("limit") || 25),
      })
    );
    out({ ok: true, runs: rows }, () => {
      if (rows.length === 0) return console.log("no runs recorded");
      for (const run of rows) {
        console.log(
          `${run.startedAt.toISOString()}  ${run._id}  ${run.defectId}  ${run.env}  ${run.status}  ` +
            `affected=${run.planAffected} backups=${run.backupCount} by=${run.operator}`
        );
        if (run.error) console.log(`    error: ${run.error}`);
      }
    });
    return;
  }

  if (command === "rollback") {
    const runId = positional[0];
    if (!runId) fail("rollback needs a run id");
    const result = await withDb((db) => runRollback(db, runId));
    out({ ...result, ok: result.ok }, () => {
      console.log(result.detail);
      result.notes.forEach((n) => console.log(`  note: ${n}`));
    });
    if (!result.ok) process.exit(1);
    return;
  }

  const defectId = positional[0];
  if (!defectId) fail(`${command} needs a defect id (see: list)`);
  const defect = requireDefect(defectId);

  if (command === "detect") {
    const result = await withDb((db) => runDetect(db, defect, { env: ENV }));
    out({ ok: true, env: ENV, defectId, detect: result }, () => {
      console.log(`${defectId} @ ${ENV}: ${result.affected} affected`);
      result.notes?.forEach((n) => console.log(`  ${n}`));
      result.sample.forEach((s) => console.log(`  sample: ${JSON.stringify(s)}`));
    });
    return;
  }

  if (command === "verify") {
    const result = await withDb((db) => runVerify(db, defect, { env: ENV }));
    out({ ok: result.ok, env: ENV, defectId, verify: result }, () => {
      console.log(`${result.ok ? "CLEAN" : "STILL BROKEN"} — ${result.remaining} remaining`);
      result.notes.forEach((n) => console.log(`  ${n}`));
    });
    if (!result.ok) process.exit(1);
    return;
  }

  if (command === "plan") {
    const codeGate = computeCodeGate(defect);
    const outcome = await withDb((db) =>
      runPlan(db, defect, { env: ENV, operator: OPERATOR, codeGate })
    );
    out({ ok: true, ...outcome, codeGate: codeGate ?? null }, () => {
      console.log(`DRY RUN ${defectId} @ ${ENV}`);
      console.log(`  ${outcome.plan.summary}`);
      console.log(`  affected=${outcome.plan.affected} moneyDelta=${outcome.plan.moneyDelta}`);
      outcome.plan.notes?.forEach((n) => console.log(`    ${n}`));
      console.log("  guards:");
      outcome.guards.verdicts.forEach((v) =>
        console.log(`    [${v.ok ? "ok " : "REFUSE"}] ${v.guard}: ${v.detail}`)
      );
      if (outcome.token) {
        console.log(`\n  confirm token: ${outcome.token.id}`);
        console.log(`  expires: ${outcome.token.expiresAt.toISOString()} (10 min)`);
        console.log(
          `\n  apply with:\n    npx tsx scripts/remediation/cli.ts apply ${defectId} --env ${ENV} --token ${outcome.token.id}` +
            (ENV === "prod" ? " --confirm-prod" : "")
        );
      } else {
        console.log(`\n  NO TOKEN ISSUED: ${outcome.tokenWithheld}`);
      }
    });
    return;
  }

  if (command === "apply") {
    const tokenId = flag("token");
    if (!tokenId) fail("apply needs --token from a plan run in the last 10 minutes");
    const codeGate = computeCodeGate(defect);

    const result = await withDb(async (db) => {
      const lock = await readTurnLock(db, new Date());
      if (lock.isProcessing && !JSON_OUT) {
        console.log(`turn in flight (phase ${lock.processingPhase}) — this will be refused`);
      }
      return runApply(db, defect, {
        env: ENV,
        tokenId,
        operator: OPERATOR,
        codeGate,
        confirmProd: has("confirm-prod"),
      });
    });

    out({ ...result, env: ENV, defectId }, () => {
      if (!result.ok) {
        console.error(`REFUSED / FAILED: ${result.refusal}`);
        if (result.runId) console.error(`  run ${result.runId} recorded`);
        return;
      }
      console.log(`HEALED — run ${result.runId}`);
      console.log(`  ${JSON.stringify(result.run?.result)}`);
      console.log(`  verify: ${JSON.stringify(result.run?.verify)}`);
      console.log(`  rollback with: npx tsx scripts/remediation/cli.ts rollback ${result.runId}`);
    });
    if (!result.ok) process.exit(1);
    return;
  }

  fail(`unknown command "${command}"`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
