import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect } from "vitest";
import {
  ENTRY_DIRS,
  checkEntryDir,
  duplicateStems,
  parseEntryStem,
  toEntrySuffix,
  devEntryFileName,
  frontmatterDamage,
  BARE_NAME_CUTOFF_DATE,
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

describe("frontmatterDamage", () => {
  const good = `---
version: "1.2.3"
summary: >-
  Indented continuation.
---
Body
`;

  it("passes a well formed entry", () => {
    expect(frontmatterDamage(good)).toEqual([]);
  });

  it("catches the signature a conflict-resolution script left on 1.2.4 and 1.2.8", () => {
    const blankLine = `---

version: "1.2.3"
---
Body
`;
    expect(frontmatterDamage(blankLine)).toContain(
      "blank line directly after the opening --- delimiter"
    );

    const unclosed = `---
version: "1.2.3"
summary: >-
Not indented, so the block never ends.
`;
    const damage = frontmatterDamage(unclosed);
    expect(damage).toContain("frontmatter is never closed by a second --- delimiter");

    const unindented = `---
version: "1.2.3"
summary: >-
Not indented.
---
Body
`;
    expect(frontmatterDamage(unindented).join(" ")).toContain("unindented content");
  });
});

describe("bare dev entry names", () => {
  it("accepts entries authored on or before the cutoff and rejects later ones", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-guard-"));
    const write = (name: string, date: string) =>
      fs.writeFileSync(
        path.join(dir, name),
        `---\nversion: "${name.slice(0, 6)}"\ndate: ${date}\ntitle: T\n---\nBody\n`
      );

    write("1.2.16.md", BARE_NAME_CUTOFF_DATE);
    expect(checkEntryDir(dir, { bareVersionOnly: false })).toEqual([]);

    write("1.2.17.md", "2026-09-01");
    const problems = checkEntryDir(dir, { bareVersionOnly: false });
    expect(problems).toHaveLength(1);
    expect(problems[0].file).toBe("1.2.17.md");
    expect(problems[0].problem).toContain("<version>-<topic>.md");

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
