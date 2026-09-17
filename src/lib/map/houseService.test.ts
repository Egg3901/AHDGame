import { describe, expect, it } from "vitest";
import type { ElectedOfficial } from "@/lib/db/types";
import { buildHouseOrCommons } from "./houseService";

describe("buildHouseOrCommons", () => {
  it("renders a tied delegation as neutral instead of assigning an arbitrary leader", () => {
    const reps = [
      { state: "GA", party: "1", seatsHeld: 4 },
      { state: "GA", party: "2", seatsHeld: 4 },
    ] as ElectedOfficial[];

    const result = buildHouseOrCommons(
      reps,
      new Map([
        ["1", "#00f"],
        ["2", "#f00"],
      ]),
      new Map([
        ["1", "Democratic"],
        ["2", "Republican"],
      ])
    );

    expect(result.GA.leadingParty).toBe("");
    expect(result.GA.leadColor).toBe("#334155");
    expect(result.GA.tooltip[0]).toBe("Tied delegation: Democratic and Republican at 4 seats");
  });
});
