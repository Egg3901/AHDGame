import { describe, it, expect } from "vitest";
import {
  regionalExecutiveSignForTenure,
  REGIONAL_EXEC_MODERATE_TURNS,
  REGIONAL_EXEC_STRONG_TURNS,
} from "./regionalExecutiveConstants";

describe("regionalExecutiveSignForTenure", () => {
  it("returns 1 (Light) for a freshly elected executive", () => {
    expect(regionalExecutiveSignForTenure(0)).toBe(1);
    expect(regionalExecutiveSignForTenure(REGIONAL_EXEC_MODERATE_TURNS - 1)).toBe(1);
  });

  it("returns 2 (Moderate) at the moderate threshold", () => {
    expect(regionalExecutiveSignForTenure(REGIONAL_EXEC_MODERATE_TURNS)).toBe(2);
    expect(regionalExecutiveSignForTenure(REGIONAL_EXEC_STRONG_TURNS - 1)).toBe(2);
  });

  it("returns 3 (Strong) at the strong threshold", () => {
    expect(regionalExecutiveSignForTenure(REGIONAL_EXEC_STRONG_TURNS)).toBe(3);
    expect(regionalExecutiveSignForTenure(99999)).toBe(3);
  });

  it("treats negative / NaN tenure as freshly elected", () => {
    expect(regionalExecutiveSignForTenure(-5)).toBe(1);
    expect(regionalExecutiveSignForTenure(Number.NaN)).toBe(1);
  });
});
