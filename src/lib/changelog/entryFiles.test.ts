import { describe, it, expect } from "vitest";
import {
  ENTRY_DIRS,
  checkEntryDir,
  duplicateStems,
  parseEntryStem,
  toEntrySuffix,
  devEntryFileName,
} from "./entryFiles";
import { loadDevPosts, loadPublicPosts } from "./posts";

describe("parseEntryStem", () => {
  it("accepts a bare version and a suffixed version", () => {
    expect(parseEntryStem("1.2.3")).toEqual({ version: "1.2.3", suffix: null });
    expect(parseEntryStem("1.2.3-union-dues")).toEqual({
      version: "1.2.3",
      suffix: "union-dues",
    });
  });

  it("rejects names that would not sort or link cleanly", () => {
    expect(parseEntryStem("1.2")).toBeNull();
    expect(parseEntryStem("1.2.3_union")).toBeNull();
    expect(parseEntryStem("1.2.3-Union")).toBeNull();
    expect(parseEntryStem("1.2.3-")).toBeNull();
  });
});

describe("toEntrySuffix", () => {
  it("normalizes free text to a slug", () => {
    expect(toEntrySuffix("Union dues v1 (#350)")).toBe("union-dues-v1-350");
    expect(devEntryFileName("1.2.3", "Union Dues")).toBe("1.2.3-union-dues.md");
  });
});

// The regression guard. A changelog entry names a slot in two places: its
// filename stem (the feed key and, for public entries, the URL) and its
// frontmatter version. This asserts no two entries claim the same slot and that
// no new entry is authored under the bare <version>.md name that made parallel
// branches collide in the first place.
describe("content/changelog entries", () => {
  for (const { dir, label, bareVersionOnly } of ENTRY_DIRS) {
    it(`${label}: every entry is well formed`, () => {
      expect(checkEntryDir(dir, { bareVersionOnly })).toEqual([]);
    });

    it(`${label}: no two entries share a slug`, () => {
      expect(duplicateStems(dir)).toEqual([]);
    });
  }

  it("public: one entry per released version", () => {
    const versions = loadPublicPosts().map((p) => p.version);
    expect(versions).toEqual([...new Set(versions)]);
  });

  it("loads every entry on disk", () => {
    expect(loadDevPosts().length).toBeGreaterThan(0);
    expect(loadPublicPosts().length).toBeGreaterThan(0);
  });

  it("orders entries deterministically", () => {
    const first = loadDevPosts().map((p) => p.slug);
    const second = loadDevPosts().map((p) => p.slug);
    expect(first).toEqual(second);
    expect(first).toEqual([...new Set(first)]);
  });
});
