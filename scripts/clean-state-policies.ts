import { connectDb, closeDb } from "./utils/db.js";

async function main() {
  const db = await connectDb();

  // Delete national-scope records for state_* types (they should only be state-scope)
  const result = await db.collection("statePolicies").deleteMany({
    scope: "national",
    legislationTypeId: { $regex: /^state_/ },
  });

  console.log(`Deleted ${result.deletedCount} state_* policies from national scope`);

  await closeDb();
}

main().catch(console.error);
