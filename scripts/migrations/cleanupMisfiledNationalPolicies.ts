/**
 * One-time migration: relocate or remove statePolicies docs whose stateId doesn't
 * match their legislation type's countryScope.
 *
 * Background: audit after running backfillStatePolicyScope.ts surfaced 54 docs
 * where a national-scope statePolicy was stored under the wrong country's national
 * stateId (e.g. `stateId: "federal"` with a JP-only legislation type, leftovers
 * from a pre-basePolicies.ts seed). These show up as duplicates on the destination
 * country's policy page and get erroneously applied as foreign-national policies
 * in processStatePolicyEffects (which groups by stateId).
 *
 * For each misfiled national doc:
 *   - If the correct stateId does NOT already have a doc for this legType → MOVE
 *     (update stateId).
 *   - If the correct stateId ALREADY has a doc → DELETE the misfiled one. The
 *     destination doc is authoritative (either enacted via a bill or seeded
 *     under the correct country).
 *
 * Skipped: docs whose legislationTypeId has no `countryScope` field. Those are
 * US-legacy types that correctly sit at `stateId: "federal"`.
 *
 * Run: npx tsx scripts/migrations/cleanupMisfiledNationalPolicies.ts
 * Requires MONGODB_URI in .env.local (point it at the target environment).
 */
import type { ObjectId } from "mongodb";
import { connectDb, closeDb } from "../utils/db";
import { NATIONAL_SCOPE } from "../../src/lib/constants/nationalScope";
import type { CountryId } from "../../src/lib/constants/countries";

async function main() {
  const db = await connectDb();

  // Build expected-stateId lookup keyed by lowercased countryScope
  const expectedStateIdByCountryScope: Record<string, string> = {};
  for (const [stateId, countryId] of Object.entries(NATIONAL_SCOPE) as [string, CountryId][]) {
    expectedStateIdByCountryScope[countryId.toLowerCase()] = stateId;
  }

  const legTypes = await db
    .collection("legislationTypes")
    .find({}, { projection: { _id: 1, countryScope: 1 } })
    .toArray();
  const countryScopeByLegType = new Map<string, string | undefined>(
    legTypes.map((t) => [
      String(t._id),
      (t as Record<string, unknown>).countryScope as string | undefined,
    ])
  );

  const nationalDocs = await db.collection("statePolicies").find({ scope: "national" }).toArray();

  // Index existing (stateId, legTypeId) tuples for conflict detection
  const existingKeys = new Set(
    nationalDocs.map(
      (d) =>
        `${(d as Record<string, unknown>).stateId}:${(d as Record<string, unknown>).legislationTypeId}`
    )
  );

  let moved = 0;
  let deleted = 0;
  let skipped = 0;

  for (const doc of nationalDocs) {
    const r = doc as Record<string, unknown>;
    const stateId = r.stateId as string;
    const ltId = r.legislationTypeId as string;
    const _id = r._id as ObjectId;

    const countryScope = countryScopeByLegType.get(ltId);
    if (!countryScope) {
      skipped++; // no countryScope → US legacy, correctly placed
      continue;
    }
    const expected = expectedStateIdByCountryScope[countryScope];
    if (!expected) {
      skipped++; // legType references a country not in NATIONAL_SCOPE
      continue;
    }
    if (expected === stateId) {
      skipped++; // correctly placed
      continue;
    }

    const destinationHasDoc = existingKeys.has(`${expected}:${ltId}`);

    if (destinationHasDoc) {
      // Conflict — destination is authoritative, drop the misfiled copy
      await db.collection("statePolicies").deleteOne({ _id });
      existingKeys.delete(`${stateId}:${ltId}`);
      deleted++;
      console.log(`  DELETE ${ltId} at ${stateId} (destination ${expected} already has it)`);
    } else {
      // Safe to relocate
      await db.collection("statePolicies").updateOne({ _id }, { $set: { stateId: expected } });
      existingKeys.delete(`${stateId}:${ltId}`);
      existingKeys.add(`${expected}:${ltId}`);
      moved++;
      console.log(`  MOVE   ${ltId}: ${stateId} → ${expected}`);
    }
  }

  console.log(`\nDone. Moved ${moved}, deleted ${deleted}, skipped ${skipped}.`);

  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
