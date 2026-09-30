/**
 * Reconcile old savings lifecycle omissions. Read-only unless --apply is set.
 * Review the aggregate plan first. A claim whose owner AND bank disappeared
 * requires --allow-missing-holder-writeoff; active owners are never written off.
 */
import { connectDb, closeDb } from "../utils/db";
import { repairSavingsLifecycle } from "../../src/lib/savings/lifecycleRepair";

async function main(): Promise<number> {
  const db = await connectDb();
  try {
    const result = await repairSavingsLifecycle(db, {
      apply: process.argv.includes("--apply"),
      allowMissingHolderWriteOff: process.argv.includes("--allow-missing-holder-writeoff"),
    });
    console.log(JSON.stringify(result, null, 2));
    return result.applied && result.discrepanciesAfter > 0 ? 1 : 0;
  } finally {
    await closeDb();
  }
}
main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Savings lifecycle repair failed");
    process.exit(2);
  });
