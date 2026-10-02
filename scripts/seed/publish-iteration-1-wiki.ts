/**
 * Publish the Iteration 1 chronicle and add its navigation link to Beta 1 and
 * Beta 2. This command targets MONGODB_URI_LIVE only and is a dry run unless
 * --apply is passed.
 *
 * Usage:
 *   npm run seed:wiki:iteration1
 *   npm run seed:wiki:iteration1 -- --apply
 *
 * If a target page has human edits, the preflight blocks the write. Review the
 * live page first, then pass --force only when replacing those edits is
 * intentional:
 *   npm run seed:wiki:iteration1 -- --apply --force
 *
 * A nonstandard environment file can be supplied with --env-file=<path>.
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";
import { seedWikiPages, WIKI_SEED_PAGES } from "../../src/lib/seeds/wiki";

const TARGET_SLUGS = ["beta-1", "beta-2", "iteration-1"] as const;
const CLI_SEED_USER_ID = new ObjectId("000000000000000000000000");

function getValueArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function loadEnvironment(): string {
  const requested = getValueArg("env-file");
  const envPath = path.resolve(requested ?? path.join(process.cwd(), ".env.local"));
  if (requested && !fs.existsSync(envPath)) {
    throw new Error(`Environment file not found: ${envPath}`);
  }
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false, quiet: true });
    return envPath;
  }
  return "the process environment";
}

function validateSeedRegistration(): void {
  const registered = new Set(WIKI_SEED_PAGES.map((page) => page.slug));
  const missing = TARGET_SLUGS.filter((slug) => !registered.has(slug));
  if (missing.length > 0) {
    throw new Error(`Missing wiki seed registration: ${missing.join(", ")}`);
  }
}

function printPlan(label: string, values: readonly string[]): void {
  console.log(`${label}: ${values.length}${values.length ? ` (${values.join(", ")})` : ""}`);
}

async function main(): Promise<void> {
  const envPath = loadEnvironment();
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) {
    throw new Error(`MONGODB_URI_LIVE is missing from ${envPath}.`);
  }

  const apply = process.argv.includes("--apply");
  const force = process.argv.includes("--force");
  validateSeedRegistration();

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db("a-house-divided");
    console.log(`Iteration 1 wiki publication: ${apply ? "APPLY" : "DRY RUN"}`);
    console.log(`Human-edit overwrite: ${force ? "enabled" : "disabled"}`);

    const preview = await seedWikiPages(db, CLI_SEED_USER_ID, {
      dryRun: true,
      force,
      slugs: [...TARGET_SLUGS],
    });

    printPlan("Would insert", preview.inserted);
    printPlan("Would update", preview.updated);
    console.log(`Blocked: ${preview.skipped.length}`);
    for (const skipped of preview.skipped) {
      console.log(`  ${skipped.slug}: ${skipped.reason}`);
    }

    if (!apply) {
      console.log("No writes performed. Re-run with --apply after reviewing this plan.");
      return;
    }
    if (preview.skipped.length > 0) {
      throw new Error("Publication blocked by skipped pages; no writes were performed.");
    }

    const result = await seedWikiPages(db, CLI_SEED_USER_ID, {
      force,
      slugs: [...TARGET_SLUGS],
    });
    if (result.skipped.length > 0) {
      throw new Error(
        `Publication changed during apply and skipped: ${result.skipped.map((item) => item.slug).join(", ")}`
      );
    }

    printPlan("Inserted", result.inserted);
    printPlan("Updated", result.updated);
    console.log("Iteration 1 wiki publication complete.");
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
