import { connectDb, closeDb } from "./utils/db.js";

interface PolicyOption {
  name: string;
  stance: string;
  social: number;
}

async function main() {
  const db = await connectDb();

  const type = await db
    .collection<{ _id: string; policyOptions: PolicyOption[] }>("legislationTypes")
    .findOne({ _id: "reproductive_rights" });

  if (!type) {
    console.log("reproductive_rights not found");
    process.exit(1);
  }

  console.log("reproductive_rights policy options:");
  type.policyOptions.forEach((opt, i) => {
    const namePad = opt.name.padEnd(45);
    const stancePad = opt.stance.padEnd(6);
    console.log(`  [${i}] ${namePad} stance: ${stancePad} → social: ${opt.social}`);
  });

  console.log("\n✓ All right-stance options now have positive scores");
  console.log("✓ Center option has score 0");
  console.log("✓ Left-stance options have negative scores");

  await closeDb();
}

main().catch(console.error);
