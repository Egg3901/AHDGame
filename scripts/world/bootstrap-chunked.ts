/**
 * Chunked bootstrap — seeds countries one group at a time.
 *
 * Problem: the full bootstrap loads ~6 countries + global data into memory
 * and OOMs on low-RAM machines (1-2 GB VPS).
 *
 * Solution: this script seeds in 5 discrete chunks, each with a fresh Node
 * process so memory is fully released between chunks.
 *
 * Usage:
 *   npx tsx scripts/bootstrap-chunked.ts --preset=2020-default
 *
 * It auto-runs all chunks sequentially. If a chunk fails, re-run with:
 *   npx tsx scripts/bootstrap-chunked.ts --preset=2020-default --from=uk
 *
 * Chunks:
 *   reference  — US states, parties, policies, legislation types, achievements
 *   uk         — UK regions, parties, demographics, metrics, baselines
 *   jp         — Japan regions, parties, demographics, metrics, baselines, emperor
 *   de         — Germany regions, parties, demographics, metrics, baselines
 *   br         — Brazil regions, parties, demographics, metrics, baselines
 *   cn         — China regions, parties, demographics, metrics, baselines, party org, wiki
 *   ie         — Ireland regions, parties, demographics, metrics, baselines
 *   global     — Budgets, seats, party budgets, sectors, indexes, forex, officials, elections
 *
 * Each chunk is idempotent — safe to re-run.
 */

import { spawn } from "child_process";
import * as path from "path";

const CHUNKS = ["reference", "uk", "jp", "de", "br", "cn", "ie", "global"];

function getArg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((v) => v.startsWith(prefix));
  return arg ? arg.split("=")[1] : fallback;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function runChunk(chunk: string, preset: string, reset: boolean): Promise<number> {
  return new Promise((resolve) => {
    const scriptPath = path.resolve(__dirname, "bootstrap-chunk-worker.ts");
    const args = [
      "--max-old-space-size=6144",
      "--expose-gc",
      "node_modules/.bin/tsx",
      scriptPath,
      `--chunk=${chunk}`,
      `--preset=${preset}`,
      ...(reset ? ["--reset-reference"] : []),
    ];

    console.log(`\n========================================`);
    console.log(`  Chunk: ${chunk.toUpperCase()}`);
    console.log(`========================================\n`);

    const child = spawn("node", args, {
      stdio: "inherit",
      env: process.env,
    });

    child.on("exit", (code) => {
      resolve(code ?? 1);
    });
  });
}

async function main() {
  const preset = getArg("preset", "2020-default")!;
  const reset = hasFlag("--reset-reference");
  const from = getArg("from");

  const startIdx = from ? CHUNKS.indexOf(from) : 0;
  if (startIdx === -1) {
    console.error(`Unknown chunk: ${from}. Valid: ${CHUNKS.join(", ")}`);
    process.exit(1);
  }

  console.log("=== Chunked Bootstrap ===");
  console.log(`Preset: ${preset}`);
  console.log(`Reset:  ${reset}`);
  console.log(`From:   ${from ?? "beginning"}`);
  console.log(`Chunks: ${CHUNKS.slice(startIdx).join(" → ")}`);
  console.log("");

  const startTime = Date.now();

  for (let i = startIdx; i < CHUNKS.length; i++) {
    const chunk = CHUNKS[i];
    const code = await runChunk(chunk, preset, reset && i === 0); // only reset on first chunk

    if (code !== 0) {
      console.error(`\n❌ Chunk "${chunk}" failed with exit code ${code}`);
      console.error(`To retry from this chunk, run:`);
      console.error(
        `  npx tsx scripts/bootstrap-chunked.ts --preset=${preset} --from=${chunk}${reset ? " --reset-reference" : ""}`
      );
      process.exit(code);
    }

    // Force a small pause between chunks so the OS can reclaim memory
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log("\n========================================");
  console.log("  ✅ All chunks completed successfully");
  console.log(`  Total time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log("========================================\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
