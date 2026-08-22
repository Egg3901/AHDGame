import { describe, expect, it } from "vitest";
import {
  unownedPoolCredit,
  unownedPoolDeltaPipeline,
  unownedPoolDrawdown,
} from "@/lib/market/unownedPoolDraw";
import { unownedHeadroomUnitsPerAnchor } from "@/lib/market/unownedHeadroom";

const BUCKET = {
  stateId: "CA",
  countryId: "us",
  sectorType: "manufacturing" as const,
};
const NOW = new Date("2026-08-21T00:00:00.000Z");
const SCALE = 1;

describe("unownedPoolDeltaPipeline", () => {
  it("emits the delta stage and the trailing restatement as SEPARATE stages", () => {
    // The trailing stage reads the post-write `headroomUnits`, which is only
    // visible to a later stage. Folding them into one $set silently restates
    // revenue from the PRE-write units.
    const stages = unownedPoolDeltaPipeline(BUCKET, -100, NOW, SCALE);
    expect(stages).toHaveLength(2);
    const [deltaStage, trailingStage] = stages as [
      { $set: Record<string, unknown> },
      { $set: Record<string, unknown> },
    ];
    expect(deltaStage.$set).toHaveProperty("headroomUnits");
    expect(trailingStage.$set).toHaveProperty("revenue");
    expect(JSON.stringify(trailingStage.$set.revenue)).toContain("$headroomUnits");
  });

  it("clamps the pool at zero so a draw larger than the pool cannot go negative", () => {
    const stages = unownedPoolDeltaPipeline(BUCKET, -100, NOW, SCALE);
    const headroom = (stages[0] as { $set: { headroomUnits: unknown } }).$set.headroomUnits;
    expect(JSON.stringify(headroom)).toContain("$max");
    expect(JSON.stringify(headroom)).toContain("-100");
  });

  it("heals a pre-backfill row from revenue instead of defaulting units to zero", () => {
    // A bare `$ifNull: [..., 0]` turns the first drawdown into a total wipe of
    // the market's headroom. The base expression must derive from `revenue`.
    const stages = unownedPoolDeltaPipeline(BUCKET, -100, NOW, SCALE);
    const headroom = JSON.stringify(
      (stages[0] as { $set: { headroomUnits: unknown } }).$set.headroomUnits
    );
    expect(headroom).toContain("$headroomUnits");
    expect(headroom).toContain("$revenue");
    expect(headroom).toContain(String(unownedHeadroomUnitsPerAnchor("manufacturing", SCALE)));
  });

  it("carries upsert scaffolding so a lazily-created bucket is not written half-formed", () => {
    const deltaStage = unownedPoolDeltaPipeline(BUCKET, -1, NOW, SCALE)[0] as {
      $set: Record<string, unknown>;
    };
    for (const field of ["stateId", "countryId", "sectorType", "createdAt"]) {
      expect(deltaStage.$set).toHaveProperty(field);
    }
    expect(deltaStage.$set.updatedAt).toBe(NOW);
  });
});

describe("unownedPoolDrawdown", () => {
  it("subtracts the claimed units", () => {
    const stages = unownedPoolDrawdown(BUCKET, 250, NOW, SCALE);
    expect(JSON.stringify(stages)).toContain("-250");
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    "returns null for %p so the caller skips the write entirely",
    (units) => {
      // A no-op upsert would still MATERIALISE an empty bucket for a (state,
      // type) pair that legitimately has no pool row yet.
      expect(unownedPoolDrawdown(BUCKET, units, NOW, SCALE)).toBeNull();
    }
  );
});

describe("unownedPoolCredit", () => {
  it("adds the returned units back", () => {
    const stages = unownedPoolCredit(BUCKET, 250, NOW, SCALE);
    expect(JSON.stringify(stages)).toContain("250");
    expect(JSON.stringify(stages)).not.toContain("-250");
  });

  it("is the exact inverse of a drawdown of the same size", () => {
    const draw = unownedPoolDrawdown(BUCKET, 400, NOW, SCALE);
    const credit = unownedPoolCredit(BUCKET, 400, NOW, SCALE);
    expect(JSON.stringify(draw)).toBe(JSON.stringify(credit).replace(",400]", ",-400]"));
  });

  it.each([0, -5, Number.NaN])("returns null for %p", (units) => {
    expect(unownedPoolCredit(BUCKET, units, NOW, SCALE)).toBeNull();
  });
});
