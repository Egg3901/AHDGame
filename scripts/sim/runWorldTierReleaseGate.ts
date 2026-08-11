/**
 * World-tiers 1953 release gate runner (#3729).
 *
 * 1. Runs the deterministic kernel + static coverage/readiness gate.
 * 2. Writes audit-reports/world-tiers-1953-release-gate-3729.md
 * 3. Optionally kicks a live processTurn() soak via scripts/sim/runWorld.ts
 *    for as many turns as requested (full 1,000 is multi-hour; default 0).
 *
 * Usage:
 *   npx tsx scripts/sim/runWorldTierReleaseGate.ts
 *   SIM_MONGODB_URI=mongodb://127.0.0.1:27018 \
 *     npx tsx scripts/sim/runWorldTierReleaseGate.ts --live-turns=48 --seed=wt1953-gate
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

function arg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const found = process.argv.find((v) => v.startsWith(prefix));
  return found?.slice(prefix.length);
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(`--${flag}`);
}

const liveTurns = Number(arg("live-turns") ?? "0");
const seed = arg("seed") ?? `wt1953-gate-${Date.now().toString(36)}`;
const reportRel = arg("report") ?? "audit-reports/world-tiers-1953-release-gate-3729.md";
const determinismLive = hasFlag("live-determinism");

async function runKernelAndWriteReport(): Promise<{
  reportPath: string;
  passed: boolean;
  kernelTurns: number;
  durationMs: number;
  fingerprint: string;
}> {
  const { runReleaseGate1953, formatReleaseGate1953Markdown, releaseGate1953Passed } =
    await import("@/lib/world/releaseGate1953");

  const report = runReleaseGate1953();
  const md = formatReleaseGate1953Markdown(report);

  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const reportPath = join(root, reportRel);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, md, "utf8");

  console.log(`[release-gate] wrote ${reportRel}`);
  console.log(
    `[release-gate] kernel ${report.kernel.turnsSimulated} turns in ${report.kernel.durationMs}ms; deterministic=${report.kernel.deterministic}`
  );
  console.log(
    `[release-gate] checks pass=${report.summary.passed} fail=${report.summary.failed} deferred=${report.summary.deferred}`
  );
  console.log(`[release-gate] 1979: ${report.proceed1979} — ${report.proceedReason}`);

  return {
    reportPath,
    passed: releaseGate1953Passed(report),
    kernelTurns: report.kernel.turnsSimulated,
    durationMs: report.kernel.durationMs,
    fingerprint: report.kernel.fingerprintA,
  };
}

function runLiveSoak(opts: {
  seed: string;
  turns: number;
  db?: string;
}): Promise<{ code: number; seed: string; db: string }> {
  const SIM_MONGODB_URI = process.env.SIM_MONGODB_URI;
  if (!SIM_MONGODB_URI) {
    throw new Error("SIM_MONGODB_URI is required for --live-turns>0");
  }
  const db = opts.db ?? `ahd_sim_${opts.seed}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  const args = [
    "tsx",
    "scripts/sim/runWorld.ts",
    `--seed=${opts.seed}`,
    `--preset=1953-default`,
    `--turns=${opts.turns}`,
    `--db=${db}`,
    `--run-id=${opts.seed}`,
    `--checkpoint-every=6`,
  ];

  console.log(`[release-gate] live soak: npx ${args.join(" ")}`);
  return new Promise((resolve) => {
    const child = spawn("npx", args, {
      env: {
        ...process.env,
        SIM_MONGODB_URI,
        NODE_ENV: "test",
      },
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve({ code: code ?? 1, seed: opts.seed, db }));
  });
}

async function appendLiveSection(reportPath: string, section: string): Promise<void> {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(reportPath, `\n## Live-engine soak results\n\n${section}\n`, "utf8");
}

async function main() {
  if (hasFlag("help") || hasFlag("h")) {
    console.log(
      "Usage: npx tsx scripts/sim/runWorldTierReleaseGate.ts [--live-turns=N] [--seed=id] [--live-determinism] [--report=path]"
    );
    process.exit(0);
  }

  const kernel = await runKernelAndWriteReport();
  if (!kernel.passed) {
    console.error("[release-gate] KERNEL/STATIC GATE FAILED");
    process.exit(1);
  }

  if (!Number.isFinite(liveTurns) || liveTurns < 0) {
    console.error(`--live-turns must be >= 0, got ${arg("live-turns")}`);
    process.exit(1);
  }

  if (liveTurns === 0) {
    console.log("[release-gate] skipping live soak (--live-turns=0)");
    process.exit(0);
  }

  if (determinismLive) {
    const a = await runLiveSoak({ seed: `${seed}-a`, turns: liveTurns });
    const b = await runLiveSoak({ seed: `${seed}-b`, turns: liveTurns });
    // Same seed label on fresh DBs — compare end turn + macro contribution fingerprint via mongosh-less note.
    // True cross-DB bit-equality is not expected (engine RNG gap); we record exit codes + turns completed.
    const section = [
      `- Live determinism pair requested at ${liveTurns} turns.`,
      `- Run A seed=\`${a.seed}\` db=\`${a.db}\` exit=${a.code}`,
      `- Run B seed=\`${b.seed}\` db=\`${b.db}\` exit=${b.code}`,
      `- Note: full-engine bit-for-bit equality is NOT guaranteed (SIM_RNG_SALT covers NPP actions only; see known blockers).`,
      `- Kernel determinism fingerprint: \`${kernel.fingerprint}\``,
    ].join("\n");
    await appendLiveSection(kernel.reportPath, section);
    process.exit(a.code === 0 && b.code === 0 ? 0 : 1);
  }

  const live = await runLiveSoak({ seed, turns: liveTurns });
  const section = [
    `- Live soak seed=\`${live.seed}\` db=\`${live.db}\` turns=${liveTurns} exit=${live.code}`,
    `- Started after kernel gate (${kernel.kernelTurns} turns, ${kernel.durationMs}ms, fp=\`${kernel.fingerprint}\`)`,
    `- Inspect turnLogs.success=false for #3703 nppStanceDrift BSON failures.`,
  ].join("\n");
  await appendLiveSection(kernel.reportPath, section);
  process.exit(live.code);
}

main().catch((err) => {
  console.error("[release-gate] FAILED", err);
  process.exit(1);
});
