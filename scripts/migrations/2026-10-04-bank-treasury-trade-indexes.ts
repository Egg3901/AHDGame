import type { Db } from "mongodb";
import type { MigrationResult } from "../../src/lib/migrations/types";
import { BANK_TREASURY_TRADES_INDEX } from "../../src/lib/admin/seed/indexes/banking";
import { closeDb, connectDb } from "../utils/db";

export async function runBankTreasuryTradeIndexes(
  db: Db,
  opts: { dryRun?: boolean } = { dryRun: true }
): Promise<MigrationResult> {
  const dryRun = opts.dryRun ?? true;
  const plan = BANK_TREASURY_TRADES_INDEX;
  if (dryRun) {
    return {
      documentsScanned: 1,
      documentsUpdated: 0,
      notes: [`would create ${plan.collection}.${plan.options.name}`],
    };
  }
  await db.collection(plan.collection).createIndex({ ...plan.keys }, { ...plan.options });
  return {
    documentsScanned: 1,
    documentsUpdated: 1,
    notes: [`created/verified ${plan.collection}.${plan.options.name}`],
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = await connectDb();
  try {
    const result = await runBankTreasuryTradeIndexes(db, { dryRun: !apply });
    for (const note of result.notes ?? []) console.log(note);
    console.log(
      apply ? "Index migration applied." : "Dry run only. Pass --apply to create the index."
    );
  } finally {
    await closeDb();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
