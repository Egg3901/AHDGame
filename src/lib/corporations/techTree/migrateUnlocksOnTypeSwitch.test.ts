import { describe, expect, it } from "vitest";
import { corpNodeId, sectorNodeId } from "@/lib/constants/techTree";
import { migrateUnlockedTechOnPrimaryTypeSwitch } from "./migrateUnlocksOnTypeSwitch";

describe("migrateUnlockedTechOnPrimaryTypeSwitch (ticket #1040)", () => {
  it("is a no-op when primary type is unchanged", () => {
    const ids = [corpNodeId("1940", 1), sectorNodeId("manufacturing", "1950", 1)];
    expect(
      migrateUnlockedTechOnPrimaryTypeSwitch(ids, "manufacturing", "manufacturing", 1953)
    ).toEqual({
      unlockedTechNodeIds: ids,
      clearDecadeLaneIds: [],
      strengthGrantReversal: { marketingStrength: 0, logisticsStrength: 0 },
    });
  });

  it("keeps corporate-lane unlocks and drops sector research on primary type switch", () => {
    const ids = [
      corpNodeId("1940", 1),
      corpNodeId("1940", 2),
      sectorNodeId("manufacturing", "1950", 1),
      sectorNodeId("manufacturing", "1950", 2),
    ];
    const next = migrateUnlockedTechOnPrimaryTypeSwitch(
      ids,
      "manufacturing",
      "chemical_industries",
      1953,
      { "1950": "sector" }
    );
    expect(next.unlockedTechNodeIds).toContain(corpNodeId("1940", 1));
    expect(next.unlockedTechNodeIds).toContain(corpNodeId("1940", 2));
    expect(next.unlockedTechNodeIds).not.toContain(sectorNodeId("manufacturing", "1950", 1));
    expect(next.unlockedTechNodeIds).not.toContain(sectorNodeId("manufacturing", "1950", 2));
    // Must NOT remap onto the new tree — sector research is forfeited.
    expect(next.unlockedTechNodeIds).not.toContain(sectorNodeId("chemical_industries", "1950", 1));
    expect(next.unlockedTechNodeIds).not.toContain(sectorNodeId("chemical_industries", "1950", 2));
    expect(next.clearDecadeLaneIds).toContain("1950");
  });

  it("replaces past-decade sector baseline with the new type auto-grant (Economy Empire shape)", () => {
    const ids = [
      corpNodeId("1940", 1),
      sectorNodeId("manufacturing", "1940", 1),
      sectorNodeId("manufacturing", "1940", 2),
      sectorNodeId("manufacturing", "1950", 1),
      sectorNodeId("manufacturing", "1950", 2),
    ];
    const next = migrateUnlockedTechOnPrimaryTypeSwitch(
      ids,
      "manufacturing",
      "chemical_industries",
      1953,
      { "1950": "sector" }
    );

    expect(next.unlockedTechNodeIds).not.toContain(sectorNodeId("manufacturing", "1940", 1));
    expect(next.unlockedTechNodeIds).toContain(sectorNodeId("chemical_industries", "1940", 1));
    expect(next.unlockedTechNodeIds).toContain(sectorNodeId("chemical_industries", "1940", 2));
    expect(next.unlockedTechNodeIds).not.toContain(sectorNodeId("manufacturing", "1950", 1));
  });

  it("drops unrelated sector orphans from a prior primary", () => {
    const ids = [
      corpNodeId("1940", 1),
      sectorNodeId("energy", "1940", 1),
      sectorNodeId("energy", "1950", 1),
    ];
    const next = migrateUnlockedTechOnPrimaryTypeSwitch(ids, "energy", "entertainment", 1953);
    expect(next.unlockedTechNodeIds.every((id) => !id.startsWith("energy-"))).toBe(true);
    expect(next.unlockedTechNodeIds).toContain(sectorNodeId("entertainment", "1940", 1));
    expect(next.unlockedTechNodeIds).not.toContain(sectorNodeId("entertainment", "1950", 1));
  });
});
