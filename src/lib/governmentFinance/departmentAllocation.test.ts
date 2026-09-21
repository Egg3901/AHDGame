import { describe, expect, it } from "vitest";
import { validateDepartmentProgramAllocations } from "./departmentAllocation";

describe("department program allocations", () => {
  it("requires an exact active-program key set totaling 100 percent", () => {
    expect(validateDepartmentProgramAllocations(["a", "b"], { a: 70, b: 30 })).toEqual({
      ok: true,
    });
    expect(validateDepartmentProgramAllocations(["a", "b"], { a: 100 })).toMatchObject({
      ok: false,
    });
    expect(validateDepartmentProgramAllocations(["a", "b"], { a: 80, b: 30 })).toMatchObject({
      ok: false,
    });
  });

  it("rejects unknown programs and out-of-range shares", () => {
    expect(validateDepartmentProgramAllocations(["a"], { other: 100 })).toMatchObject({
      ok: false,
    });
    expect(validateDepartmentProgramAllocations(["a", "b"], { a: 101, b: -1 })).toMatchObject({
      ok: false,
    });
  });
});
