import { connectDb, closeDb } from "./utils/db";

/**
 * China Readiness Diagnostic
 *
 * Read-only check that verifies all expected CN collections have been
 * seeded with minimum counts. Returns pass/fail per collection.
 *
 * Usage: npx tsx scripts/check-cn-readiness.ts
 */

interface CheckSpec {
  collection: string;
  query: Record<string, unknown>;
  minCount: number;
  label: string;
}

const CHECKS: CheckSpec[] = [
  {
    collection: "states",
    query: { countryId: "CN" },
    minCount: 7,
    label: "CN regions (7 macro-regions)",
  },
  {
    collection: "politicalParties",
    query: { countryId: "CN" },
    minCount: 3,
    label: "CN parties (CCP + 2 minor parties)",
  },
  {
    collection: "demographicCategories",
    query: { _id: "cn_voterGroups" },
    minCount: 1,
    label: "CN demographic categories",
  },
  {
    collection: "stateDemographics",
    query: { countryId: "CN" },
    minCount: 7,
    label: "CN region demographics",
  },
  {
    collection: "stateDemographicTurnout",
    query: { countryId: "CN" },
    minCount: 7,
    label: "CN demographic turnout",
  },
  {
    collection: "stateMetrics",
    query: {
      _id: { $in: ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"] },
    },
    minCount: 7,
    label: "CN state metrics",
  },
  {
    collection: "stateBaselines",
    query: {
      _id: { $in: ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"] },
    },
    minCount: 7,
    label: "CN state baselines",
  },
  {
    collection: "governmentFormations",
    query: { _id: "cn_government" },
    minCount: 1,
    label: "CN government formation",
  },
  {
    collection: "federalBudget",
    query: { countryId: "CN" },
    minCount: 1,
    label: "CN federal budget",
  },
  {
    collection: "stateBudgets",
    query: { countryId: "CN" },
    minCount: 7,
    label: "CN regional budgets (7 macro-regions)",
  },
  {
    collection: "enactedLaws",
    query: { countryId: "CN" },
    minCount: 1,
    label: "CN default enacted laws",
  },
  {
    collection: "legislationTypes",
    query: { countryScope: "cn" },
    minCount: 6,
    label: "CN legislation types",
  },
  {
    collection: "seats",
    query: { countryId: "CN" },
    minCount: 14,
    label: "CN seats (7 NPC + 7 governor)",
  },
  {
    collection: "statePartyOrg",
    query: { countryId: "CN" },
    minCount: 21,
    label: "CN state party org (7 regions x 3 parties)",
  },
  {
    collection: "electedOfficials",
    query: { countryId: "CN" },
    minCount: 0,
    label: "CN elected officials (0 expected pre-election)",
  },
];

async function main() {
  console.log("=== China Readiness Diagnostic ===\n");

  const db = await connectDb();
  let passed = 0;
  let failed = 0;

  for (const check of CHECKS) {
    const count = await db.collection(check.collection).countDocuments(check.query);
    const status = count >= check.minCount ? "PASS" : "FAIL";

    if (status === "PASS") {
      passed++;
      console.log(`[${status}] ${check.label}: ${count} (min: ${check.minCount})`);
    } else {
      failed++;
      console.log(
        `[${status}] ${check.label}: ${count} (min: ${check.minCount}) — MISSING ${check.minCount - count}`
      );
    }
  }

  // Extra detail for failed collections
  console.log("\n=== Detail ===");

  for (const check of CHECKS) {
    const count = await db.collection(check.collection).countDocuments(check.query);
    if (count < check.minCount) {
      console.log(`\n${check.label}:`);
      console.log(`  Collection: ${check.collection}`);
      console.log(`  Query: ${JSON.stringify(check.query)}`);
      console.log(`  Found: ${count}, Expected: >= ${check.minCount}`);

      // List a few sample docs if any exist
      const samples = await db.collection(check.collection).find(check.query).limit(3).toArray();
      if (samples.length > 0) {
        console.log(`  Samples: ${samples.map((s) => s._id).join(", ")}`);
      } else {
        console.log("  No matching documents found.");
      }
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Passed: ${passed}/${CHECKS.length}`);
  console.log(`Failed: ${failed}/${CHECKS.length}`);
  console.log(
    failed === 0
      ? "\nChina is READY for activation."
      : "\nChina is NOT ready — run the seed script first."
  );

  await closeDb();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Readiness check failed:", err);
  process.exit(1);
});
