/**
 * Local worldsim MCP — stdio transport, for running the headless world sim on
 * your OWN machine instead of the shared ops box.
 *
 * WHY THIS EXISTS
 * ---------------
 * The ops-box worldsim MCP (LSGD-ops-dash/mcp/worldsim-server.js) is a
 * *Streamable HTTP* server: it listens on a port, validates an `ahdk_` bearer
 * token against the ops Mongo `agent_tokens` collection, and additionally
 * exposes live-economy tools that read PRODUCTION game data. None of that is
 * reproducible on a laptop, and none of it is wanted there.
 *
 * This file is the portable half. It speaks MCP over **stdio**, so the client
 * (Claude Code) spawns it as a child process — no port, no bearer token, no
 * ops-dashboard checkout, no production credentials. It exposes only the tools
 * that drive the REAL turn engine against a LOCAL sandbox Mongo, which is the
 * part that actually needs a big CPU rather than a big database.
 *
 * Deliberately omitted vs. the box MCP: sim_economy_whatif / sim_snapshot /
 * sim_list / sim_compare. Those read live production game collections to
 * calibrate a projection. Off-box there is no production Mongo to read, and
 * pointing them at one from a laptop is exactly what we do not want.
 *
 * ARCHITECTURE (identical to the box, minus the HTTP hop)
 * ------------------------------------------------------
 *   Claude Code ──stdio──> this file ──> simJobs (control-plane Mongo)
 *                                            ^
 *                                            │ polls every 15s
 *                                   scripts/sim/worker.ts
 *                                            │ spawns
 *                                   scripts/sim/runWorld.ts  (the turn engine)
 *                                            └──> ahd_sim_<seed> sandbox db
 *
 * This process ONLY reads/writes orchestration metadata (simJobs) and the
 * report collections. It never runs a turn itself — turns are long (a few
 * hundred can take hours), so they belong in the detached worker, and this
 * server returns a runId immediately.
 *
 * NO SDK ON PURPOSE
 * -----------------
 * The game repo does not depend on @modelcontextprotocol/sdk and this is not a
 * good reason to add one. MCP's stdio transport is newline-delimited JSON-RPC
 * 2.0 and needs exactly three methods (initialize / tools/list / tools/call),
 * implemented below in ~60 lines. That keeps the home setup to dependencies the
 * repo already has (mongodb + tsx) so `npm install` is the only prerequisite.
 *
 * Env:
 *   SIM_CONTROL_URI  control-plane Mongo (simJobs). Default mongodb://127.0.0.1:27018
 *   SIM_CONTROL_DB   control-plane db name.         Default sim_control
 *
 * Usage (normally via .mcp.json, not by hand):
 *   npx tsx scripts/sim/localWorldsimMcp.ts
 */

import { createInterface } from "readline";
import { randomUUID } from "crypto";
import { MongoClient, type Db } from "mongodb";
import { MARKET_MODE_ORDER, type MarketSystemMode } from "@/lib/market/modes";

const SIM_CONTROL_URI = process.env.SIM_CONTROL_URI || "mongodb://127.0.0.1:27018";
const SIM_CONTROL_DB = process.env.SIM_CONTROL_DB || "sim_control";

const SIM_JOBS = "simJobs";
const SIM_EXPERIMENT_REPORTS = "simExperimentReports";
const SIM_ELECTION_REPORTS = "simElectionReports";

/** Mirrors worker.ts's assertSafeToken. A seed/preset becomes both a Mongo db
 * name and a child-process argv, so it is validated here as well as there. */
const SAFE_TOKEN = /^[a-zA-Z0-9_-]{1,64}$/;
/** The box MCP caps at 1000 because it is shared infra. A laptop is not shared,
 * but the cap stays: it is also a guard against a typo'd 50000 that would run
 * for a week. worker.ts enforces <=5000 as the hard backstop regardless. */
const MAX_SIM_TURNS = 1000;

