import { describe, expect, it } from "vitest";
import { computeTechAssetValueAnchor } from "../techAssetValue";
import { autoGrantedNodeIds, getTreeForType } from "@/lib/constants/techTree/selectors";
import { getResearchableDecades } from "@/lib/constants/techTree/decades";
import { TECH_ASSET_VALUE_PER_RD_ANCHOR } from "@/lib/constants/corporations";

const YEAR = 1991;

describe("computeTechAssetValueAnchor", () => {
  it("gives the era's free baseline grant no book value", () => {
    const granted = autoGrantedNodeIds("financial", YEAR);
    expect(granted.length).toBeGreaterThan(0);
    const value = computeTechAssetValueAnchor(
      { type: "financial", unlockedTechNodeIds: granted } as never,
      YEAR
    );
    expect(value).toBe(0);
  });

  it("values research in a decade the world can still research", () => {
    const researchable = new Set(getResearchableDecades(YEAR).map((d) => d.id));
    const node = getTreeForType("financial").find((n) => researchable.has(n.decadeId));
    expect(node).toBeDefined();
    const granted = autoGrantedNodeIds("financial", YEAR);
    const value = computeTechAssetValueAnchor(
      { type: "financial", unlockedTechNodeIds: [...granted, node!.id] } as never,
      YEAR
    );
    expect(value).toBeCloseTo(node!.cost * TECH_ASSET_VALUE_PER_RD_ANCHOR, 6);
  });

  it("keeps specializations from passed decades, which were choices", () => {
    const researchable = new Set(getResearchableDecades(YEAR).map((d) => d.id));
    const spec = getTreeForType("financial").find(
      (n) => !researchable.has(n.decadeId) && n.slot > 9
    );
    if (!spec) return; // tree without specializations in passed decades
    const value = computeTechAssetValueAnchor(
      { type: "financial", unlockedTechNodeIds: [spec.id] } as never,
      YEAR
    );
    expect(value).toBeGreaterThan(0);
  });

  it("returns 0 without a year or without nodes", () => {
    expect(
      computeTechAssetValueAnchor(
        { type: "financial", unlockedTechNodeIds: ["x"] } as never,
        undefined
      )
    ).toBe(0);
    expect(
      computeTechAssetValueAnchor({ type: "financial", unlockedTechNodeIds: [] } as never, YEAR)
    ).toBe(0);
  });
});
