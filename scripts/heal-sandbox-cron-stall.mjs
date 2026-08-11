/**
 * Heal a stalled game clock by firing /api/cron/turn until the game-clock
 * catches up to wall-clock minus 1h of headroom.
 *
 * Use after a cron-silence incident on sandbox (or live, by switching URL +
 * secret env) where the in-process cron stopped and `lastTurnProcessed` fell
 * far behind wall-clock. Each turn advances game-time by 1 hour
 * (MS_PER_TURN = 60 min), so a 20h gap takes ~20 turns.
 *
 * Why not just bump `gameState.lastTurnProcessed` directly? Because that
 * skips the entire phase pipeline — players wouldn't get AP, corporations
 * wouldn't refresh marketingStrength, elections wouldn't advance. The whole
 * point of the heal is to run the work that was missed, not to hide the
 * gap. We trigger real turns via the existing cron endpoint, which the
 * server's `processingLock` already serializes against any natural cron
 * fire that happens to overlap.
 *
 * Usage:
 *   node scripts/heal-sandbox-cron-stall.mjs              # heal sandbox
 *   node scripts/heal-sandbox-cron-stall.mjs --dry-run    # show plan only
 *   node scripts/heal-sandbox-cron-stall.mjs --max 30     # cap turns
 *   node scripts/heal-sandbox-cron-stall.mjs --url https://other --secret-env CRON_SECRET
 *
 * Defaults: URL https://sandbox.ahousedividedgame.com, secret from CRON_SECRET in .env.local,
 * max 50 turns. Bails out cleanly if the server isn't reachable, if it's
 * paused, or if a turn fails to advance.
 */
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const args = parseArgs(process.argv.slice(2));
const BASE_URL = (args.url ?? "https://sandbox.ahousedividedgame.com").replace(/\/+$/, "");
const SECRET_ENV = args["secret-env"] ?? "CRON_SECRET";
const SECRET = process.env[SECRET_ENV];
const HEADROOM_HOURS = numArg(args.headroom, 1);
const MAX_TURNS = numArg(args.max, 50);
const SLEEP_MS_BETWEEN = numArg(args["sleep-ms"], 1000);
const DRY_RUN = !!args["dry-run"];

await main();

