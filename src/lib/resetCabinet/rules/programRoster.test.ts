import { describe, expect, it } from "vitest";
import type { ResetDepartmentAccountSnapshot } from "@/lib/resetFinance/rules/liveDepartmentAccount";
import {
  activeDepartmentProgramFamilyIds,
  activeDepartmentProgramFundingControl,
} from "./programRoster";

const account = {
  _id: "US:us_treasury_department",
  countryId: "US",
  familyAnnualDemand: { L01: 0, L08: 100, L50: 0 },
} as unknown as ResetDepartmentAccountSnapshot;

describe("v2 department program roster", () => {
  it("keeps opening law families even when they have no separate appropriation", () => {
    expect(activeDepartmentProgramFamilyIds(account, [])).toEqual(["L01", "L08", "L50"]);
  });

  it("removes regionalized families and follows a replacement's funding account", () => {
    expect(
      activeDepartmentProgramFamilyIds(account, [
        {
          country: "US",
          scope: "national",
          familyId: "L01",
          choice: "leave_to_states",
          fundingAccountId: account._id,
        },
        {
          country: "US",
          scope: "national",
          familyId: "L50",
          choice: "center_left",
          fundingAccountId: "US:us_justice_department",
        },
      ])
    ).toEqual(["L08"]);
  });

  it("adds a replacement newly assigned to this department", () => {
    expect(
      activeDepartmentProgramFamilyIds(account, [
        {
          country: "US",
          scope: "national",
          familyId: "L03",
          choice: "center_right",
          fundingAccountId: account._id,
        },
      ])
    ).toEqual(["L01", "L03", "L08", "L50"]);
  });

  it("uses the opening-country audit until an enacted option replaces it", () => {
    expect(activeDepartmentProgramFundingControl(account, "L08", [])).toBe("required");
    expect(activeDepartmentProgramFundingControl(account, "L01", [])).toBe(
      "no_separate_allocation"
    );
    expect(
      activeDepartmentProgramFundingControl(account, "L08", [
        {
          country: "US",
          scope: "national",
          familyId: "L08",
          choice: "center_right",
          fundingAccountId: account._id,
        },
      ])
    ).toBe("required");
  });
});
