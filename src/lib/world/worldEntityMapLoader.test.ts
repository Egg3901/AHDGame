import type { Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getWorldEntityOrThrow } from "./worldEntityManifest";
import { buildBackgroundMacroCountry } from "./macro/backgroundSeed";
import { loadWorldEntityMapSnapshot } from "./worldEntityMapLoader";

const preset = "1991-default";
const now = new Date("1991-01-01T00:00:00Z");

describe("persisted world map and aggregate inspection", () => {
  it("shows only current active macro observations", async () => {
    const memory = createInMemoryDb();
    const canada = buildBackgroundMacroCountry(getWorldEntityOrThrow(preset, "CA"), preset, now);
    memory.seed("macroCountries", [{ ...canada, retiredAt: null }]);
    const current = await loadWorldEntityMapSnapshot(memory as unknown as Db, preset);
    expect(current.byEntityId!.CA.macroSummary?.population).toBe(canada.population);
    memory.collection("macroCountries").docs[0].retiredAt = now;
    const retired = await loadWorldEntityMapSnapshot(memory as unknown as Db, preset);
    expect(retired.byEntityId!.CA.macroSummary).toBeUndefined();
  });

  it("shows a ratified successor and its macro data together without rewriting opening geography", async () => {
    const memory = createInMemoryDb();
    const applicationId = `${preset}:test-settlement:1`;
    memory.seed("federationSettlementApplications", [
      {
        _id: applicationId,
        presetId: preset,
        settlementId: "test-settlement",
        revision: 1,
        sourceEntityId: "RU",
        entityIds: ["RU", "EE"],
        status: "applied",
        appliedOnTurn: 44,
      },
    ]);
    const source = { ...getWorldEntityOrThrow(preset, "RU"), displayName: "Russia" };
    const successor = {
      ...getWorldEntityOrThrow(preset, "EE"),
      status: "sovereign" as const,
      parentEntityId: undefined,
    };
    memory.seed(
      "worldEntityStates",
      [source, successor].map((entry) => ({
        _id: `${preset}:${entry.entityId}`,
        presetId: preset,
        entityId: entry.entityId,
        applicationId,
        appliedOnTurn: 44,
        entry,
      }))
    );
    const macro = buildBackgroundMacroCountry(successor, preset, now);
    memory.seed("macroCountries", [{ ...macro, retiredAt: null }]);
    const result = await loadWorldEntityMapSnapshot(memory as unknown as Db, preset);
    expect(result.byFeatureId["233"]).toMatchObject({ entityId: "EE", status: "sovereign" });
    expect(result.byEntityId!.EE.macroSummary?.population).toBe(macro.population);
    expect(getWorldEntityOrThrow(preset, "EE").status).toBe("emergent");
  });
});
