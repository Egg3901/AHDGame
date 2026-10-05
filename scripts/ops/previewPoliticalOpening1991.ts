/** Read-only operator preview. Apply these exact CAS specs through the heal ledger. */
import { writeFileSync } from "node:fs";
import { MongoClient } from "mongodb";
import {
  planPoliticalOpening1991,
  RESET_RUNTIME_FIELDS,
} from "@/lib/politicalMetrics/rules/repair1991";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";

async function main() {
  const arg = (name: string) =>
    process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
  const environment = arg("--env");
  if (environment !== "sandbox" && environment !== "prod")
    throw new Error("Explicit --env=sandbox or --env=prod required");
  const database = environment === "prod" ? "a-house-divided" : "a-house-divided-sandbox";
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required");
  const client = new MongoClient(uri, {
    maxPoolSize: 2,
    serverSelectionTimeoutMS: 15000,
    appName: "political-opening-preview",
  });
  try {
    await client.connect();
    const db = client.db(database);
    const gameState = await db.collection("gameState").findOne({ _id: "current" } as never);
    if (
      !gameState ||
      gameState.preset !== "1991-default" ||
      gameState.currentYear !== 1991 ||
      gameState.isProcessing ||
      gameState.currentTurn !== 1
    ) {
      throw new Error("Repair requires an idle1991opening at turn1; clocks are never modified");
    }
    const states = await db
      .collection("states")
      .find({}, { projection: { _id: 1, countryId: 1 } })
      .toArray();
    const keys = new Set(states.map((state) => `${state.countryId}:${state._id}`));
    const docs = await db.collection<PoliticalMetricsDoc>("politicalMetrics").find({}).toArray();
    const rebases = [];
    const runtimeCleanup = [];
    for (const doc of docs) {
      if (!keys.has(`${doc.countryId}:${doc._id}`)) continue;
      const after = planPoliticalOpening1991(doc);
      if (after)
        rebases.push({
          env: environment,
          description:
            "Issue3266 1991political opening rebase preserving player score changes and law target distance",
          collection: "politicalMetrics",
          expectedMax: 1,
          filter: {
            _id: doc._id,
            countryId: doc.countryId,
            values: doc.values,
            politicalOpeningVersion: doc.politicalOpeningVersion ?? { $exists: false },
            residuals: doc.residuals ?? { $exists: false },
          },
          action: { kind: "set", set: after },
        });
      const old =
        ["US", "UK", "RU"].includes(doc.countryId) && after
          ? RESET_RUNTIME_FIELDS.filter((field) => field in doc)
          : [];
      if (
        old.some(
          (field) => Object.keys((doc as unknown as Record<string, object>)[field] ?? {}).length > 0
        )
      )
        runtimeCleanup.push({
          env: environment,
          description:
            "Opening-only cleanup of embedded effects retained from the previous world; values and structural residuals preserved",
          collection: "politicalMetrics",
          expectedMax: 1,
          filter: {
            _id: doc._id,
            countryId: doc.countryId,
            ...Object.fromEntries(
              old.map((field) => [field, (doc as unknown as Record<string, unknown>)[field]])
            ),
          },
          action: { kind: "unset", unset: old },
        });
    }
    const report = {
      environment,
      database,
      world: {
        turn: gameState.currentTurn,
        year: gameState.currentYear,
        iteration: gameState.iteration,
        preset: gameState.preset,
        isActive: gameState.isActive,
        pauseReason: gameState.pauseReason,
        nextScheduledTurn: gameState.nextScheduledTurn,
      },
      currentRegions: states.length,
      rebases,
      runtimeCleanup,
    };
    const output = arg("--output");
    if (!output) throw new Error("--output=<private evidence path> is required");
    writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    console.log(
      JSON.stringify({
        environment,
        currentRegions: states.length,
        rebases: rebases.length,
        runtimeCleanup: runtimeCleanup.length,
        output,
      })
    );
  } finally {
    await client.close();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.name : "Preview failed");
  process.exitCode = 1;
});
