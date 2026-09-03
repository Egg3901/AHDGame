/**
 * Savings account migration, gated.
 *
 * Requires `gameConfig.savingsAccountsMode` to be `authoritative` and a
 * clean dry run. Creates the account records through the settlement journal
 * with deterministic keys (safe to interrupt and resume), transfers backing
 * from the household pool for bank-held balances, recognizes each bank's
 * liability, and reconciles every currency batch before the next. A batch
 * that does not reconcile stops the run; that currency must not be added to
 * `savingsAccountsReadCurrencies`.
 *
 * Usage: npx tsx scripts/migrations/savings-accounts-migrate.ts --apply [--currency USD]
 */
import { connectDb, closeDb } from "../utils/db";
import { runSavingsMigration } from "../../src/lib/savings/migration";
import { renderMigrationPlan } from "../../src/lib/savings/rules/migration";
import { getCurrentTurn } from "../../src/lib/currentTurn";

function configureDbUri(): void {
  if (!process.env.MONGODB_URI && process.env.MONGODB_URI_LIVE) {
    process.env.MONGODB_URI = process.env.MONGODB_URI_LIVE;
  }
}

async function main(): Promise<number> {
  if (!process.argv.includes("--apply")) {
    console.error("Refusing to write without --apply. Run the dry run first.");
    return 2;
  }
  const idx = process.argv.indexOf("--currency");
  const currencies = idx >= 0 ? [process.argv[idx + 1]] : undefined;
  configureDbUri();
  const db = await connectDb();
  try {
    const turn = await getCurrentTurn(db);
    const { plan, batches } = await runSavingsMigration(db, turn, currencies);
    console.log(renderMigrationPlan(plan));
    for (const batch of batches) {
      console.log(
        `${batch.currency}: applied ${batch.applied}, replayed ${batch.replayed}, failed ${batch.failed}, ${batch.reconciled ? "RECONCILED" : `NOT RECONCILED (${batch.discrepancies})`}${batch.error ? ` ${batch.error}` : ""}`
      );
    }
    return plan.ok && batches.every((b) => b.reconciled) ? 0 : 1;
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
