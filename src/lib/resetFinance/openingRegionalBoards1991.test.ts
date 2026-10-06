import { describe, expect, it } from "vitest";
import { buildOpeningRegionalBoards1991 } from "./openingRegionalBoards1991";
import { regionalOpeningBoardPayload } from "./rules/regionalOpeningBoard";

describe("provisional 1991 regional fiscal boards", () => {
  it("covers all 79 regions and balances each opening envelope", () => {
    const boards = buildOpeningRegionalBoards1991("new-world", 1);
    expect(boards).toHaveLength(79);
    expect(boards.filter((board) => board.countryId === "US")).toHaveLength(51);
    expect(boards.filter((board) => board.countryId === "UK")).toHaveLength(12);
    expect(boards.filter((board) => board.countryId === "JP")).toHaveLength(8);
    expect(boards.filter((board) => board.countryId === "IE")).toHaveLength(8);
    expect(regionalOpeningBoardPayload(boards)).toContain("proportional-source-pool");
    for (const board of boards) {
      expect(board.familyOwned + board.otherExistingServices).toBeCloseTo(board.annualSpending, 2);
      expect(board.estimateKind).toBe("proportional-source-pool");
    }
  });

  it("rejects a duplicate region or an overdrawn region", () => {
    const boards = buildOpeningRegionalBoards1991("new-world", 1);
    expect(() => regionalOpeningBoardPayload([...boards.slice(1), boards[1]])).toThrow();
    expect(() =>
      regionalOpeningBoardPayload([
        { ...boards[0], otherExistingServices: boards[0].otherExistingServices + 100 },
        ...boards.slice(1),
      ])
    ).toThrow();
  });
});
