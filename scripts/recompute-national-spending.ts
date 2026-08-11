/**
 * Recompute national budget spending lines from current enacted laws —
 * the spending-only slice of POST /api/admin/heal/federal-budgets, WITHOUT
 * its step-1 seed upsert (which clobbers player-chosen policy options).
 *
 * Use after migrate-enacted-law-healthcare-fractions.ts so the corrected
 * fractions land in federalBudget.spending immediately instead of waiting
 * for the fiscal-year turn phase (issue #3137).
 *
 *   npx tsx scripts/recompute-national-spending.ts [--apply]
 */
import * as dotenv from "dotenv";
import { connectDb, closeDb } from "./utils/db";
import { calculateFederalSpending } from "@/lib/budget/spending";
import type { FederalBudget } from "@/lib/db/types/budget";

dotenv.config({ path: ".env.local" });

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const db = await connectDb();
  const now = new Date();

  const budgets = await db.collection<FederalBudget>("federalBudget").find({}).toArray();

  for (const budget of budgets) {
    if (!budget.debt || !budget.spending) continue;
    const debtInterest = budget.debt.principal * budget.debt.interestRate;
    const spending = await calculateFederalSpending(db, budget, debtInterest);
    if (spending.total <= 0) {
      console.log(`[${budget._id}] no law-derived spending — skipped`);
      continue;
    }
    const oldHc = budget.spending.byCategory?.healthcare ?? 0;
    const newHc = spending.byCategory?.healthcare ?? 0;
    const surplus = (budget.revenue?.total ?? 0) - spending.total;
    console.log(
      `[${budget._id}] healthcare ${(oldHc / 1e9).toFixed(1)}B -> ${(newHc / 1e9).toFixed(1)}B · total ${(budget.spending.total / 1e9).toFixed(0)}B -> ${(spending.total / 1e9).toFixed(0)}B`
    );
    if (apply) {
      await db
        .collection<FederalBudget>("federalBudget")
        .updateOne({ _id: budget._id }, { $set: { spending, surplus, updatedAt: now } });
    }
  }

  console.log(apply ? "APPLIED." : "DRY RUN — re-run with --apply.");
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
