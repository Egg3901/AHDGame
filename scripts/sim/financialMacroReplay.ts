/** Sample the actual macro consumer around a retained-world credit shock. */
import assert from "node:assert/strict";
import type { Db } from "mongodb";
import { runMetricEngine } from "../../src/lib/metricEngine/phase";
import { processCommodityPriceTurn } from "../../src/lib/turn/commodityPriceTurn";
import { processCorporationTurn } from "../../src/lib/turn/corporationTurn";
import { loadFinancialCrisisDemand } from "../../src/lib/livingConflict/financialDemand";
import type { Corporation, FederalBudget } from "../../src/lib/db/types";

async function boundary(db: Db, countryId: string) {
  const states = await db
    .collection<{ _id: string; gdp: number; population: number }>("states")
    .find({ countryId })
    .toArray();
  const metrics = await db
    .collection<{
      _id: string;
      economic?: { gdpGrowth?: { value: number }; unemploymentRate?: { value: number } };
    }>("macroMetrics")
    .find({ _id: { $in: states.map((s) => s._id) } })
    .toArray();
  const growth = metrics
    .map((m) => m.economic?.gdpGrowth?.value)
    .filter((v): v is number => typeof v === "number");
  const unemployment = metrics
    .map((m) => m.economic?.unemploymentRate?.value)
    .filter((v): v is number => typeof v === "number");
  assert(states.length && growth.length && unemployment.length);
  assert([...growth, ...unemployment, ...states.map((s) => s.gdp)].every(Number.isFinite));
  assert(unemployment.every((v) => v >= 0 && v <= 100));
  assert(states.every((s) => s.gdp > 0));
  return {
    regions: states.length,
    totalRegionalGdp: states.reduce((sum, s) => sum + s.gdp, 0),
    growthMinimum: Math.min(...growth),
    growthMaximum: Math.max(...growth),
    unemploymentMinimum: Math.min(...unemployment),
    unemploymentMaximum: Math.max(...unemployment),
  };
}

export async function sampleFinancialMacro(db: Db, firstTurn: number) {
  const before = await boundary(db, "DE");
  const samples = [];
  // Actual producer receipts consume the crisis-adjusted commodity prices once.
  // The following bounded window advances macro dynamics, not a full world turn.
  const corporate = await processCorporationTurn(firstTurn);
  for (let offset = 0; offset <= 13; offset++) {
    const turn = firstTurn + offset;
    await db
      .collection("gameState")
      .updateOne({ _id: "current" as never }, { $set: { currentTurn: turn } });
    const demand = await loadFinancialCrisisDemand(
      db,
      turn,
      await db
        .collection<Corporation>("corporations")
        .find({ bankCharter: { $exists: true } })
        .toArray(),
      await db.collection<FederalBudget>("federalBudget").find({}).toArray()
    );
    if (offset % 4 === 0) await processCommodityPriceTurn(turn);
    const regionsProcessed = await runMetricEngine(db, turn);
    samples.push({
      turn,
      regionsProcessed,
      demandMultiplier: demand.get("DE"),
      ...(await boundary(db, "DE")),
    });
  }
  assert.equal(samples.at(-1)?.demandMultiplier, 1);
  return {
    scope:
      "One real producer phase, four commodity passes and fourteen macro passes; no full-world simulation or GDP/unemployment patches",
    before,
    corporate,
    samples,
  };
}
