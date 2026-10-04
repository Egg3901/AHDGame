import { connectDb } from "../utils/db";
import { closeResetDb } from "./closeResetDb";
import type { BootstrapMode } from "@/lib/admin/bootstrapGameWorld";
import { presetDefaultsToFoundingPhase } from "@/lib/seeds/presetSelector";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { resolveResetTarget } from "./resetTarget";

function getMode(): BootstrapMode {
  const arg = process.argv.find((value) => value.startsWith("--mode="));
  return arg?.split("=")[1] === "vacant" ? "vacant" : "historical";
}

function getPreset() {
  const arg = process.argv.find((value) => value.startsWith("--preset="));
  return arg?.split("=")[1] ?? DEFAULT_SEED_PRESET;
}

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

async function main() {
  const databaseName = resolveResetTarget(
    {
      MONGODB_URI: process.env.MONGODB_URI,
      MONGO_URL: process.env.MONGO_URL,
      MONGODB_DB: process.env.MONGODB_DB,
      MONGO_DB_NAME: process.env.MONGO_DB_NAME,
    },
    process.argv
  );
  // Seeders that use getDb() must select the same world as explicit Db callers.
  process.env.MONGODB_DB = databaseName;
  const mode = getMode();
  const preset = getPreset();
  const startingParties = hasFlag("--no-starting-parties") ? "none" : undefined;
  if (startingParties === "none" && preset !== "1991-default") {
    throw new Error("--no-starting-parties requires --preset=1991-default");
  }
  const skipRegionalCouncil = hasFlag("--skip-regional-council");
  // Default: drop + re-seed reference collections so schema drift can't linger
  // (e.g. a removed seed entry that's still in the database). --preserve-reference
  // restores the legacy "upsert in place" behaviour.
  const resetReference = !hasFlag("--preserve-reference");
  // Live pre-iteration "founding" phase: seed chambers vacant and stamp
  // preIteration.active so a cycle-0 founding election seats every political
  // nation before the real game begins (date pinned to the era start). Only
  // meaningful with the historical bootstrap; ignored for --mode=vacant.
  //
  // Neither flag given => undefined => resetAndBootstrapGameWorld applies the
  // preset + starting-party default (1953/1979 found; 1991 founds when partyless).
  const preIteration = hasFlag("--pre-iteration")
    ? true
    : hasFlag("--no-pre-iteration")
      ? false
      : undefined;

  // Mirrors resolution inside resetAndBootstrapGameWorld — for logging only.
  const foundingEffective =
    mode === "historical" &&
    (preIteration ?? presetDefaultsToFoundingPhase(preset, startingParties ?? "default"));

  const db = await connectDb(databaseName);
  try {
    console.log(`Reset target database: ${db.databaseName}`);
    if (hasFlag("--check-target")) {
      console.log("Target check complete; no reset or bootstrap executed");
      return;
    }
    console.log(
      `Resetting and bootstrapping game world (mode=${mode}, preset=${preset}, startingParties=${startingParties ?? "preset defaults"}${
        foundingEffective ? ", pre-iteration founding" : ""
      })`
    );
    if (!resetReference) {
      console.log(
        "--preserve-reference: existing reference collections will be upserted, not dropped"
      );
    }
    if (foundingEffective) {
      console.log(
        `pre-iteration founding ${
          preIteration === undefined ? "(preset default)" : "(explicit --pre-iteration)"
        }: chambers seed vacant; the founding (cycle-0) election runs with the date pinned to the era start until it completes. Pass --no-pre-iteration to force it off.`
      );
    }

    const { resetAndBootstrapGameWorld } = await import("@/lib/admin/resetAndBootstrapGameWorld");
    const { reset, bootstrap } = await resetAndBootstrapGameWorld({
      db,
      mode,
      preset,
      startingParties,
      skipRegionalCouncil,
      resetReference,
      deleteProfiles: false,
      adminUsername: "CLI",
      preIteration,
      log: console.log,
    });

    console.log(`- charactersRetired: ${reset.details.charactersRetired ?? 0}`);
    console.log(`- electionsDeleted: ${reset.details.electionsDeleted}`);
    console.log(`- officialsDeleted: ${reset.details.officialsDeleted}`);
    console.log(`- nppsDeleted: ${reset.details.nppsDeleted}`);
    if (bootstrap) {
      console.log(`- states: ${bootstrap.states}`);
      console.log(`- seats: ${bootstrap.seats}`);
      console.log(`- elections: ${bootstrap.elections}`);
      console.log(`- electedOfficials: ${bootstrap.electedOfficials}`);
    }
  } finally {
    await closeResetDb();
  }
}

main().catch((error) => {
  console.error("Reset and bootstrap failed:", error);
  process.exit(1);
});
