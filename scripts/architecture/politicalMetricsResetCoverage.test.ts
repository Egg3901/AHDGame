import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as ts from "typescript";
import type { Db } from "mongodb";
import { createMockDb, bulkOps } from "@/lib/test-utils/mockDb";
import { seedPoliticalMetrics } from "@/lib/admin/seed/seedPoliticalMetrics";
import { seedPoliticalMetricsResiduals } from "@/lib/admin/seed/seedPoliticalLegislation";
import { resetPoliticalMetricsRuntimeState } from "@/lib/admin/seed/resetPoliticalMetricsRuntimeState";
import { SHIPPING_PRESETS } from "@/lib/world/eraRoster";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";

/** A migration stamp is intentionally retained so the texture backfill stays idempotent. */
const RETAINED_POLITICAL_METRICS_FIELDS: Record<string, string> = {
  playableTexture1953MigrationId:
    "Migration audit/idempotence stamp; the 1953 backfill uses it to avoid applying its texture twice.",
};

const STATES = [
  { _id: "MI", countryId: "US" },
  { _id: "LON", countryId: "UK" },
  { _id: "CEN", countryId: "RU" },
];

const SEED_CASES = SHIPPING_PRESETS.map((preset) => ({
  year: getStartingYearForPreset(preset),
  preset,
}));

function declaredPoliticalMetricsFields(): string[] {
  const sourcePath = resolve(process.cwd(), "src/lib/db/types/politicalMetrics.ts");
  const source = ts.createSourceFile(
    sourcePath,
    readFileSync(sourcePath, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  const declaration = source.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === "PoliticalMetricsDoc"
  );
  if (!declaration) throw new Error("PoliticalMetricsDoc interface was not found");
  return declaration.members
    .filter(ts.isPropertySignature)
    .map((member) => member.name.getText(source).replace(/\?$/, ""));
}

function freshDb() {
  const db = createMockDb();
  db.collection("states");
  db.collectionMocks.states!.find.mockImplementation(() => ({
    toArray: async () => STATES,
  }));
  db.collection("politicalMetrics");
  db.collectionMocks.politicalMetrics!.find.mockImplementation((filter: { countryId: string }) => ({
    toArray: async () => [
      { _id: `${filter.countryId}-region`, countryId: filter.countryId, values: {} },
    ],
  }));
  return db;
}

function updateFields(updates: Array<Record<string, unknown>>, operator: "$set" | "$unset") {
  return new Set(
    updates.flatMap((update) => Object.keys((update[operator] as Record<string, unknown>) ?? {}))
  );
}

describe("politicalMetrics reset lifecycle contract", () => {
  it.each(SEED_CASES)(
    "accounts for every field in $preset using actual reset/seed writes",
    async ({ year, preset }) => {
      const db = freshDb();
      const seedWrites: Array<Record<string, unknown>> = [];

      await seedPoliticalMetrics(db as unknown as Db, false, () => {}, year, preset);
      seedWrites.push(
        ...bulkOps(db.collectionMocks.politicalMetrics!.bulkWrite).map(([, update]) => update)
      );
      db.collectionMocks.politicalMetrics!.bulkWrite.mockClear();

      const seededFields = updateFields(seedWrites, "$set");
      const seedUnsetFields = updateFields(seedWrites, "$unset");

      await seedPoliticalMetricsResiduals(db as unknown as Db, year);
      const residualWrites = bulkOps(db.collectionMocks.politicalMetrics!.bulkWrite).map(
        ([, update]) => update
      );
      const residualFields = updateFields(residualWrites, "$set");
      expect(
        residualWrites.length,
        "seedPoliticalLegislation must rebuild residuals from source"
      ).toBeGreaterThan(0);
      expect(residualFields.has("residuals")).toBe(true);

      await resetPoliticalMetricsRuntimeState(db as unknown as Db);
      const resetUnsetFields = updateFields(
        db.collectionMocks.politicalMetrics!.updateMany.mock.calls.map(([, update]) => update),
        "$unset"
      );

      const declaredFields = declaredPoliticalMetricsFields();
      const accountedFields = new Set([
        ...seededFields,
        ...seedUnsetFields,
        ...residualFields,
        ...resetUnsetFields,
        ...Object.keys(RETAINED_POLITICAL_METRICS_FIELDS),
      ]);
      const unaccounted = declaredFields.filter((field) => !accountedFields.has(field));
      const staleRetentionEntries = Object.keys(RETAINED_POLITICAL_METRICS_FIELDS).filter(
        (field) => !declaredFields.includes(field)
      );
      const missingRetentionReasons = Object.values(RETAINED_POLITICAL_METRICS_FIELDS).filter(
        (reason) => reason.trim().length === 0
      );

      expect(new Set(declaredFields).size).toBe(declaredFields.length);
      expect(Object.keys(RETAINED_POLITICAL_METRICS_FIELDS)).toEqual([
        "playableTexture1953MigrationId",
      ]);
      expect(
        unaccounted,
        "Give each new politicalMetrics field a real seed/reset write or reviewed retention reason"
      ).toEqual([]);
      expect(staleRetentionEntries).toEqual([]);
      expect(missingRetentionReasons).toEqual([]);
    }
  );
});
