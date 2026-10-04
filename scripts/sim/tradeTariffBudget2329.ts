import assert from "node:assert/strict";
import { clearCommodity } from "../../src/lib/trade/clearing";
import { buildTradeAffinity } from "../../src/lib/trade/tradeAffinity";
import type { Tariff } from "@/lib/db/types/tariff";

const tariffRates = [0, 5, 20, 50, 100];
const availableSurpluses = [25, 50, 100, 150];
const rows: Array<{
  tariffPct: number;
  availableSurplus: number;
  importedUnits: number;
  weightedImportSpending: number;
}> = [];

for (const tariffPct of tariffRates) {
  for (const availableSurplus of availableSurpluses) {
    const tariffs = [{ countryId: "CN", scopeType: "economy_wide", rate: tariffPct } as Tariff];
    const { affinityFor, importCostMultiplierFor } = buildTradeAffinity({
      ftaPairs: new Set(),
      blocsByCountry: new Map(),
      tariffs,
      embargoes: [],
    });
    const result = clearCommodity({
      countries: ["US", "CN"],
      supply: { US: availableSurplus, CN: 0 },
      demand: { US: 0, CN: 100 },
      affinity: (exporter, importer) => affinityFor("steel", exporter, importer),
      importCostMultiplier: (exporter, importer) =>
        importCostMultiplierFor("steel", exporter, importer),
    });
    const importedUnits = result.perCountry.CN.imports;
    const weightedImportSpending = importedUnits * (1 + tariffPct / 100);
    assert.ok(Number.isFinite(importedUnits));
    assert.ok(
      Math.abs(importedUnits - Math.min(availableSurplus, 100 / (1 + tariffPct / 100))) < 1e-8
    );
    assert.ok(weightedImportSpending <= 100 + 1e-8);
    assert.ok(importedUnits <= availableSurplus + 1e-8);
    assert.ok(Math.abs(result.perCountry.US.exports - importedUnits) < 1e-8);
    rows.push({
      tariffPct,
      availableSurplus,
      importedUnits: Number(importedUnits.toFixed(6)),
      weightedImportSpending: Number(weightedImportSpending.toFixed(6)),
    });
  }
}

process.stdout.write(
  `${JSON.stringify({ scope: "deterministic rules sensitivity; no world simulation", rows }, null, 2)}\n`
);
