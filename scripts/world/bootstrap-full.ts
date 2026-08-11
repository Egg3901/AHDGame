import { connectDb, closeDb } from "../utils/db";
import {
  bootstrapGameWorld,
  stampInitialGameClock,
  type BootstrapMode,
} from "@/lib/admin/bootstrapGameWorld";
import { initializeGameState } from "@/lib/turnSystem";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

function getMode(): BootstrapMode {
  const arg = process.argv.find((value) => value.startsWith("--mode="));
  return arg?.split("=")[1] === "vacant" ? "vacant" : "historical";
}

function getPreset() {
  const arg = process.argv.find((value) => value.startsWith("--preset="));
  return arg?.split("=")[1] ?? DEFAULT_SEED_PRESET;
}

export async function runBootstrap(
  options: {
    db?: Awaited<ReturnType<typeof connectDb>>;
    mode?: BootstrapMode;
    preset?: string;
    skipRegionalCouncil?: boolean;
    resetReference?: boolean;
    log?: (msg: string) => void;
  } = {}
) {
  const externalDb = options.db;
  const db = externalDb ?? (await connectDb());

  try {
    // Only stamp the clock on a genuinely fresh world. bootstrapGameWorld()
    // is also legitimately called to re-seed reference data on an EXISTING,
    // already-running world (resetReference re-seeds without resetting) —
    // unconditionally stamping there would reset that world's currentYear
    // back to the preset's starting year, which would be destructive, not a
    // fix. Mirrors the same "alreadyBootstrapped" check scripts/sim/runWorld.ts
    // uses. Order matters: this must run BEFORE bootstrapGameWorld(), since
    // bootstrapGameWorld's own internal initializeGameState() call is
    // idempotent and inherits whatever gameState already exists at call
    // time — including the elections it spawns internally. See
    // stampInitialGameClock's doc comment in bootstrapGameWorld.ts for the
    // full story (found running the headless sim harness against a non-2019
    // preset for real).
    const officialsCount = await db.collection("electedOfficials").countDocuments();
    const nppsCount = await db.collection("npps").countDocuments({ retiredAt: null });
    if (officialsCount === 0 && nppsCount === 0) {
      const preset = options.preset ?? DEFAULT_SEED_PRESET;
      await initializeGameState();
      await stampInitialGameClock(db, preset);
    }

    return await bootstrapGameWorld({
      db,
      mode: options.mode,
      preset: options.preset,
      skipRegionalCouncil: options.skipRegionalCouncil,
      resetReference: options.resetReference,
      log: options.log,
    });
  } finally {
    if (!externalDb) {
      await closeDb();
    }
  }
}

async function main() {
  await runBootstrap({
    mode: getMode(),
    preset: getPreset(),
    skipRegionalCouncil: hasFlag("--skip-regional-council"),
    resetReference: hasFlag("--reset-reference"),
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Full bootstrap failed:", error);
    process.exit(1);
  });
}
