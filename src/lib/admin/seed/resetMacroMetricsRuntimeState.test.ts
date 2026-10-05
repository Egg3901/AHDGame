import type { Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import {
  MACRO_RUNTIME_UNSET_FIELDS,
  resetMacroMetricsRuntimeState,
} from "./resetMacroMetricsRuntimeState";

describe("resetMacroMetricsRuntimeState", () => {
  it("removes old runtime fields and national rollups while preserving authored baseline fields", async () => {
    const rows: Record<string, unknown>[] = [
      {
        _id: "GBR_ENG",
        countryId: "UK",
        economic: {
          gdpGrowth: { value: 2.1, trend: 0.4, simBaseline: 1.8, sectorBaseline: 2 },
          unemploymentRate: { value: 7.4, trend: -0.2, simBaseline: 7.5 },
        },
        population: { lifeExpectancy: { value: 72 } },
        governance: { debtToGdp: { value: 33 } },
        economicModel: "mixed",
        independenceDesire: { value: 54, trend: 0.7 },
        livingConflictExposure: { displacedShare: 0.1 },
        resetCohortReading: { asOfTurn: 500 },
        outputGap: 3.2,
        lastUpdated: new Date("1953-01-01"),
      },
      {
        _id: "uk_national",
        countryId: "UK",
        economic: { gdpGrowth: { value: 3 } },
        economicModel: "planned",
      },
    ];
    const collection = {
      updateMany: async (_filter: unknown, update: { $unset: Record<string, string> }) => {
        let modifiedCount = 0;
        for (const row of rows) {
          let modified = false;
          for (const path of Object.keys(update.$unset))
            modified = unsetPath(row, path) || modified;
          if (modified) modifiedCount += 1;
        }
        return { modifiedCount };
      },
      deleteMany: async (filter: { _id: { $in: string[] } }) => {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (filter._id.$in.includes(rows[i]!._id as string)) rows.splice(i, 1);
        }
        return { deletedCount: before - rows.length };
      },
    };
    const db = { collection: () => collection } as unknown as Db;

    const result = await resetMacroMetricsRuntimeState(db);

    expect(result).toEqual({ documentsModified: 2, nationalRollupsDeleted: 1 });
    expect(rows).toEqual([
      {
        _id: "GBR_ENG",
        countryId: "UK",
        economic: {
          gdpGrowth: { value: 2.1, sectorBaseline: 2 },
          unemploymentRate: { value: 7.4 },
        },
        population: { lifeExpectancy: { value: 72 } },
        lastUpdated: new Date("1953-01-01"),
      },
    ]);
    expect([...NATIONAL_SCOPE_IDS]).toContain("uk_national");
    expect(MACRO_RUNTIME_UNSET_FIELDS).toContain("economic.gdpGrowth.simBaseline");
    expect(MACRO_RUNTIME_UNSET_FIELDS).toContain("economic.gdpGrowth.trend");
    for (const preserved of ["_id", "countryId", "economic", "population", "lastUpdated"]) {
      expect(MACRO_RUNTIME_UNSET_FIELDS).not.toContain(preserved);
    }
  });
});

function unsetPath(document: Record<string, unknown>, path: string): boolean {
  const parts = path.split(".");
  const leaf = parts.pop();
  let current: Record<string, unknown> | undefined = document;
  for (const part of parts) {
    const next = current?.[part];
    if (typeof next !== "object" || next === null || Array.isArray(next)) return false;
    current = next as Record<string, unknown>;
  }
  if (!leaf || !current || !(leaf in current)) return false;
  delete current[leaf];
  return true;
}