// Canonical tier list — a local literal here silently omitted every tier added
// after it was written (it stopped at "capital", so "plants" was neither
// advertised in the tool schema nor accepted). Pure constant module: no Mongo,
// no env, safe to import eagerly.
const MARKET_MODES = MARKET_MODE_ORDER;
const AUTONOMY_LEVELS = ["off", "v0", "v1", "v2", "v3", "v4"] as const;

// ---------------------------------------------------------------------------
// Tool definitions. Hand-written JSON Schema rather than zod-to-json-schema:
// one dependency-free place to read what the tool accepts.
// ---------------------------------------------------------------------------

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, db: Db) => Promise<unknown>;
}

const str = (description: string) => ({ type: "string", description });
const int = (description: string, minimum?: number, maximum?: number) => ({
  type: "integer",
  description,
  ...(minimum !== undefined ? { minimum } : {}),
  ...(maximum !== undefined ? { maximum } : {}),
});

function schema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

/** Reject anything that would become an unsafe Mongo db name or child argv. */
function safe(value: unknown, field: string): string {
  const s = String(value ?? "");
  if (!SAFE_TOKEN.test(s)) {
    throw new Error(`"${field}" must match ${SAFE_TOKEN} (got ${JSON.stringify(value)})`);
  }
  return s;
}

function turnsOf(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_SIM_TURNS) {
    throw new Error(
      `"turns" must be an integer 1..${MAX_SIM_TURNS} (got ${JSON.stringify(value)})`
    );
  }
  return n;
}

/** Evenly-spaced downsample — NOT a truncation, which would silently drop the
 * back half of a long run. Same helper the box MCP uses. */
