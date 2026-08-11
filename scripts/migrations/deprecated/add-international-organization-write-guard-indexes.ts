/**
 * Migration: add unique indexes for international-organization write guards.
 *
 * Prevents concurrent duplicate writes on:
 * - organizationLeadershipElections (one pending leadership election per org)
 * - organizationMembershipProposals (one pending membership proposal per country/org)
 */

import { closeDb, connectDb } from "../../utils/db";

async function migrate() {
  console.log("Adding international-organization write-guard indexes...");
  const db = await connectDb();

  const results: string[] = [];

  async function ensure(
    collection: string,
    key: Record<string, 1 | -1>,
    name: string,
    options: Record<string, unknown>
  ) {
    try {
      await db.collection(collection).createIndex(key, { name, ...options });
      results.push(`✓ ${collection}.${name}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists")) {
        results.push(`= ${collection}.${name} (already exists)`);
      } else {
        results.push(`✗ ${collection}.${name}: ${msg}`);
      }
    }
  }

  await ensure(
    "organizationLeadershipElections",
    { organizationId: 1 },
    "unique_pending_org_leadership_election_per_org",
    {
      unique: true,
      partialFilterExpression: { status: "pending" },
    }
  );

  await ensure(
    "organizationMembershipProposals",
    { organizationId: 1, proposingCountryId: 1 },
    "unique_pending_org_membership_proposal_per_country",
    {
      unique: true,
      partialFilterExpression: { status: "pending" },
    }
  );

  await closeDb();

  console.log("\nResults:");
  results.forEach((result) => console.log(" ", result));
  console.log("\nDone.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