async function main() {
  if (!SECRET) {
    console.error(`Missing ${SECRET_ENV} in environment (looked at .env.local).`);
    process.exitCode = 1;
    return;
  }

  console.log(`heal-sandbox-cron-stall`);
  console.log(`  URL              : ${BASE_URL}`);
  console.log(`  secret env       : ${SECRET_ENV} (length=${SECRET.length})`);
  console.log(`  headroom         : ${HEADROOM_HOURS}h`);
  console.log(`  max turns        : ${MAX_TURNS}`);
  console.log(`  sleep between    : ${SLEEP_MS_BETWEEN}ms`);
  console.log(`  dry run          : ${DRY_RUN}`);
  console.log();

  // 1. Liveness probe via /api/game/turn/status — public, Node-runtime, queries
  // gameState. If the Node process is dead this fails; /api/health uses edge
  // runtime and would mislead us into thinking the server is alive.
  const status = await getStatus();
  if (!status) {
    process.exitCode = 1;
    return;
  }
  console.log(`Server reachable. Current state:`);
  console.log(`  currentTurn         : ${status.currentTurn} (year ${status.currentYear})`);
  console.log(`  lastTurnProcessed   : ${status.lastTurnProcessed}`);
  console.log(`  isActive            : ${status.isActive}`);
  console.log(`  isProcessing        : ${status.isProcessing}`);
  console.log(`  pauseKind           : ${status.pauseKind}`);
  console.log(`  fastMode            : ${status.fastMode}`);
  console.log();

  if (!status.isActive) {
    console.error(`Game is paused (pauseKind=${status.pauseKind}).`);
    if (status.pauseReason) console.error(`  reason: "${status.pauseReason}"`);
    if (status.pauseKind === "auto-drift") {
      console.error(
        `\nThis is the auto-pause guard at turnSystem.ts:115-172 — it fires when a turn\n` +
          `runs after cron has been silent >4h. You must investigate the underlying cron\n` +
          `failure before resuming. Then resume from the admin UI (TurnControls) or POST\n` +
          `/api/admin/turn/start with admin session, then re-run this heal script.`
      );
    } else {
      console.error(`\nResume from the admin UI before running this heal.`);
    }
    process.exitCode = 1;
    return;
  }

  // 2. Compute the target gap and turn count.
  const wallNow = new Date();
  const gameNow = new Date(status.lastTurnProcessed);
  const hoursBehind = Math.floor((wallNow.getTime() - gameNow.getTime()) / 3_600_000);
  const turnsToRun = Math.min(MAX_TURNS, Math.max(0, hoursBehind - HEADROOM_HOURS));

  console.log(`Wall clock         : ${wallNow.toISOString()}`);
  console.log(`Game clock         : ${gameNow.toISOString()}`);
  console.log(`Hours behind       : ${hoursBehind}`);
  console.log(
    `Plan               : run ${turnsToRun} turn(s) (leaving ${HEADROOM_HOURS}h headroom)`
  );
  console.log();

  if (turnsToRun === 0) {
    console.log(`Nothing to do — game-clock is within ${HEADROOM_HOURS}h of wall-clock.`);
    return;
  }

  if (DRY_RUN) {
    console.log(`Dry run — exiting before firing turns.`);
    return;
  }

  // 3. Fire turns sequentially. The cron endpoint awaits processTurn() to
  // completion before responding, so back-to-back calls naturally serialize.
  // The server's processingLock also blocks any concurrent natural cron fire,
  // so we can't double-process even if the in-process scheduler comes back
  // to life mid-heal.
  const startedAt = Date.now();
  let processed = 0;
  let lastSeenTurn = status.currentTurn;
  let lastSeenGameTime = status.lastTurnProcessed;

  for (let i = 1; i <= turnsToRun; i++) {
    const turnStart = Date.now();
    let response;
    try {
      response = await fetch(`${BASE_URL}/api/cron/turn?source=primary`, {
        method: "GET",
        headers: { Authorization: `Bearer ${SECRET}` },
      });
    } catch (err) {
      console.error(`\nTurn ${i}/${turnsToRun} FETCH FAILED: ${err?.message ?? err}`);
      console.error(`Stopping after ${processed} turn(s). Server may have died mid-heal.`);
      process.exitCode = 1;
      return;
    }

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error(
        `\nTurn ${i}/${turnsToRun} HTTP ${response.status}: ${JSON.stringify(body).slice(0, 300)}`
      );
      process.exitCode = 1;
      return;
    }

    // Verify the game-clock actually advanced. If it didn't, something is
    // silently blocking (admin pause kicked in, lock not released, etc.).
    const fresh = await getStatus();
    if (!fresh) {
      process.exitCode = 1;
      return;
    }
    const turnDur = Date.now() - turnStart;
    if (fresh.currentTurn <= lastSeenTurn) {
      console.error(
        `\nTurn ${i}/${turnsToRun} did NOT advance: currentTurn still ${fresh.currentTurn}.\n` +
          `  message="${body?.message ?? body?.skipped ?? "unknown"}"\n` +
          `  pauseKind=${fresh.pauseKind} isProcessing=${fresh.isProcessing}\n` +
          `Stopping after ${processed} turn(s).`
      );
      process.exitCode = 1;
      return;
    }
    lastSeenTurn = fresh.currentTurn;
    lastSeenGameTime = fresh.lastTurnProcessed;
    processed++;

    console.log(
      `Turn ${String(i).padStart(2)}/${turnsToRun}  turn=${fresh.currentTurn}  ` +
        `gameTime=${fresh.lastTurnProcessed}  dur=${turnDur}ms`
    );

    if (i < turnsToRun && SLEEP_MS_BETWEEN > 0) {
      await sleep(SLEEP_MS_BETWEEN);
    }
  }

  const totalSec = Math.round((Date.now() - startedAt) / 100) / 10;
  console.log();
  console.log(`Done — ${processed}/${turnsToRun} turns processed in ${totalSec}s.`);
  console.log(`Final game-clock   : ${lastSeenGameTime}`);
  console.log(`Wall-clock now     : ${new Date().toISOString()}`);
}

// ───── helpers ────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function numArg(v, fallback) {
  if (v === undefined || v === true) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getStatus() {
  try {
    const res = await fetch(`${BASE_URL}/api/game/turn/status`, {
      method: "GET",
      headers: { "Cache-Control": "no-store" },
    });
    if (!res.ok) {
      console.error(
        `Liveness probe failed: HTTP ${res.status} from ${BASE_URL}/api/game/turn/status`
      );
      console.error(`The Node server may be down. Restart the Railway container before healing.`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`Liveness probe FETCH FAILED: ${err?.message ?? err}`);
    console.error(
      `The Node server may be down or unreachable. Restart the Railway container and try again.`
    );
    return null;
  }
}
