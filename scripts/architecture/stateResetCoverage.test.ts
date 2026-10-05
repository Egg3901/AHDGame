import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, bulkOps } from "@/lib/test-utils/mockDb";
import {
  resetStateRuntimeFields,
  STATE_PRESERVED_FIELD_REASONS,
} from "@/lib/admin/seed/resetStateRuntimeFields";
import { seedStateSectorSpecializations } from "@/lib/admin/seed/seedStateSectorSpecializations";

function declaredStateFields(): string[] {
  const sourcePath = resolve(process.cwd(), "src/lib/db/types/state.ts");
  const source = ts.createSourceFile(
    sourcePath,
    readFileSync(sourcePath, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  const declaration = source.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === "State"
  );
  if (!declaration) throw new Error("State interface was not found");
  return declaration.members
    .filter(ts.isPropertySignature)
    .map((member) => member.name.getText(source).replace(/\?$/, ""));
}

describe("states reset lifecycle contract", () => {
  it("accounts for each schema field through cleanup or a justified retained baseline", async () => {
    const db = createMockDb();
    db.collection("states");
    db.collectionMocks.states!.find.mockReturnValue({
      toArray: async () => [{ _id: "ENG", countryId: "UK", name: "England" }],
    });

    await resetStateRuntimeFields(db as unknown as Db);
    const cleared = new Set(
      db.collectionMocks.states!.updateMany.mock.calls.flatMap(([, update]) =>
        Object.keys((update.$unset as Record<string, unknown> | undefined) ?? {})
      )
    );
    await seedStateSectorSpecializations(db as unknown as Db, false, () => {});
    const sectorSeedFields = new Set(
      bulkOps(db.collectionMocks.states!.bulkWrite).flatMap(([, update]) =>
        Object.keys((update.$set as Record<string, unknown> | undefined) ?? {})
      )
    );
    const retained = new Set(Object.keys(STATE_PRESERVED_FIELD_REASONS));
    const declared = declaredStateFields();

    expect(new Set(declared).size).toBe(declared.length);
    expect(
      declared.filter((field) => !cleared.has(field) && !retained.has(field)),
      "Give every new State field an actual reset unset, a real bootstrap seed write, or a specific baseline reason"
    ).toEqual([]);
    expect(Object.values(STATE_PRESERVED_FIELD_REASONS).every((reason) => reason.trim())).toBe(
      true
    );
    expect(sectorSeedFields).toEqual(
      new Set([
        "sectorSpecializations.primary",
        "sectorSpecializations.secondary",
        "sectorSpecializations.updatedAt",
      ])
    );
  });
});
