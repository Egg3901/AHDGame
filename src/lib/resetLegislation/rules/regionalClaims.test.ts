import { describe, expect, it } from "vitest";
import type { ResetLawProgramDocument } from "../program";
import { buildResetRegionalProgramClaims } from "./regionalClaims";

describe("buildResetRegionalProgramClaims", () => {
  it("turns fixed regional allocations into cabinet-free settlement claims", () => {
    const program = {
      _id: "world:US:CA:L10",
      familyId: "L10",
      choice: "center_left",
      annualAgencyAllocation: 1_200_000_000,
    } as ResetLawProgramDocument;

    expect(
      buildResetRegionalProgramClaims({
        programs: [program],
        previousProgramIds: new Set([program._id]),
      })
    ).toEqual([
      {
        programId: program._id,
        legislationTypeId: "L10",
        policyOptionId: "center_left",
        authorizedCost: 1_200_000_000,
        obligationPriority: 5,
        fundingSemantics: "appropriation_included",
        continuing: true,
      },
    ]);
  });
});
