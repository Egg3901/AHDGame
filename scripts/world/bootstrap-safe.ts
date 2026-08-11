/**
 * Memory-safe bootstrap wrapper for low-RAM machines.
 *
 * Problem: bootstrapGameWorld imports huge data modules and runs ~30 seed
 * functions sequentially. On a 1-2 GB VPS this exceeds Node's default heap
 * (~1.4 GB) and gets killed by the OOM killer.
 *
 * Solution: This wrapper spawns the real bootstrap in a child process with
 * --max-old-space-size=4096 and --expose-gc. If the child still dies,
 * it prints fallback instructions (Railway shell or local machine).
 *
 * Usage:
 *   npx tsx scripts/bootstrap-safe.ts --preset=2020-default
 *   npx tsx scripts/bootstrap-safe.ts --preset=2020-default --reset-reference
 *
 * Or directly with more memory (same effect):
 *   node --max-old-space-size=4096 --expose-gc node_modules/.bin/tsx scripts/bootstrap-full.ts --preset=2020-default
 */

import { spawn } from "child_process";
import * as path from "path";

function main() {
  const args = process.argv.slice(2);
  const preset = args.find((a) => a.startsWith("--preset=")) ?? "--preset=2020-default";
  const mode = args.find((a) => a.startsWith("--mode=")) ?? "--mode=historical";
  const flags = args.filter(
    (a) => a.startsWith("--") && !a.startsWith("--preset=") && !a.startsWith("--mode=")
  );

  const scriptPath = path.resolve(__dirname, "bootstrap-full.ts");
  const childArgs = [
    "--max-old-space-size=4096",
    "--expose-gc",
    "node_modules/.bin/tsx",
    scriptPath,
    preset,
    mode,
    ...flags,
  ];

  console.log("=== Safe Bootstrap Wrapper ===");
  console.log(`Node flags: --max-old-space-size=4096 --expose-gc`);
  console.log(`Script: ${scriptPath}`);
  console.log(`Args: ${[preset, mode, ...flags].join(" ")}`);
  console.log("");

  const child = spawn("node", childArgs, {
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code) => {
    if (code !== 0) {
      console.error("");
      console.error("❌ Bootstrap child process exited with code", code);
      console.error("");
      console.error("The VPS likely still ran out of memory. Recommended fix:");
      console.error("");
      console.error("  Option A — Railway Shell (more RAM, runs on the database host):");
      console.error("    1. Railway Dashboard → a-house-divided-sandbox service → Shell tab");
      console.error("    2. Paste these commands:");
      console.error(
        '       export MONGODB_URI="mongodb://mongo:YOUR_PASSWORD@YOUR_HOST:27017/a-house-divided-sandbox?authSource=admin&authMechanism=SCRAM-SHA-256"'
      );
      console.error('       export MONGO_DB_NAME="a-house-divided-sandbox"');
      console.error(
        `       npx tsx scripts/bootstrap-full.ts ${preset} ${mode} ${flags.join(" ")}`
      );
      console.error("");
      console.error("  Option B — Your local machine (fastest, no network latency):");
      console.error("    1. cd a-house-divided");
      console.error("    2. Ensure .env.local has MONGODB_URI pointing to Railway");
      console.error(
        `    3. npx tsx scripts/bootstrap-full.ts ${preset} ${mode} ${flags.join(" ")}`
      );
      console.error("");
      console.error("  Option C — Single-country seed (lightweight, for testing CN):");
      console.error(`    npx tsx scripts/seed-cn.ts --reset`);
      console.error("");
      process.exit(code ?? 1);
    }
    process.exit(0);
  });
}

main();
