import { describe, expect, it } from "vitest";
import { buildOpeningDepartmentBoards1991 } from "./openingDepartmentBoards1991";
import { departmentOpeningBoardPayload } from "./rules/departmentBoard";

describe("1991 v2 department opening boards", () => {
  it("balances each country exactly against its operating claims", () => {
    const boards = buildOpeningDepartmentBoards1991("new-world", 1);
    expect(boards.map((board) => board.countryId)).toEqual(["US", "UK", "JP", "IE"]);
    expect(departmentOpeningBoardPayload(boards)).toContain("new-world");
    for (const board of boards) {
      expect(board.accounts.length).toBeGreaterThan(0);
      expect(
        board.accounts.reduce((total, account) => total + account.annualAllocation, 0) +
          board.continuityAmount
      ).toBeCloseTo(board.operating, 2);
    }
  });

  it("rejects a duplicate country and a hidden operating gap", () => {
    const boards = buildOpeningDepartmentBoards1991("new-world", 1);
    expect(() => departmentOpeningBoardPayload([...boards, boards[0]])).toThrow();
    expect(() =>
      departmentOpeningBoardPayload([
        { ...boards[0], operating: boards[0].operating + 100 },
        ...boards.slice(1),
      ])
    ).toThrow();
  });
});
