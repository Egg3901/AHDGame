import { describe, expect, it } from "vitest";

import {
  DE_BUNDESTAG_2027,
  JP_SANGIIN_2027,
  JP_SHUGIIN_2027,
  UK_COMMONS_2027,
} from "./worldSeats2027";

function total(rows: Array<{ seatsHeld?: number }>): number {
  return rows.reduce((sum, row) => sum + (row.seatsHeld ?? 1), 0);
}

describe("2027 modern legislature snapshots", () => {
  it("reproduces the 2024 UK Commons result", () => {
    expect(total(UK_COMMONS_2027)).toBe(650);
  });

  it("uses the game's 201-seat scale for the 2025 Bundestag", () => {
    expect(total(DE_BUNDESTAG_2027)).toBe(201);
  });

  it("reproduces the current Japanese chamber membership", () => {
    expect(total(JP_SHUGIIN_2027)).toBe(465);
    expect(total(JP_SANGIIN_2027)).toBe(247);
  });
});
