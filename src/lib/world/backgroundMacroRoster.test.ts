import { describe, expect, it } from "vitest";
import { backgroundMacroFeatureIdsForPreset, getWorldEntityMapSnapshot } from "./worldEntityMap";

describe("backgroundMacroFeatureIdsForPreset", () => {
  it("lists the roughly 150 nations 1991 simulates as background macro", () => {
    const ids = backgroundMacroFeatureIdsForPreset("1991-default");
    expect(ids.length).toBeGreaterThan(120);
    const snapshot = getWorldEntityMapSnapshot("1991-default");
    for (const id of ids) expect(snapshot.byFeatureId[id]?.simulationTier).toBe("background-macro");
    expect([...ids].sort()).toEqual(ids);
  });

  it("leaves out the full-autonomous economies", () => {
    const ids = new Set(backgroundMacroFeatureIdsForPreset("1991-default"));
    expect(ids.has("276")).toBe(false); // Germany
    expect(ids.has("840")).toBe(false); // United States
  });

  it("answers once per preset and nothing for an unknown one", () => {
    expect(backgroundMacroFeatureIdsForPreset("1991-default")).toBe(
      backgroundMacroFeatureIdsForPreset("1991-default")
    );
    expect(backgroundMacroFeatureIdsForPreset("1066-default")).toEqual([]);
  });
});
