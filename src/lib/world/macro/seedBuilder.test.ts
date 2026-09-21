import { describe, expect, it } from "vitest";
import type { CorporationType } from "@/lib/constants/corporations";
import { buildSectorsFromSpec } from "./seedBuilder";

type WeightMap = Partial<Record<CorporationType, number>>;

/** Legacy source objects predate the taxonomy; they arrive untyped. */
function legacyWeights(weights: Record<string, number>): WeightMap {
  return weights as unknown as WeightMap;
}

describe("buildSectorsFromSpec legacy media fold (issue #2234)", () => {
  it("folds legacy media/entertainment weights into one summed sector", () => {
    const legacy = buildSectorsFromSpec({
      annualGdpGameUnits: 4800,
      economicSystem: "market",
      sectorWeights: legacyWeights({ media: 2, entertainment: 3, energy: 5 }),
    });
    const canonical = buildSectorsFromSpec({
      annualGdpGameUnits: 4800,
      economicSystem: "market",
      sectorWeights: { media_entertainment: 5, energy: 5 },
    });
    expect("media" in legacy).toBe(false);
    expect("entertainment" in legacy).toBe(false);
    expect(legacy.media_entertainment).toEqual(canonical.media_entertainment);
  });

  it("keeps the planned-economy consumer-shortage ratio on the merged sector", () => {
    const sectors = buildSectorsFromSpec({
      annualGdpGameUnits: 4800,
      economicSystem: "planned",
      sectorWeights: legacyWeights({ media: 2, entertainment: 2, energy: 6 }),
    });
    const merged = sectors.media_entertainment!;
    expect(merged.domesticDemand / merged.capacity).toBeCloseTo(1.25, 9);
  });
});
