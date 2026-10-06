import { getValidatedEnv, type Env } from "@/lib/env";
import type { ResetAndBootstrapOptions } from "@/lib/admin/resetAndBootstrapGameWorld";
import { assertResetDatabaseMatchesApplication } from "@/lib/admin/resetPreflight";
import type { Db } from "mongodb";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import type { BootstrapMode } from "@/lib/admin/bootstrapGameWorld";
import { presetDefaultsToFoundingPhase } from "@/lib/seeds/presetSelector";
import { connectDb } from "../utils/db";
import { closeResetDb } from "./closeResetDb";
import { resolveResetTarget } from "./resetTarget";

interface ResetAndBootstrapCliDependencies {
  validateEnvironment: () => Env;
  connectDb: (databaseName: string, uri: string) => Promise<Db>;
  closeDb: () => Promise<void>;
  reset: (options: ResetAndBootstrapOptions) => Promise<unknown>;
}

const defaultDependencies: Omit<ResetAndBootstrapCliDependencies, "reset"> = {
  validateEnvironment: getValidatedEnv,
  connectDb,
  closeDb: closeResetDb,
};

function getMode(args: readonly string[]): BootstrapMode {
  const arg = args.find((value) => value.startsWith("--mode="));
  return arg?.split("=")[1] === "vacant" ? "vacant" : "historical";
}

function getPreset(args: readonly string[]): string {
  const arg = args.find((value) => value.startsWith("--preset="));
  return arg?.split("=")[1] ?? DEFAULT_SEED_PRESET;
}

function hasFlag(args: readonly string[], flag: string): boolean {
  return args.includes(flag);
}

export async function runResetAndBootstrapCli(
  args: readonly string[] = process.argv,
  dependencies: Partial<ResetAndBootstrapCliDependencies> = {}
): Promise<void> {
  const deps = { ...defaultDependencies, ...dependencies };

  // Validate the full application schema before opening Mongo or allowing
  // --check-target to report success. The explicit assertion is checked
  // against the same normalized environment consumed by getDb().
  const applicationEnv = deps.validateEnvironment();
  const databaseName = resolveResetTarget(applicationEnv, args);
  assertResetDatabaseMatchesApplication(applicationEnv, databaseName, "checked target");

  // Seeders that call getDb() must select the same world as this CLI connection.
  process.env.MONGODB_DB = databaseName;
  const mode = getMode(args);
  const preset = getPreset(args);
  const startingParties = hasFlag(args, "--no-starting-parties") ? "none" : undefined;
  if (startingParties === "none" && preset !== "1991-default") {
    throw new Error("--no-starting-parties requires --preset=1991-default");
  }
  const skipRegionalCouncil = hasFlag(args, "--skip-regional-council");
  const resetReference = !hasFlag(args, "--preserve-reference");
  if (!resetReference && preset === "1991-default") {
    throw new Error(
      "--preserve-reference is not supported for 1991-default: its taxonomy seeds need a reference rebuild"
    );
  }
  const preIteration = hasFlag(args, "--pre-iteration")
    ? true
    : hasFlag(args, "--no-pre-iteration")
      ? false
      : undefined;
  const foundingEffective =
    mode === "historical" &&
    (preIteration ?? presetDefaultsToFoundingPhase(preset, startingParties ?? "default"));

  const db = await deps.connectDb(databaseName, applicationEnv.MONGODB_URI);
  try {
    assertResetDatabaseMatchesApplication(applicationEnv, db.databaseName, "connected database");
    console.log(`Reset target database: ${db.databaseName}`);
    if (hasFlag(args, "--check-target")) {
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

    const reset =
      deps.reset ??
      (async (options: ResetAndBootstrapOptions) => {
        const { resetAndBootstrapGameWorld } =
          await import("@/lib/admin/resetAndBootstrapGameWorld");
        return resetAndBootstrapGameWorld(options);
      });
    const result = await reset({
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

    const summary = result as {
      reset?: { details?: Record<string, number | undefined> };
      bootstrap?: Record<string, number | undefined>;
    };
    const details = summary.reset?.details ?? {};
    console.log(`- charactersRetired: ${details.charactersRetired ?? 0}`);
    console.log(`- electionsDeleted: ${details.electionsDeleted ?? 0}`);
    console.log(`- officialsDeleted: ${details.officialsDeleted ?? 0}`);
    console.log(`- nppsDeleted: ${details.nppsDeleted ?? 0}`);
    if (summary.bootstrap) {
      console.log(`- states: ${summary.bootstrap.states ?? 0}`);
      console.log(`- seats: ${summary.bootstrap.seats ?? 0}`);
      console.log(`- elections: ${summary.bootstrap.elections ?? 0}`);
      console.log(`- electedOfficials: ${summary.bootstrap.electedOfficials ?? 0}`);
    }
  } finally {
    await deps.closeDb();
  }
}
