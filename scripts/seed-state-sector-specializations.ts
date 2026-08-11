import { getDb } from "../src/lib/mongodb";
import { seedStateSectorSpecializations } from "../src/lib/admin/seed/seedStateSectorSpecializations";

async function main() {
  const reset = process.argv.includes("--reset");
  const db = await getDb();
  await seedStateSectorSpecializations(db, reset, (message) => console.log(message));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
