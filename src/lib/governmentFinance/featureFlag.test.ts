import { beforeEach, describe, expect, it, vi } from "vitest";

const findOne = vi.fn();

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(async () => ({
    collection: vi.fn(() => ({ findOne })),
  })),
}));

import {
  isDepartmentFinanceEnabledFromState,
  isDepartmentProgramSliceEnabled,
  isDepartmentProgramSliceEnabledFromState,
  isLawAdministrationEnabledFromState,
  isRegionalLegislationFinanceEnabledFromState,
} from "./featureFlag";

describe("department program slice feature flag", () => {
  beforeEach(() => findOne.mockReset());

  it("is fail-closed", () => {
    expect(isDepartmentProgramSliceEnabledFromState()).toBe(false);
    expect(isDepartmentProgramSliceEnabledFromState({ departmentProgramSliceEnabled: false })).toBe(
      false
    );
    expect(isDepartmentProgramSliceEnabledFromState({ departmentProgramSliceEnabled: true })).toBe(
      true
    );
    expect(isDepartmentProgramSliceEnabledFromState({ departmentFinanceEnabled: true })).toBe(true);
    expect(isDepartmentFinanceEnabledFromState({ departmentFinanceEnabled: true })).toBe(true);
    expect(isLawAdministrationEnabledFromState({ lawAdministrationEnabled: true })).toBe(true);
    expect(
      isRegionalLegislationFinanceEnabledFromState({ regionalLegislationFinanceEnabled: true })
    ).toBe(true);
  });

  it("uses a preloaded turn state without reading Mongo", async () => {
    expect(await isDepartmentProgramSliceEnabled({ departmentProgramSliceEnabled: true })).toBe(
      true
    );
    expect(findOne).not.toHaveBeenCalled();
  });

  it("projects only the flag when no state was preloaded", async () => {
    findOne.mockResolvedValue({ departmentProgramSliceEnabled: true });
    expect(await isDepartmentProgramSliceEnabled()).toBe(true);
    expect(findOne).toHaveBeenCalledWith(
      { _id: "current" },
      { projection: { departmentProgramSliceEnabled: 1, departmentFinanceEnabled: 1 } }
    );
  });
});
