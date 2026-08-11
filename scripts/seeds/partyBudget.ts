import { connectDb, closeDb } from "../utils/db";
import { seedPartyBudgets } from "../../src/lib/admin/seed/seedPartyBudgets";

async function main() {
  const db = await connectDb();

  try {
    await seedPartyBudgets(db, true, console.log);
  } finally {
    await closeDb();
  }
}

main().catch((error) => {
  console.error("Error seeding party budgets:", error);
  process.exit(1);
});
