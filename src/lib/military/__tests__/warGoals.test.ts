import { describe, it, expect } from "vitest";
import { WAR_GOALS, isSelectableWarGoal, warGoalLabel } from "../warGoals";

describe("war goals", () => {
  it("reserves conquest — present in the catalog but not selectable", () => {
    const conquest = WAR_GOALS.find((g) => g.id === "conquest");
    expect(conquest).toBeTruthy();
    expect(conquest!.selectable).toBe(false);
  });

  it("offers the other three goals", () => {
    const selectable = WAR_GOALS.filter((g) => g.selectable).map((g) => g.id);
    expect([...selectable].sort()).toEqual(["liberation", "punitive", "regime_change"]);
  });

  it("isSelectableWarGoal rejects conquest and unknown ids", () => {
    // The picker and the server validator both read this, so a reserved goal cannot
    // be smuggled in by a hand-rolled API request.
    expect(isSelectableWarGoal("conquest")).toBe(false);
    expect(isSelectableWarGoal("annexation")).toBe(false);
    expect(isSelectableWarGoal("")).toBe(false);
    expect(isSelectableWarGoal("punitive")).toBe(true);
  });

  it("every goal carries a label and a blurb for the picker", () => {
    for (const g of WAR_GOALS) {
      expect(g.label.length).toBeGreaterThan(0);
      expect(g.blurb.length).toBeGreaterThan(0);
    }
  });

  it("says out loud that a reserved goal is unavailable", () => {
    const conquest = WAR_GOALS.find((g) => g.id === "conquest")!;
    expect(conquest.blurb).toMatch(/not yet available/i);
  });

  it("labels a goal for display, and falls back rather than rendering a raw id", () => {
    expect(warGoalLabel("punitive")).toBe("Punitive");
    // A conflict predating declarations has no goal; the record page must not print
    // "undefined" at a player.
    expect(warGoalLabel(undefined)).toBe("Undeclared");
  });

  it("has no duplicate ids", () => {
    const ids = WAR_GOALS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("declare_war is not a policy provision", () => {
  it("isPolicyProvision excludes it", async () => {
    // 40 call sites filter provisions with this guard. Without the exclusion a
    // declaration would be read as a policy provision and written into a policy
    // record — the same trap the union_law branch documents.
    const { isPolicyProvision } = await import("@/lib/db/types/legislation");
    const declaration = {
      type: "declare_war",
      targetCountry: "CN",
      warGoal: "punitive",
    } as never;
    expect(isPolicyProvision(declaration)).toBe(false);
  });
});
