import { describe, expect, it } from "vitest";
import { buildOpeningDepartmentBoards1991 } from "../../src/lib/resetFinance/openingDepartmentBoards1991";
import { runOpeningDepartment240 } from "./resetDepartmentOpening240";

describe("1991 opening department authority stress", () => {
  const boards = buildOpeningDepartmentBoards1991("test-world", 1);

  it.each(["US", "UK", "JP"] as const)("reconciles funded %s over 240 turns", (country) => {
    const source = boards.find((entry) => entry.countryId === country)!;
    const run = runOpeningDepartment240(country, "source_funded");
    expect(run.sourceAuthority).toBe(source.operating * 5);
    expect(run.continuityAuthority).toBeLessThanOrEqual(source.continuityAmount * 5);
    expect(
      run.departmentAuthority +
        run.specializedAuthority +
        run.grantReservation +
        run.continuityAuthority
    ).toBe(run.sourceAuthority);
    expect(run.departmentOutlay).toBe(run.departmentAuthority);
    expect(run.unmetProgramDemand).toBe(0);
    expect(run.newArrears).toBe(0);
    expect(run.overdraft).toBe(0);
    expect(run.largestAccountingResidual).toBe(0);
    expect(run.openingWorkingCapital).toBeGreaterThan(0);
    expect(run.closingWorkingCapital).toBe(run.openingWorkingCapital);
    expect(run.workingCapitalDrawn).toBe(0);
  });

  it.each(["US", "UK", "JP"] as const)(
    "lets %s draw its opening buffer under a five-year authority cut",
    (country) => {
      const run = runOpeningDepartment240(country, "authority_cut_20");
      expect(
        run.departmentAuthority +
          run.specializedAuthority +
          run.grantReservation +
          run.continuityAuthority
      ).toBeLessThan(run.sourceAuthority);
      expect(run.departmentOutlay).toBe(run.departmentAuthority + run.workingCapitalDrawn);
      expect(run.workingCapitalDrawn).toBeGreaterThan(0);
      expect(run.workingCapitalDrawn).toBeLessThanOrEqual(run.openingWorkingCapital);
      // Exhaust the buffer in every native currency while allowing integer
      // allocation dust after 240 turns, rather than imposing one nominal sum.
      expect(run.closingWorkingCapital / run.openingWorkingCapital).toBeLessThan(0.000001);
      expect(run.unmetProgramDemand).toBeGreaterThan(0);
      expect(run.newArrears).toBe(0);
      expect(run.overdraft).toBe(0);
      expect(run.largestAccountingResidual).toBe(0);
    }
  );
});
