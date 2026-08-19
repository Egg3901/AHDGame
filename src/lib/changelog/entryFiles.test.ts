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
  unknownValueMessage,
  BARE_NAME_CUTOFF_DATE,
} from "./entryFiles";
import { loadDevPosts, loadPublicPosts } from "./posts";
import { AREA_VALUES, BADGE_VALUES } from "./types";
import { AREA_STYLES, BADGE_STYLES } from "@/app/changelog/components/postStyles";

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

// Three separate authors wrote "minor", "bugfix", "balance" and "engine" into
// entries, and each one turned development red for everyone else. The
// vocabulary now lives in one place and every surface derives from it, so these
// assert the derivation actually holds rather than restating the lists.
describe("changelog vocabulary", () => {
  it("styles every badge and area, so no accepted value renders as an unstyled chip", () => {
    expect(Object.keys(BADGE_STYLES).sort()).toEqual([...BADGE_VALUES].sort());
    expect(Object.keys(AREA_STYLES).sort()).toEqual([...AREA_VALUES].sort());
    for (const style of [...Object.values(BADGE_STYLES), ...Object.values(AREA_STYLES)]) {
      expect(style.label).toBeTruthy();
      expect(style.classes).toBeTruthy();
    }
  });

  it("carries the values authors reached for", () => {
    expect(BADGE_VALUES).toContain("minor");
    expect(AREA_VALUES).toContain("engine");
  });

  it("names the valid values in the failure, not just the rejected one", () => {
    const message = unknownValueMessage("badge", "bugfix");
    expect(message).toContain('"bugfix"');
    for (const value of BADGE_VALUES) expect(message).toContain(value);
    expect(message).toContain("tags");

    const areaMessage = unknownValueMessage("area", "engine-room");
    for (const value of AREA_VALUES) expect(areaMessage).toContain(value);
  });

  // The generator now writes the accepted vocabulary as YAML comments above
  // each field, which is the whole point: the author reads it where they type.
  // Comments must survive the hand-written frontmatter parser untouched.
  it("parses an entry carrying the generator's vocabulary comments", () => {
    const generated = `---
version: "1.2.29"
date: 2026-08-19
title: A change
summary: >-
  Why it matters.
# Free text. What the change was about: economy, elections, balance.
tags: [economy]
# How big the release is. One of: ${BADGE_VALUES.join(" | ")}
badges: [minor]
# Which part of the codebase moved. Any of: ${AREA_VALUES.join(" | ")}
areas: [backend, engine]
---
Body
`;
    expect(frontmatterDamage(generated)).toEqual([]);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-generated-"));
    fs.writeFileSync(path.join(dir, "1.2.29-a-change.md"), generated);
    expect(checkEntryDir(dir, { bareVersionOnly: false })).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("rejects the exact values that broke the build, and accepts the extended ones", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-vocab-"));
    const write = (name: string, badges: string, areas: string) =>
      fs.writeFileSync(
        path.join(dir, name),
        `---\nversion: "1.2.3"\ndate: 2026-08-19\ntitle: T\nbadges: [${badges}]\nareas: [${areas}]\n---\nBody\n`
      );

    write("1.2.3-good.md", "minor", "backend, engine");
    expect(checkEntryDir(dir, { bareVersionOnly: false })).toEqual([]);

    fs.rmSync(path.join(dir, "1.2.3-good.md"));
    write("1.2.3-bad.md", "patch, bugfix, balance", "frontend, database");
    const problems = checkEntryDir(dir, { bareVersionOnly: false }).map((p) => p.problem);
    expect(problems).toHaveLength(3);
    expect(problems.join(" ")).toContain('"bugfix"');
    expect(problems.join(" ")).toContain('"balance"');
    expect(problems.join(" ")).toContain('"database"');

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
