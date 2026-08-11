/**
 * Audit (and optionally heal) stale era cost fractions on enacted laws.
 *
 * Background (core-sim audit S5): the budget reseed upserts legislation-type
 * default laws with $set of the current seed definition, but historically did
 * NOT $unset gdpCostFraction / incomeCostFraction when the current definition
 * no longer carries them. calculateEnactedLawAnnualCost trusts those persisted
 * fields first, so a law reseeded from a high-fraction option to a low/no-
 * fraction option keeps charging the stale fraction (same class as the CN
 * 204%-GDP phantom-spending incident, via the reseed side-door).
 *
 * This script scans national enacted laws whose persisted gdpCostFraction /
 * incomeCostFraction differ from the current code catalog's policy option
 * (matched via policyOptionIndex) and reports old vs new computed annual cost
 * in local currency, grouped by country.
 *
 * DRY-RUN BY DEFAULT — no writes. Pass --apply to correct the stale fields
 * ($set to the catalog value where defined, $unset where not).
 *
 * Usage:
 *   MONGODB_URI="mongodb://...&directConnection=true" npx tsx scripts/audit-stale-cost-fractions.ts
 *   MONGODB_URI="..." npx tsx scripts/audit-stale-cost-fractions.ts --apply
 *
 * Falls back to MONGODB_URI_LIVE from .env.local (project convention).
 * Note: the standalone prod Mongo (single-node rs0) requires
 * directConnection=true — the script forces the driver option for non-SRV URIs.
 */
import { MongoClient, type Db, ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type { EnactedLaw, FederalBudget } from "../src/lib/db/types/budget";
import type { State } from "../src/lib/db/types/state";
import type { StateMetrics } from "../src/lib/db/types/stateMetrics";
import type { LegislationPolicyOption } from "../src/lib/db/types/legislation";
import { calculateEnactedLawAnnualCost, type BudgetCostContext } from "../src/lib/budget/costs";
import { legislationTypes } from "../src/lib/seeds/reference/legislationTypes";
import { getNationalBudgetId } from "../src/lib/bonds/sovereign";
import { getNationalDocId } from "../src/lib/constants/nationalScope";
import { getEraContext } from "../src/lib/era/context";
import type { CountryId } from "../src/lib/constants/countries";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const APPLY = process.argv.includes("--apply");
const uri = process.env.MONGODB_URI || process.env.MONGODB_URI_LIVE;
if (!uri) {
  console.error("Set MONGODB_URI (or MONGODB_URI_LIVE in .env.local)");
  process.exit(1);
}

const FRACTION_FIELDS = ["gdpCostFraction", "incomeCostFraction"] as const;
type FractionField = (typeof FRACTION_FIELDS)[number];

interface StaleRow {
  lawId: string;
  countryId: string;
  legislationTypeId: string;
  field: FractionField;
  persisted: number | undefined;
  catalog: number | undefined;
  oldAnnualCost: number;
  newAnnualCost: number;
}

async function buildContext(db: Db, countryId: CountryId, eraYear: number | null) {
  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ _id: getNationalBudgetId(countryId) });
  const states = await db
    .collection<State>("states")
    .find({ countryId })
    .project({ population: 1 })
    .toArray();
  const population = states.reduce((sum, s) => sum + ((s as Partial<State>).population ?? 0), 0);
  const nationalDocId = getNationalDocId(countryId);
  const metricsDoc = nationalDocId
    ? await db
        .collection<StateMetrics>("stateMetrics")
        .findOne({ _id: nationalDocId }, { projection: { "economic.medianIncome.value": 1 } })
    : null;
  const medianIncome = metricsDoc?.economic?.medianIncome?.value;
  const gdp = budget?.gdp ?? 0;
  const context: BudgetCostContext = {
    budgetCapacity: budget?.revenue?.total ?? 0,
    gdp,
    population,
    countryId,
    nationalGdpPerCapita: population > 0 && gdp > 0 ? gdp / population : undefined,
    nationalMedianIncome:
      typeof medianIncome === "number" && Number.isFinite(medianIncome) && medianIncome > 0
        ? medianIncome
        : undefined,
    year: eraYear,
  };
  return context;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

