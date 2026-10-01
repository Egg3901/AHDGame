import type { Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getWorldEntityOrThrow } from "./worldEntityManifest";
import { loadWorldEntityMapSnapshot } from "./worldEntityMapLoader";

function splitWorld() {
  const memory = createInMemoryDb();
  const presetId = "1991-default";
  const applicationId = `${presetId}:czechoslovak-separation:1`;
  memory.seed("federationSettlementApplications", [
    {
      _id: applicationId,
      presetId,
      settlementId: "czechoslovak-separation",
      revision: 1,
      sourceEntityId: "CS",
      entityIds: ["CS", "CZ2", "SK"],
      status: "applied",
      appliedOnTurn: 100,
    },
  ]);
  memory.seed(
    "worldEntityStates",
    ["CS", "CZ2", "SK"].map((entityId) => ({
      _id: `${presetId}:${entityId}`,
      presetId,
      entityId,
      applicationId,
      appliedOnTurn: 100,
      entry: {
        ...getWorldEntityOrThrow(presetId, entityId),
        status: entityId === "CS" ? "dissolved" : "sovereign",
        parentEntityId: undefined,
      },
    }))
  );
  memory.seed("macroCountries", [
    {
      _id: "CZ2",
      presetId,
      simulationTier: "background-macro",
      retiredAt: null,
      population: 10300000,
      economicSystem: "market",
      stability: 70,
      tradeExposure: 0.4,
      lastMacroTickTurn: 101,
      contribution: { computedOnTurn: 101 },
      dataQuality: { provenance: "settled successor" },
    },
  ]);
  return memory;
}

describe("runtime world map loader", () => {
  it("shows enacted Czechoslovak separation and the successor's current aggregate economy together", async () => {
    const memory = splitWorld();
    const snapshot = await loadWorldEntityMapSnapshot(memory as unknown as Db, "1991-default");
    expect(snapshot.byEntityId!.CS.status).toBe("dissolved");
    expect(snapshot.byEntityId!.CZ2).toMatchObject({
      status: "sovereign",
      simulationTier: "background-macro",
      macroSummary: {
        population: 10300000,
        lastMacroTickTurn: 101,
        contributionComputedOnTurn: 101,
      },
    });
    expect(snapshot.byEntityId!.SK.status).toBe("sovereign");
    expect(getWorldEntityOrThrow("1991-default", "CS").status).toBe("sovereign");
  });

  it("fails closed when a settlement receipt lacks a successor state", async () => {
    const memory = splitWorld();
    memory.collection("worldEntityStates").docs.pop();
    await expect(
      loadWorldEntityMapSnapshot(memory as unknown as Db, "1991-default")
    ).rejects.toThrow("missing entity states");
  });
});
