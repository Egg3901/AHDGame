import { describe, expect, it } from "vitest";
import { compareProposal, metricChangeVerdict } from "./proposalPreview";

describe("reset-law proposal preview", () => {
  it("replaces the enacted annual allocation and blocks a no-change option", () => {
    const result = compareProposal({
      currentPosition: "center_left",
      proposedPosition: "center_left",
      currentAnnualAllocation: 1_200_000_000,
      proposedAnnualAllocation: 1_200_000_000,
      metricChanges: [],
    });
    expect(result.isNoChange).toBe(true);
    expect(result.annualAllocationDelta).toBe(0);
    expect(result.allocationVerdict).toBe("neutral");
  });

  it("marks extra allocation as fiscal cost and savings as a benefit", () => {
    const input = {
      currentPosition: "center",
      proposedPosition: "far_left",
      currentAnnualAllocation: 1_000,
      proposedAnnualAllocation: 1_500,
      metricChanges: [],
    };
    expect(compareProposal(input)).toMatchObject({
      annualAllocationDelta: 500,
      allocationVerdict: "bad",
    });
    expect(compareProposal({ ...input, proposedAnnualAllocation: 700 })).toMatchObject({
      annualAllocationDelta: -300,
      allocationVerdict: "good",
    });
  });

  it("uses metric meaning rather than delta sign for good or bad", () => {
    expect(
      metricChangeVerdict({
        metricId: "18",
        currentValue: 20,
        proposedValue: 15,
        interpretation: "lower",
      })
    ).toBe("good");
    expect(
      metricChangeVerdict({
        metricId: "20",
        currentValue: 75,
        proposedValue: 74,
        interpretation: "higher",
      })
    ).toBe("bad");
    expect(
      metricChangeVerdict({
        metricId: "54",
        currentValue: 1.5,
        proposedValue: 1.7,
        interpretation: "context",
      })
    ).toBe("context");
    expect(
      metricChangeVerdict({
        metricId: "54",
        currentValue: 1.5,
        proposedValue: 1.7,
        interpretation: "band",
      })
    ).toBe("context");
  });

  it("judges band metrics only with an approved target range", () => {
    const input = {
      metricId: "54",
      currentValue: 4,
      proposedValue: 3,
      interpretation: "band" as const,
      preferredRange: { min: 1.8, max: 2.2 },
    };
    expect(metricChangeVerdict(input)).toBe("good");
    expect(metricChangeVerdict({ ...input, proposedValue: 1 })).toBe("good");
    expect(metricChangeVerdict({ ...input, proposedValue: 5 })).toBe("bad");
  });

  it("rejects malformed money, metrics, duplicate effects, and invalid ranges", () => {
    expect(() =>
      compareProposal({
        currentPosition: "center",
        proposedPosition: "left",
        currentAnnualAllocation: 0,
        proposedAnnualAllocation: Number.NaN,
        metricChanges: [],
      })
    ).toThrow();
    expect(() =>
      compareProposal({
        currentPosition: "center",
        proposedPosition: "left",
        currentAnnualAllocation: -1,
        proposedAnnualAllocation: 0,
        metricChanges: [],
      })
    ).toThrow();
    expect(() =>
      metricChangeVerdict({
        metricId: "01",
        currentValue: 1,
        proposedValue: 2,
        interpretation: "band",
        preferredRange: { min: 3, max: 2 },
      })
    ).toThrow();
    expect(() =>
      compareProposal({
        currentPosition: "center",
        proposedPosition: "left",
        currentAnnualAllocation: 0,
        proposedAnnualAllocation: 0,
        metricChanges: [
          { metricId: "01", currentValue: 1, proposedValue: 2, interpretation: "higher" },
          { metricId: "01", currentValue: 1, proposedValue: 2, interpretation: "higher" },
        ],
      })
    ).toThrow();
  });
});
