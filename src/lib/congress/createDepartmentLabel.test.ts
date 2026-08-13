/**
 * REGRESSION: a `create_department` provision must not render as a subsidy.
 *
 * `formatSubsidyProvisionLabel` and `describeSubsidyProvision` are the
 * documented CATCH-ALL for unrecognised provisions, so adding a new member to
 * `BillProvision` without a branch ahead of them routes it silently into the
 * subsidy formatter. When `CreateDepartmentProvision` landed, that is exactly
 * what happened: `tsc` caught it on two call sites, but had the union been
 * looser it would have shipped as a bill creating the Department of Education
 * described to players as a subsidy.
 */
import { describe, it, expect } from "vitest";
import { formatCreateDepartmentLabel } from "./billEnrichment";

describe("create_department provision label", () => {
  it("names the office rather than describing a subsidy", () => {
    const label = formatCreateDepartmentLabel({
      type: "create_department",
      positionId: "secretary_of_education",
    });
    expect(label.legislationTypeName).toBe("Executive Reorganization");
    expect(label.policyOptionName).toBe("Establish the office of Secretary of Education");
    expect(label.policyOptionName.toLowerCase()).not.toContain("subsid");
  });

  it("keeps lowercase joining words readable", () => {
    expect(
      formatCreateDepartmentLabel({
        type: "create_department",
        positionId: "secretary_of_health_and_human_services",
      }).policyOptionName
    ).toBe("Establish the office of Secretary of Health And Human Services");
  });

  it("survives a single-word seat id", () => {
    expect(
      formatCreateDepartmentLabel({ type: "create_department", positionId: "postmaster" })
        .policyOptionName
    ).toBe("Establish the office of Postmaster");
  });
});
