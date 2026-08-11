import { describe, expect, it } from "vitest";
import { ALL_SECTIONS } from "./sectionsConfig";
import {
  CONTROL_PANEL_BUCKETS,
  bucketForSection,
  bucketQuickSettingsMatch,
  sectionMatchesQuery,
} from "./controlPanelConfig";

describe("settings control-panel information architecture", () => {
  it("keeps the five requested buckets in a stable order", () => {
    expect(CONTROL_PANEL_BUCKETS.map((bucket) => bucket.id)).toEqual([
      "account",
      "game",
      "interface",
      "audio",
      "data",
    ]);
  });

  it("assigns every legacy settings section to exactly one bucket", () => {
    const assigned = CONTROL_PANEL_BUCKETS.flatMap((bucket) => bucket.sectionIds);
    expect(new Set(assigned).size).toBe(assigned.length);
    expect([...assigned].sort()).toEqual(ALL_SECTIONS.map((section) => section.id).sort());
    for (const section of ALL_SECTIONS) {
      expect(bucketForSection(section.id)).toBeDefined();
    }
  });

  it("searches labels, summaries, ids, and quick-setting aliases", () => {
    const danger = ALL_SECTIONS.find((section) => section.id === "danger");
    expect(danger && sectionMatchesQuery(danger, "delete")).toBe(true);
    expect(danger && sectionMatchesQuery(danger, "unrelated")).toBe(false);
    expect(bucketQuickSettingsMatch(CONTROL_PANEL_BUCKETS[1], "turn speed")).toBe(true);
    expect(bucketQuickSettingsMatch(CONTROL_PANEL_BUCKETS[3], "volume")).toBe(true);
    expect(bucketQuickSettingsMatch(CONTROL_PANEL_BUCKETS[4], "import")).toBe(true);
  });
});
