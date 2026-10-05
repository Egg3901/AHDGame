import { describe, expect, it } from "vitest";
import {
  removeDraftProvision,
  reviewDraftBill,
  upsertDraftProvision,
  type DraftLawProvision,
} from "./draft";

const health: DraftLawProvision = {
  familyId: "L18",
  scope: "national",
  choice: "center_left",
  fundingOwnerId: "secretary_of_health",
  currentAnnualAllocation: 900,
  proposedAnnualAllocation: 1_200,
  primaryMetricIds: ["18", "19"],
};

describe("Guided Path draft review", () => {
  it("opens an overview that can add, edit, and remove provisions without double charging", () => {
    const first = upsertDraftProvision([], health);
    const edited = upsertDraftProvision(first, {
      ...health,
      choice: "far_left",
      proposedAnnualAllocation: 1_600,
    });
    expect(edited).toHaveLength(1);
    expect(reviewDraftBill(edited).totalAnnualChange).toBe(700);
    expect(removeDraftProvision(edited, "national", "L18")).toEqual([]);
  });

  it("groups fixed bill allocations by national funding seat and counts shared metrics once", () => {
    const second: DraftLawProvision = {
      familyId: "L19",
      scope: "national",
      choice: "center_right",
      fundingOwnerId: "secretary_of_health",
      currentAnnualAllocation: 700,
      proposedAnnualAllocation: 500,
      primaryMetricIds: ["19", "20"],
    };
    const review = reviewDraftBill([health, second]);
    expect(review.agencyAllocations).toEqual([
      { ownerId: "secretary_of_health", proposedAnnualAllocation: 1_700, change: 100 },
    ]);
    expect(review.regionalAnnualChange).toBe(0);
    expect(review.totalAnnualChange).toBe(100);
    expect(review.distinctPrimaryMetricIds).toEqual(["18", "19", "20"]);
  });

  it("charges a regional bill to its regional budget without creating a Cabinet wallet", () => {
    const regional: DraftLawProvision = {
      ...health,
      scope: "regional",
      fundingOwnerId: null,
    };
    const review = reviewDraftBill([regional]);
    expect(review.agencyAllocations).toEqual([]);
    expect(review.regionalAnnualChange).toBe(300);
    expect(() => reviewDraftBill([health, regional])).toThrow(/jurisdictions/);
  });

  it("rejects national bills without an owner and regional Cabinet wallets", () => {
    expect(() => reviewDraftBill([{ ...health, fundingOwnerId: null }])).toThrow();
    expect(() => reviewDraftBill([{ ...health, scope: "regional" }])).toThrow();
    expect(() => reviewDraftBill([health, health])).toThrow();
  });
});
