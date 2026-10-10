/** Explicit live Cabinet repair. Dry-run by default; never falls back to MONGODB_URI. */
import { MongoClient } from "mongodb";
import { config } from "dotenv";
import { resolve } from "node:path";
import { DEFAULT_MONGODB_DB_NAME, extractMongoDbNameFromUri } from "../../src/lib/mongodb";
import { migration } from "../../src/lib/migrations/entries/2026-10-10-complete-cabinet-v2-accounts";
import { runMigrations } from "../../src/lib/migrations/runner";

export function parseLiveCabinetMigrationArgs(argv: string[]) {
  const allowed = new Set(["--apply", "--dry-run", "--force", "--help"]);
  if (argv.some((arg) => !allowed.has(arg))) throw new Error("Unknown Cabinet migration argument");
  if (argv.includes("--apply") && argv.includes("--dry-run"))
    throw new Error("Choose apply or dry-run");
  return {
    dryRun: !argv.includes("--apply"),
    force: argv.includes("--force"),
    help: argv.includes("--help"),
  };
}

export function liveCabinetMigrationTarget(env: Readonly<Record<string, string | undefined>>) {
  const uri = env.MONGODB_URI_LIVE?.trim();
  if (!uri) throw new Error("MONGODB_URI_LIVE is required; no local fallback is allowed");
  if (!/^mongodb(?:\+srv)?:\/\//i.test(uri))
    throw new Error("Invalid live MongoDB connection scheme");
  const databaseName =
    env.MONGODB_DB_LIVE?.trim() || extractMongoDbNameFromUri(uri) || DEFAULT_MONGODB_DB_NAME;
  return { uri, databaseName };
}

export async function runLiveCabinetMigration(
  argv: string[],
  env: Readonly<Record<string, string | undefined>> = process.env
) {
  const options = parseLiveCabinetMigrationArgs(argv);
  if (options.help) {
    console.log(
      "Usage: npx tsx scripts/migrations/complete-cabinet-v2-accounts-live.ts [--dry-run | --apply] [--force]"
    );
    console.log(
      "Reads MONGODB_URI_LIVE and optional MONGODB_DB_LIVE. Default: dry-run. Only the Cabinet account repair is selected. --force rechecks an existing migration marker."
    );
    return;
  }
  const target = liveCabinetMigrationTarget(env);
  const client = new MongoClient(target.uri, { serverSelectionTimeoutMS: 15_000, maxPoolSize: 2 });
  try {
    await client.connect();
    console.log(`Cabinet repair: MONGODB_URI_LIVE, ${options.dryRun ? "dry-run" : "apply"}`);
    const summary = await runMigrations(client.db(target.databaseName), {
      migrations: [migration],
      only: [migration.id],
      dryRun: options.dryRun,
      force: options.force,
    });
    console.log(JSON.stringify(summary, null, 2));
    return summary;
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  config({ path: resolve(process.cwd(), ".env.local"), quiet: true });
  void runLiveCabinetMigration(process.argv.slice(2)).catch(() => {
    // Driver errors can embed connection details. Never print the URI or raw error.
    console.error(
      "Cabinet live repair failed. Success is not confirmed. Check connectivity, transaction support, and current-world treasury settlement before retrying a dry-run."
    );
    process.exitCode = 1;
  });
}
