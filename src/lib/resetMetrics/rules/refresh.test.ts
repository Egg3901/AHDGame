import { describe, expect, it } from "vitest";
import { buildOpeningMetricSnapshots1991 } from "../seedOpening1991";
import { refreshResetMetricBoard } from "./refresh";

const board = buildOpeningMetricSnapshots1991("test-world", 1).find(
  (row) => row._id === "US:national"
)!;

describe("reset metric owner refresh", () => {
  it("marks an unrefreshed due owner as missing instead of silently treating opening data as live", () => {
    const result = refreshResetMetricBoard({
      board,
      turn: 2,
      updates: {},
      cohortDue: false,
      electionDue: false,
    });
    expect(result.dueIds).toEqual(["07", "09", "10"]);
    expect(result.missingDueIds).toEqual(result.dueIds);
    expect(result.board.asOfTurn).toBe(2);
    expect(result.board.observations).toEqual(board.observations);
  });

  it("accepts only the owning metric and exact next turn", () => {
    const price = board.observations["07"]!;
    const result = refreshResetMetricBoard({
      board,
      turn: 2,
      updates: { "07": { ...price, value: 4.5, source: "prices", status: "derived" } },
      cohortDue: false,
      electionDue: false,
    });
    expect(result.changedIds).toEqual(["07"]);
    expect(result.board.observations["07"]?.value).toBe(4.5);
    expect(result.missingDueIds).toEqual(["09", "10"]);
    expect(() =>
      refreshResetMetricBoard({
        board,
        turn: 3,
        updates: {},
        cohortDue: false,
        electionDue: false,
      })
    ).toThrow("exactly one turn");
    expect(() =>
      refreshResetMetricBoard({
        board,
        turn: 2,
        updates: { "07": { ...price, owner: "wrong" } },
        cohortDue: false,
        electionDue: false,
      })
    ).toThrow("owner update");
  });

  it("accepts exact same-turn replay but rejects a changed owner reading", () => {
    const updates = Object.fromEntries(
      ["07", "09", "10"].map((id) => [id, board.observations[id]!])
    );
    const first = refreshResetMetricBoard({
      board,
      turn: 2,
      updates,
      cohortDue: false,
      electionDue: false,
    });
    const replay = refreshResetMetricBoard({
      board: first.board,
      turn: 2,
      updates,
      cohortDue: false,
      electionDue: false,
    });
    expect(replay.replayed).toBe(true);
    expect(replay.board).toBe(first.board);
    expect(() =>
      refreshResetMetricBoard({
        board: first.board,
        turn: 2,
        updates: { ...updates, "07": { ...updates["07"]!, value: 12 } },
        cohortDue: false,
        electionDue: false,
      })
    ).toThrow("replay differs");
  });

  it("requires event-based owners only on their explicit events", () => {
    const regional = buildOpeningMetricSnapshots1991("test-world", 1).find(
      (row) => row._id === "US:PA"
    )!;
    const ordinary = refreshResetMetricBoard({
      board: regional,
      turn: 2,
      updates: {},
      cohortDue: false,
      electionDue: false,
    });
    expect(ordinary.dueIds).toEqual(["02"]);
    const event = refreshResetMetricBoard({
      board: regional,
      turn: 2,
      updates: {},
      cohortDue: true,
      electionDue: true,
    });
    expect(event.dueIds).toContain("51");
    expect(event.dueIds).toContain("11");
  });
});
