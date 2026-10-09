import { describe, expect, it } from "vitest";
import { snakeCandidates, snakeOrder } from "./CollegeSnake";
import type { PresMapModel, PresMapState } from "./presMapModel";

function st(id: string, ev: number, leaderId: string, margin: number): PresMapState {
  return {
    id,
    name: id,
    ev,
    leaderId,
    leaderName: leaderId,
    leaderColor: leaderId === "a" ? "#00f" : "#f00",
    margin,
    tier: "safe",
    fill: "#888",
    ink: "#fff",
    shares: [],
    totalVotes: 0,
    trend: {
      status: "none",
      candidateId: null,
      name: null,
      color: null,
      shiftPp: 0,
      windowTurns: 0,
      series: [],
    },
    sinceTurn: null,
    turnsAgo: null,
  };
}

const model: PresMapModel = {
  states: {
    CA: st("CA", 54, "a", 30),
    PA: st("PA", 19, "a", 1),
    WI: st("WI", 10, "b", 0.5),
    TX: st("TX", 40, "b", 15),
  },
  candidates: {
    a: { id: "a", name: "A", color: "#00f" },
    b: { id: "b", name: "B", color: "#f00" },
  },
  legendCandidates: [],
};

describe("college snake", () => {
  it("puts the two biggest electoral-vote winners at the ends", () => {
    const pair = snakeCandidates(model);
    expect(pair?.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("runs from the left candidate's safest state to the right's", () => {
    expect(snakeOrder(model, "a", "b").map((x) => x.state.id)).toEqual(["CA", "PA", "WI", "TX"]);
  });
});