function downsample<T>(arr: T[] | undefined, max: number): T[] | undefined {
  if (!Array.isArray(arr) || arr.length <= max) return arr;
  const step = arr.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

async function enqueue(db: Db, doc: Record<string, unknown>): Promise<Record<string, unknown>> {
  const runId = randomUUID();
  const now = new Date();
  await db.collection(SIM_JOBS).insertOne({
    _id: runId as never,
    runId,
    status: "queued",
    currentTurn: 0,
    error: null,
    createdAt: now,
    updatedAt: now,
    ...doc,
  });
  return { runId, status: "queued" };
}

const TOOLS: ToolDef[] = [
  {
    name: "sim_run_world",
    description:
      "Run the REAL turn engine headlessly on an isolated LOCAL sandbox world (never the live game) — every NPP fully autonomous — for seed/balance auditing. Enqueues a job; the local worker claims it within ~15s. Returns immediately with a runId: a few hundred turns can take hours. Poll with sim_run_status, then read sim_balance_report.",
    inputSchema: schema(
      {
        preset: str('e.g. "1953-default", "2019-default", "1991-default"'),
        turns: int(`how many turns to advance (1..${MAX_SIM_TURNS})`, 1, MAX_SIM_TURNS),
        seed: str(
          "RNG seed label — also derives the sandbox db name (ahd_sim_<seed>). The SAME seed continues that world if it already exists rather than starting fresh."
        ),
        marketSystemMode: {
          type: "string",
          enum: MARKET_MODES,
          description:
            'structural-market rollout tier seeded on the sandbox gameConfig; omit for the preset default ("off"). Long full-world runs generally want "capital".',
        },
        autonomyLevel: {
          type: "string",
          enum: AUTONOMY_LEVELS,
          description:
            'NPP autonomy tier. Omit for the harness default (v3). "v4" adds global economic behaviour and is what long full-world runs want.',
        },
      },
      ["preset", "turns", "seed"]
    ),
    handler: async (a, db) => {
      const preset = safe(a.preset, "preset");
      const seed = safe(a.seed, "seed");
      const turns = turnsOf(a.turns);
      if (a.marketSystemMode && !MARKET_MODES.includes(a.marketSystemMode as MarketSystemMode)) {
        throw new Error(`invalid marketSystemMode "${a.marketSystemMode}"`);
      }
      if (a.autonomyLevel && !AUTONOMY_LEVELS.includes(a.autonomyLevel as never)) {
        throw new Error(`invalid autonomyLevel "${a.autonomyLevel}"`);
      }
      const res = await enqueue(db, {
        preset,
        turns,
        seed,
        dbName: `ahd_sim_${seed}`,
        ...(a.marketSystemMode ? { marketSystemMode: a.marketSystemMode } : {}),
        ...(a.autonomyLevel ? { autonomyLevel: a.autonomyLevel } : {}),
      });
      return {
        ...res,
        preset,
        turns,
        seed,
        marketSystemMode: a.marketSystemMode || "off (preset default)",
        autonomyLevel: a.autonomyLevel || "v3 (harness default)",
        note: 'Poll with sim_run_status. The local worker claims queued jobs within ~15s — if status stays "queued" for minutes, the worker is not running (check sim_worker_health).',
      };
    },
  },
  {
    name: "sim_run_election",
    description:
      "Run an ELECTIONS-ONLY headless sim locally: the real turn engine with the economy/finance/ledger phases skipped, so primaries, presidential + down-ballot generals and per-country races play out fast without paying for corporationTurn/markets/forex. Election windows are long — use several HUNDRED turns to see resolved races. Poll with sim_election_status, then sim_election_report.",
    inputSchema: schema(
      {
        preset: str('e.g. "1953-default", "2019-default"'),
        turns: int(`how many turns to advance (1..${MAX_SIM_TURNS})`, 1, MAX_SIM_TURNS),
        seed: str("RNG seed label — also derives the sandbox db name"),
        countries: str('comma-separated country ids to scope to, e.g. "US,UK,DE"; omit for global'),
      },
      ["preset", "turns", "seed"]
    ),
    handler: async (a, db) => {
      const preset = safe(a.preset, "preset");
      const seed = safe(a.seed, "seed");
      const turns = turnsOf(a.turns);
      let countries: string | undefined;
      if (a.countries) {
        const ids = String(a.countries)
          .split(",")
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean);
        if (!ids.length) throw new Error('"countries" was empty after parsing');
        ids.forEach((id) => safe(id, "countries[]"));
        countries = ids.join(",");
      }
      const res = await enqueue(db, {
        preset,
        turns,
        seed,
        dbName: `ahd_sim_${seed}`,
        mode: "elections-only",
        ...(countries ? { countries } : {}),
      });
      return {
        ...res,
        mode: "elections-only",
        preset,
        turns,
        seed,
        countries: countries || "global",
        note: "Poll with sim_election_status.",
      };
    },
  },
  {
    name: "sim_run_status",
    description: "Poll a sim_run_world job's progress (status, current turn, last message, error).",
    inputSchema: schema({ runId: str("the runId returned by sim_run_world") }, ["runId"]),
    handler: async (a, db) => {
      const job = await db.collection(SIM_JOBS).findOne({ _id: String(a.runId) as never });
      if (!job) return { error: "no job with that runId" };
      return {
        runId: job._id,
        status: job.status,
        preset: job.preset,
        turns: job.turns,
        seed: job.seed,
        currentTurn: job.currentTurn ?? 0,
        lastMessage: job.lastMessage,
        lastWarnings: job.lastWarnings,
        error: job.error,
        metricsAvailable: !!job.metrics,
        metricsError: job.metricsError,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        completedAt: job.completedAt,
      };
    },
  },
  {
    name: "sim_election_status",
    description: "Poll a sim_run_election job's progress (status, current turn, mode, scope).",
    inputSchema: schema({ runId: str("the runId returned by sim_run_election") }, ["runId"]),
    handler: async (a, db) => {
      const job = await db.collection(SIM_JOBS).findOne({ _id: String(a.runId) as never });
      if (!job) return { error: "no job with that runId" };
      return {
        runId: job._id,
        status: job.status,
        mode: job.mode || "full",
        preset: job.preset,
        turns: job.turns,
        seed: job.seed,
        countries: job.countries || "global",
        currentTurn: job.currentTurn ?? 0,
        lastMessage: job.lastMessage,
        lastWarnings: job.lastWarnings,
        error: job.error,
        electionReportError: job.electionReportError,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        completedAt: job.completedAt,
      };
    },
  },
  {
    name: "sim_balance_report",
    description:
      "Read the balance-metric report for a completed sim_run_world job — wealth concentration (NPP Gini/top-1%), electoral competitiveness, office turnover, crisis outcomes, and economic stability (inflation/volatility).",
    inputSchema: schema({ runId: str("a completed run's runId") }, ["runId"]),
    handler: async (a, db) => {
      const job = await db.collection(SIM_JOBS).findOne({ _id: String(a.runId) as never });
      if (!job) return { error: "no job with that runId" };
      if (!job.metrics) {
        return {
          error: `no metrics yet — job status is "${job.status}"`,
          status: job.status,
          metricsError: job.metricsError || null,
        };
      }
      return {
        runId: job._id,
        preset: job.preset,
        seed: job.seed,
        status: job.status,
        ...job.metrics,
      };
    },
  },
  {
    name: "sim_compare_runs",
    description:
      "Diff two completed balance reports (two seeds, or a preset before/after a tuning change) per metric dimension.",
    inputSchema: schema({ runIdA: str("first runId"), runIdB: str("second runId") }, [
      "runIdA",
      "runIdB",
    ]),
    handler: async (a, db) => {
      const [x, y] = await Promise.all([
        db.collection(SIM_JOBS).findOne({ _id: String(a.runIdA) as never }),
        db.collection(SIM_JOBS).findOne({ _id: String(a.runIdB) as never }),
      ]);
      if (!x || !x.metrics)
        return { error: `runIdA has no metrics yet (status: ${x ? x.status : "not found"})` };
      if (!y || !y.metrics)
        return { error: `runIdB has no metrics yet (status: ${y ? y.status : "not found"})` };
      const flat = (m: Record<string, unknown>) =>
        Object.fromEntries(
          Object.entries(m).flatMap(([k, v]) =>
            typeof v === "object" && v !== null
              ? Object.entries(v as Record<string, unknown>).map(([k2, v2]) => [`${k}.${k2}`, v2])
              : [[k, v]]
          )
        );
      const af = flat(x.metrics);
      const bf = flat(y.metrics);
      const diff = Object.keys(af)
        .filter((k) => typeof af[k] === "number" && typeof bf[k] === "number")
        .map((k) => ({
          metric: k,
          a: af[k],
          b: bf[k],
          delta: +((bf[k] as number) - (af[k] as number)).toFixed(4),
        }));
      return {
        runIdA: a.runIdA,
        runIdB: a.runIdB,
        a: { preset: x.preset, seed: x.seed, turn: x.metrics.turn },
        b: { preset: y.preset, seed: y.seed, turn: y.metrics.turn },
        diff,
      };
    },
  },
  {
    name: "sim_experiment_report",
    description:
      "Deterministic (non-LLM) data report for a completed sim_run_world job — timelines of seats by party/country, party organization strength, and corporations by country across the run, plus end-state balance metrics. maxPoints caps each timeline.",
    inputSchema: schema(
      {
        runId: str("a completed run's runId"),
        maxPoints: int("cap per timeline (default 500)", 10, 5000),
      },
      ["runId"]
    ),
    handler: async (a, db) => {
      const max = Number(a.maxPoints ?? 500);
      const report = await db
        .collection(SIM_EXPERIMENT_REPORTS)
        .findOne({ _id: String(a.runId) as never });
      if (!report) {
        const job = await db.collection(SIM_JOBS).findOne({ _id: String(a.runId) as never });
        return {
          error: "no experiment report for that runId yet",
          jobStatus: job ? job.status : "not found",
          experimentsReportError: job ? job.experimentsReportError || null : null,
        };
      }
      return {
        runId: report._id,
        turn: report.turn,
        seatsTimeline: downsample(report.seatsTimeline, max),
        partyOrgTimeline: downsample(report.partyOrgTimeline, max),
        corporationsTimeline: downsample(report.corporationsTimeline, max),
        finalMetrics: report.finalMetrics,
        collectedAt: report.collectedAt,
      };
    },
  },
  {
    name: "sim_election_report",
    description:
      "Read the election-balance report for a completed sim_run_election job: per-election vote-over-time trajectories, winner + margin, lead changes (dynamism), plus aggregate competitiveness and per-country / per-electionType roll-ups. When more elections exist than maxElections, returns the MOST COMPETITIVE (smallest-margin) ones and says so.",
    inputSchema: schema(
      {
        runId: str("a completed elections-only run's runId"),
        maxElections: int("how many elections to return (default 150)", 1, 2000),
        maxTrajectoryPoints: int("points per trajectory (default 60)", 2, 500),
      },
      ["runId"]
    ),
    handler: async (a, db) => {
      const maxElections = Number(a.maxElections ?? 150);
      const maxPts = Number(a.maxTrajectoryPoints ?? 60);
      const report = await db
        .collection(SIM_ELECTION_REPORTS)
        .findOne({ _id: String(a.runId) as never });
      if (!report) {
        const job = await db.collection(SIM_JOBS).findOne({ _id: String(a.runId) as never });
        return {
          error: "no election report for that runId yet",
          jobStatus: job ? job.status : "not found",
          electionReportError: job ? job.electionReportError || null : null,
        };
      }
      const all: Record<string, unknown>[] = Array.isArray(report.elections)
        ? report.elections
        : [];
      const truncated = all.length > maxElections;
      const chosen = (
        truncated
          ? [...all]
              .sort((p, q) => ((p.marginPct as number) ?? 999) - ((q.marginPct as number) ?? 999))
              .slice(0, maxElections)
          : all
      ).map((e) => ({ ...e, trajectory: downsample(e.trajectory as unknown[], maxPts) }));
      return {
        runId: report._id,
        turn: report.turn,
        scope: report.scope,
        emptyCandidateSupplyCountries: report.emptyCandidateSupplyCountries,
        totals: report.totals,
        margin: report.margin,
        dynamism: report.dynamism,
        byCountry: report.byCountry,
        byElectionType: report.byElectionType,
        electionsTotal: all.length,
        electionsReturned: chosen.length,
        ...(truncated
          ? { note: `showing the ${maxElections} most competitive of ${all.length} elections` }
          : {}),
        elections: chosen,
        collectedAt: report.collectedAt,
      };
    },
  },
  {
    name: "sim_list_runs",
    description:
      "List recent local sim runs (newest first) with status and progress. Local-only convenience — the box MCP has no equivalent, because on the box you would look at the ops dashboard instead.",
    inputSchema: schema({ limit: int("how many to list (default 15)", 1, 100) }),
    handler: async (a, db) => {
      const rows = await db
        .collection(SIM_JOBS)
        .find(
          {},
          {
            projection: {
              status: 1,
              preset: 1,
              turns: 1,
              seed: 1,
              mode: 1,
              currentTurn: 1,
              error: 1,
              createdAt: 1,
              completedAt: 1,
            },
          }
        )
        .sort({ createdAt: -1 })
        .limit(Number(a.limit ?? 15))
        .toArray();
      return rows.map((r) => ({
        runId: r._id,
        status: r.status,
        mode: r.mode || "full",
        preset: r.preset,
        seed: r.seed,
        progress: `${r.currentTurn ?? 0}/${Number(r.turns) || "?"}`,
        error: r.error,
        createdAt: r.createdAt,
        completedAt: r.completedAt,
      }));
    },
  },
  {
    name: "sim_worker_health",
    description:
      'Check whether the local sim worker is alive and draining the queue. Call this FIRST when a job sits at status "queued" — on a laptop the usual cause is simply that the worker process is not running.',
    inputSchema: schema({}),
    handler: async (_a, db) => {
      const [queued, running, recent] = await Promise.all([
        db.collection(SIM_JOBS).countDocuments({ status: "queued" }),
        db.collection(SIM_JOBS).find({ status: "running" }).toArray(),
        db.collection(SIM_JOBS).find({}).sort({ updatedAt: -1 }).limit(1).toArray(),
      ]);
      const lastUpdate = recent[0]?.updatedAt ? new Date(recent[0].updatedAt) : null;
      const staleMin = lastUpdate ? (Date.now() - lastUpdate.getTime()) / 60000 : null;
      // The worker claims every 15s and mirrors run status every 20s, so if the
      // newest job document has not been touched in minutes while work is
      // outstanding, the worker is not attached to this queue.
      const looksAlive = staleMin !== null && staleMin < 3;
      return {
        controlPlane: `${SIM_CONTROL_URI} db=${SIM_CONTROL_DB}`,
        queued,
        running: running.map((r) => ({
          runId: r._id,
          seed: r.seed,
          progress: `${r.currentTurn ?? 0}/${Number(r.turns) || "?"}`,
        })),
        lastQueueActivity: lastUpdate,
        minutesSinceActivity: staleMin === null ? null : +staleMin.toFixed(1),
        workerLooksAlive: looksAlive,
        hint:
          queued > 0 && !looksAlive
            ? "Jobs are queued but nothing is moving — start the worker: npm run sim:worker"
            : running.length
              ? "A run is in progress. The worker runs ONE job at a time, so anything else stays queued until it finishes."
              : "Queue idle.",
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Minimal MCP stdio server: newline-delimited JSON-RPC 2.0 on stdin/stdout.
//
// stdout is the PROTOCOL CHANNEL — nothing may be written to it but JSON-RPC
// frames, or the client's parser desyncs and the server appears to hang. All
// diagnostics go to stderr.
// ---------------------------------------------------------------------------

const PROTOCOL_VERSION = "2024-11-05";

function send(msg: Record<string, unknown>) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function ok(id: unknown, result: unknown) {
  send({ jsonrpc: "2.0", id, result });
}

function fail(id: unknown, code: number, message: string) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function main() {
  const client = new MongoClient(SIM_CONTROL_URI);
  await client.connect();
  const db = client.db(SIM_CONTROL_DB);
  console.error(`[local-worldsim] control-plane ${SIM_CONTROL_URI} db=${SIM_CONTROL_DB}`);

  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      continue; // Not our frame; a parse error with no id has nowhere to go.
    }

    const { id, method } = msg as { id?: unknown; method?: string };
    // Notifications (no id) get no response, ever — replying to one is a
    // protocol violation that some clients treat as fatal.
    const isNotification = id === undefined || id === null;

    try {
      if (method === "initialize") {
        // Echo the client's protocol version back when it sent one. This server
        // implements only tools/list + tools/call, whose shape has been stable
        // across every revision, so agreeing with the client is both honest and
        // the thing least likely to strand a future Claude Code on a version
        // this file has never heard of. Fall back to a known-good version when
        // the client says nothing.
        const requested = (msg.params as { protocolVersion?: unknown } | undefined)
          ?.protocolVersion;
        ok(id, {
          protocolVersion: typeof requested === "string" ? requested : PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "local-worldsim", version: "1.0.0" },
        });
      } else if (method === "tools/list") {
        ok(id, {
          tools: TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        });
      } else if (method === "tools/call") {
        const params = (msg.params || {}) as { name?: string; arguments?: Record<string, unknown> };
        const tool = TOOLS.find((t) => t.name === params.name);
        if (!tool) {
          fail(id, -32602, `unknown tool "${params.name}"`);
          continue;
        }
        try {
          const result = await tool.handler(params.arguments || {}, db);
          ok(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
        } catch (err) {
          // A tool-level failure is a RESULT with isError, not a JSON-RPC error:
          // the latter reads as "the server is broken" rather than "that call
          // was wrong", and the model cannot recover from it.
          const message = err instanceof Error ? err.message : String(err);
          ok(id, { content: [{ type: "text", text: `Error: ${message}` }], isError: true });
        }
      } else if (isNotification) {
        continue; // notifications/initialized and friends
      } else {
        fail(id, -32601, `method not found: ${method}`);
      }
    } catch (err) {
      if (!isNotification) {
        fail(id, -32603, err instanceof Error ? err.message : String(err));
      }
    }
  }

  await client.close();
}

main().catch((err) => {
  console.error("[local-worldsim] fatal:", err);
  process.exit(1);
});
