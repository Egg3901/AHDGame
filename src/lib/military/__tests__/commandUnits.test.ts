import { describe, expect, it } from "vitest";
import { reconcileCommandUnits } from "../rules/commandUnits";

describe("reconcileCommandUnits", () => {
  it("preserves valid assignments and metadata without mutating the input", () => {
    const clean = { id: "clean", unitIds: ["a"] };
    const stale = { id: "stale", unitIds: ["b", "gone", "c"], posture: "Deterrence" };
    const commands = [clean, stale];
    const result = reconcileCommandUnits(commands, ["a", "b", "c"]);
    expect(result).toEqual([clean, { ...stale, unitIds: ["b", "c"] }]);
    expect(result[0]).toBe(clean);
    expect(result[1]).not.toBe(stale);
    expect(stale.unitIds).toEqual(["b", "gone", "c"]);
  });
  it("preserves references when nothing needs reconciliation", () => {
    const commands = [{ unitIds: ["a"] }, { unitIds: [] }];
    expect(reconcileCommandUnits(commands, ["a", "unassigned"])).toBe(commands);
  });
  it("preserves empty commands when the country has no remaining units", () => {
    expect(reconcileCommandUnits([{ id: "command", unitIds: ["gone"] }], [])).toEqual([
      { id: "command", unitIds: [] },
    ]);
  });
});
