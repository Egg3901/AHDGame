import { describe, expect, it } from "vitest";
import { resolveSimPreset } from "./simPreset";

describe("resolveSimPreset", () => {
  it.each([
    ["1953", "1953-default"],
    ["1979", "1979-default"],
    ["1991", "1991-default"],
    ["2019", "2019-default"],
  ])("normalizes a bare era before a sim job is queued or claimed", (input, expected) => {
    expect(resolveSimPreset(input)).toBe(expected);
  });

  it("preserves an already canonical shipping preset", () => {
    expect(resolveSimPreset("2027-default")).toBe("2027-default");
  });

  it("rejects a preset that has no world entity manifest", () => {
    expect(() => resolveSimPreset("1965")).toThrow(
      'Unsupported simulation preset "1965". Expected one of:'
    );
  });
});