async function main() {
  const client = new MongoClient(uri!, {
    // Standalone prod Mongo (single-node rs0) needs directConnection; never
    // valid for mongodb+srv URIs.
    ...(uri!.startsWith("mongodb+srv") ? {} : { directConnection: true }),
  });
  await client.connect();
  const db = client.db();

  const typesById = new Map(legislationTypes.map((lt) => [lt._id, lt] as const));
  const { year: eraYear } = await getEraContext(db);

  const laws = await db
    .collection<EnactedLaw>("enactedLaws")
    .find({
      scope: "national",
      repealedAt: { $exists: false },
      $or: [{ gdpCostFraction: { $exists: true } }, { incomeCostFraction: { $exists: true } }],
    })
    .toArray();

  console.log(`Scanning ${laws.length} national enacted laws carrying cost fractions...`);
  console.log(`Era year: ${eraYear ?? "null (era cost path OFF — fractions currently dormant)"}`);
  console.log(`Mode: ${APPLY ? "APPLY (writes enabled)" : "DRY-RUN (report only, no writes)"}\n`);

  const contextCache = new Map<string, BudgetCostContext>();
  const staleRows: StaleRow[] = [];
  let unresolvable = 0;

  for (const law of laws) {
    const type = typesById.get(law.legislationTypeId);
    const option: LegislationPolicyOption | undefined =
      type && typeof law.policyOptionIndex === "number"
        ? type.policyOptions?.[law.policyOptionIndex]
        : undefined;
    if (!option) {
      unresolvable++;
      continue;
    }

    const staleFields = FRACTION_FIELDS.filter((f) => law[f] !== option[f]).filter(
      (f) => law[f] !== undefined || option[f] !== undefined
    );
    if (staleFields.length === 0) continue;

    const countryId = (law.countryId ?? "US") as CountryId;
    if (!contextCache.has(countryId)) {
      contextCache.set(countryId, await buildContext(db, countryId, eraYear));
    }
    const context = contextCache.get(countryId)!;

    const correctedLaw: EnactedLaw = { ...law };
    for (const f of FRACTION_FIELDS) {
      if (option[f] === undefined) delete correctedLaw[f];
      else correctedLaw[f] = option[f];
    }
    const oldAnnualCost = calculateEnactedLawAnnualCost(law, context);
    const newAnnualCost = calculateEnactedLawAnnualCost(correctedLaw, context);

    for (const field of staleFields) {
      staleRows.push({
        lawId: String(law._id),
        countryId,
        legislationTypeId: law.legislationTypeId,
        field,
        persisted: law[field],
        catalog: option[field],
        oldAnnualCost,
        newAnnualCost,
      });
    }

    if (APPLY) {
      const set: Record<string, number> = {};
      const unset: Record<string, ""> = {};
      for (const f of staleFields) {
        if (option[f] === undefined) unset[f] = "";
        else set[f] = option[f]!;
      }
      const update: Record<string, unknown> = {};
      if (Object.keys(set).length > 0) update.$set = set;
      if (Object.keys(unset).length > 0) update.$unset = unset;
      await db
        .collection<EnactedLaw>("enactedLaws")
        .updateOne({ _id: new ObjectId(law._id) }, update);
    }
  }

  if (unresolvable > 0) {
    console.log(
      `Skipped ${unresolvable} law(s) with no resolvable catalog policy option (missing type or policyOptionIndex).\n`
    );
  }

  if (staleRows.length === 0) {
    console.log("No stale cost fractions found. Persisted fractions match the current catalog.");
    await client.close();
    return;
  }

  // Per-country summary
  const byCountry = new Map<string, { count: number; delta: number }>();
  const seenLawIds = new Set<string>();
  for (const row of staleRows) {
    const entry = byCountry.get(row.countryId) ?? { count: 0, delta: 0 };
    if (!seenLawIds.has(row.lawId)) {
      // delta counted once per law even if both fields are stale
      entry.delta += row.newAnnualCost - row.oldAnnualCost;
      entry.count += 1;
      seenLawIds.add(row.lawId);
    }
    byCountry.set(row.countryId, entry);
  }

  console.log("=== Stale cost-fraction fields ===");
  for (const row of staleRows) {
    console.log(
      `[${row.countryId}] law ${row.lawId} (${row.legislationTypeId}) ${row.field}: ` +
        `persisted=${row.persisted ?? "(absent)"} catalog=${row.catalog ?? "(absent)"} | ` +
        `annual cost old=${fmt(row.oldAnnualCost)} new=${fmt(row.newAnnualCost)} ` +
        `delta=${fmt(row.newAnnualCost - row.oldAnnualCost)} (local currency)`
    );
  }

  console.log("\n=== Per-country summary ===");
  let totalDelta = 0;
  for (const [countryId, { count, delta }] of [...byCountry.entries()].sort()) {
    console.log(
      `${countryId}: ${count} stale law(s), annual cost delta ${fmt(delta)} (local currency)`
    );
    totalDelta += delta;
  }
  console.log(
    `\nTotal: ${seenLawIds.size} stale law(s) across ${byCountry.size} country(ies); ` +
      `summed delta ${fmt(totalDelta)} (MIXED local currencies — do not treat as one figure)`
  );
  console.log(
    APPLY
      ? "\nApplied corrections to all stale laws."
      : "\nDry-run only. Re-run with --apply to correct."
  );

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
