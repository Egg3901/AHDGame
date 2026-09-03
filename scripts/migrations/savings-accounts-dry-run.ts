/**
 * Savings account migration, dry run.
 *
 * Reads every legacy savings row, every active charter, each currency's
 * household pool and reserve requirement, and prints what the migration
 * would do per currency: accounts to create, backing transfers required from
 * the central bank's household pool, banks that would breach reserves or
 * equity once player deposits are real liabilities, and rows that cannot be
 * mapped. Writes nothing. Exits non-zero when an invariant fails, which is
 * the signal that the migration must not be run.
 *
 * Usage: npx tsx scripts/migrations/savings-accounts-dry-run.ts [--json]
 */
import { connectDb, closeDb } from "../utils/db";
import { loadSavingsMigrationInput } from "../../src/lib/savings/migration";
import { planSavingsMigration, renderMigrationPlan } from "../../src/lib/savings/rules/migration";

function configureDbUri(): void {
  if (!process.env.MONGODB_URI && process.env.MONGODB_URI_LIVE) {
    process.env.MONGODB_URI = process.env.MONGODB_URI_LIVE;
  }
}

async function main(): Promise<number> {
  configureDbUri();
  const db = await connectDb();
  try {
    const input = await loadSavingsMigrationInput(db);
    const plan = planSavingsMigration(input);
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(plan, null, 2));
    } else {
      console.log(renderMigrationPlan(plan));
    }
    return plan.ok ? 0 : 1;
  } finally {
    await closeDb();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(2);
  });
