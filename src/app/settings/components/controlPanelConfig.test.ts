import { describe, expect, it } from "vitest";
import enCatalog from "../../../../messages/en/settings.json";
import { ALL_SECTIONS, type SectionDef } from "./sectionsConfig";
import {
  CONTROL_PANEL_BUCKETS,
  bucketForSection,
  bucketQuickSettingsMatch,
  sectionMatchesQuery,
  type SettingsBucket,
} from "./controlPanelConfig";

/** Resolve a dotted message id against the "settings" namespace of the en catalog. */
function resolveMessage(key: string): string {
  let node: unknown = enCatalog.settings;
  for (const part of key.split(".")) {
    node = (node as Record<string, unknown>)[part];
  }
  expect(typeof node, `missing en message for key "${key}"`).toBe("string");
  return node as string;
}

const sectionText = (section: SectionDef) =>
  `${resolveMessage(section.labelKey)} ${resolveMessage(section.summaryKey)}`;
const bucketText = (bucket: SettingsBucket) =>
  `${resolveMessage(bucket.labelKey)} ${resolveMessage(bucket.summaryKey)}`;

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

  it("resolves a label and summary message key for every section and bucket", () => {
    for (const section of ALL_SECTIONS) {
      expect(sectionText(section).trim().length).toBeGreaterThan(0);
    }
    for (const bucket of CONTROL_PANEL_BUCKETS) {
      expect(bucketText(bucket).trim().length).toBeGreaterThan(0);
      expect(resolveMessage(bucket.eyebrowKey).length).toBeGreaterThan(0);
    }
  });

  it("searches labels, summaries, ids, and quick-setting aliases", () => {
    const danger = ALL_SECTIONS.find((section) => section.id === "danger");
    expect(danger && sectionMatchesQuery(danger, "delete", sectionText(danger))).toBe(true);
    // Localized label text ("Danger Zone") matches even though it only exists in the catalog.
    expect(danger && sectionMatchesQuery(danger, "danger zone", sectionText(danger))).toBe(true);
    expect(danger && sectionMatchesQuery(danger, "unrelated", sectionText(danger))).toBe(false);
    expect(
      bucketQuickSettingsMatch(
        CONTROL_PANEL_BUCKETS[1],
        "turn speed",
        bucketText(CONTROL_PANEL_BUCKETS[1])
      )
    ).toBe(true);
    expect(
      bucketQuickSettingsMatch(
        CONTROL_PANEL_BUCKETS[3],
        "volume",
        bucketText(CONTROL_PANEL_BUCKETS[3])
      )
    ).toBe(true);
    expect(
      bucketQuickSettingsMatch(
        CONTROL_PANEL_BUCKETS[4],
        "import",
        bucketText(CONTROL_PANEL_BUCKETS[4])
      )
    ).toBe(true);
    // Localized bucket summary text still matches ("Sign-in methods" is only in the catalog).
    expect(
      bucketQuickSettingsMatch(
        CONTROL_PANEL_BUCKETS[0],
        "sign-in methods",
        bucketText(CONTROL_PANEL_BUCKETS[0])
      )
    ).toBe(true);
  });
});
