import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import { createMockDb, bulkOps } from "@/lib/test-utils/mockDb";
import { writeSplitMetrics } from "@/lib/macroMetrics/split";
import { resetMacroMetricsRuntimeState } from "@/lib/admin/seed/resetMacroMetricsRuntimeState";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";

function declaredMacroFields(): string[] {
  const path = resolve(process.cwd(), "src/lib/db/types/macroMetrics.ts");
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  const declaration = source.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === "MacroMetricsDoc"
  );
  if (!declaration) throw new Error("MacroMetricsDoc interface was not found");
  return declaration.members
    .filter(ts.isPropertySignature)
    .map((member) => member.name.getText(source));
}

describe("macroMetrics reset lifecycle contract", () => {
  it("accounts for every field through unconditional seed writes or required cleanup", async () => {
    const db = createMockDb();
    // Omit every optional seed field. Only unconditional baseline writes can
    // cover a field that the incoming preset might not author.
    await writeSplitMetrics(
      db as unknown as Db,
      {
        _id: "MI",
        countryId: "US",
        economic: {},
        population: {},
        lastUpdated: new Date("1991-01-01"),
      } as StateMetrics
    );
    const collection = db.collectionMocks.macroMetrics!;
    const baselineFields = new Set(
      bulkOps(collection.bulkWrite).flatMap(([filter, update]) => [
        ...Object.keys(filter),
        ...Object.keys((update.$set as Record<string, unknown> | undefined) ?? {}),
      ])
    );
    await resetMacroMetricsRuntimeState(db as unknown as Db);
    const clearedFields = new Set(
      collection.updateMany.mock.calls.flatMap(([, update]) => Object.keys(update.$unset))
    );
    expect(
      declaredMacroFields().filter(
        (field) => !baselineFields.has(field) && !clearedFields.has(field)
      )
    ).toEqual([]);
    expect(collection.deleteMany).toHaveBeenCalledWith({ _id: { $in: [...NATIONAL_SCOPE_IDS] } });
  });
});
