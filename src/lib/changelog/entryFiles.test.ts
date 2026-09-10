import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect } from "vitest";
import {
  ENTRY_DIRS,
  checkEntryDir,
  duplicateStems,
  parseVersionStem,
  toEntrySuffix,
  unreleasedFileName,
  releaseEntryFileName,
  frontmatterDamage,
  unknownValueMessage,
} from "./entryFiles";
import { loadDevPosts, loadPublicPosts } from "./posts";
import { foldNotes, releaseBadge, releaseTags, sectionForNote } from "./releaseNotes";
import { RETIRED_PUBLIC_CHANGELOG_SLUGS } from "./retiredSlugs";
import { AREA_VALUES, BADGE_VALUES } from "./types";
import { AREA_STYLES, BADGE_STYLES } from "@/app/changelog/components/postStyles";

describe("parseVersionStem", () => {
  it("accepts a bare version", () => {
    expect(parseVersionStem("1.2.3")).toBe("1.2.3");
    expect(parseVersionStem("1.6.0")).toBe("1.6.0");
  });

  it("rejects the per-change name that used to mint a version per pull request", () => {
    expect(parseVersionStem("1.2.3-union-dues")).toBeNull();
    expect(parseVersionStem("1.2")).toBeNull();
    expect(parseVersionStem("1.2.3_union")).toBeNull();
    expect(parseVersionStem("union-dues")).toBeNull();
  });
});

describe("toEntrySuffix", () => {
  it("normalizes free text to a slug", () => {
    expect(toEntrySuffix("Union dues v1 (#350)")).toBe("union-dues-v1-350");
    expect(unreleasedFileName("Union Dues")).toBe("union-dues.md");
    expect(releaseEntryFileName("1.6.0")).toBe("1.6.0.md");
  });
});

// The regression guard. A release post's filename stem is its version and, for
// public entries, its published URL. An unreleased note has neither: it is
// named for its topic and carries no version, because only a release has one.
describe("content/changelog entries", () => {
  for (const { dir, label, kind } of ENTRY_DIRS) {
    it(`${label}: every entry is well formed`, () => {
      expect(checkEntryDir(dir, { kind })).toEqual([]);
    });

    it(`${label}: no two entries share a slug`, () => {
      expect(duplicateStems(dir)).toEqual([]);
    });
  }

  it("public: one entry per released version", () => {
    const versions = loadPublicPosts().map((p) => p.version);
    expect(versions).toEqual([...new Set(versions)]);
  });

  it("dev: one entry per released version", () => {
    const versions = loadDevPosts().map((p) => p.version);
    expect(versions).toEqual([...new Set(versions)]);
  });

  // The whole point of the consolidation. Two entries claiming the same version
  // is what let 193 posts pile up inside the 1.4 line.
  it("dev: every entry's slug is exactly its version", () => {
    for (const post of loadDevPosts()) expect(post.slug).toBe(post.version);
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

  // package.json drives the version badge in the navbar and the tag the release
  // workflow cuts, so a release post with no matching version means the site
  // claims a version that was never written up.
  it("the version in package.json has a dev release post", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8")) as {
      version: string;
    };
    expect(loadDevPosts().map((p) => p.version)).toContain(pkg.version);
  });
});

// /changelog/<slug> is a published address. The consolidation folded twenty
// patch posts into their releases, so every one of those addresses has to keep
// resolving to a post that exists.
describe("retired public changelog slugs", () => {
  const live = new Set(loadPublicPosts().map((p) => p.slug));

  it("redirects to a post that exists", () => {
    for (const target of Object.values(RETIRED_PUBLIC_CHANGELOG_SLUGS)) {
      expect(live.has(target)).toBe(true);
    }
  });

  it("never shadows a post that is still published", () => {
    for (const from of Object.keys(RETIRED_PUBLIC_CHANGELOG_SLUGS)) {
      expect(live.has(from)).toBe(false);
    }
  });
});

describe("unreleased notes", () => {
  const withDir = (fn: (dir: string) => void) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-unreleased-"));
    try {
      fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it("accepts a topic-named note with no version", () => {
    withDir((dir) => {
      fs.writeFileSync(
        path.join(dir, "union-dues.md"),
        `---\ndate: 2026-09-06\ntitle: Union dues\nbadges: [patch]\n---\nBody\n`
      );
      expect(checkEntryDir(dir, { kind: "unreleased" })).toEqual([]);
    });
  });

  it("rejects a note that picks its own version", () => {
    withDir((dir) => {
      fs.writeFileSync(
        path.join(dir, "union-dues.md"),
        `---\nversion: "1.6.1"\ndate: 2026-09-06\ntitle: Union dues\n---\nBody\n`
      );
      const problems = checkEntryDir(dir, { kind: "unreleased" });
      expect(problems).toHaveLength(1);
      expect(problems[0].problem).toContain("changelog:release");
    });
  });

  it("rejects a note named for a version", () => {
    withDir((dir) => {
      fs.writeFileSync(
        path.join(dir, "1.6.1.md"),
        `---\ndate: 2026-09-06\ntitle: Union dues\n---\nBody\n`
      );
      const problems = checkEntryDir(dir, { kind: "unreleased" });
      expect(problems.map((p) => p.problem).join(" ")).toContain("must not be named for a version");
    });
  });

  it("rejects a release entry that carries a topic suffix", () => {
    withDir((dir) => {
      fs.writeFileSync(
        path.join(dir, "1.6.1-union-dues.md"),
        `---\nversion: "1.6.1"\ndate: 2026-09-06\ntitle: Union dues\n---\nBody\n`
      );
      const problems = checkEntryDir(dir, { kind: "release" });
      expect(problems.map((p) => p.problem).join(" ")).toContain("unreleased");
    });
  });
});

describe("folding notes into a release", () => {
  const note = (over: Partial<Parameters<typeof sectionForNote>[0]> & Record<string, unknown>) =>
    ({
      topic: "t",
      title: "T",
      summary: "S",
      date: "2026-09-06",
      tags: [],
      badges: ["patch"],
      areas: [],
      ...over,
    }) as Parameters<typeof foldNotes>[0][number];

  it("routes a note to a section by the tags its author already wrote", () => {
    expect(sectionForNote({ tags: ["elections"] })).toBe("Elections and campaigns");
    expect(sectionForNote({ tags: ["bonds"] })).toBe("Economy and corporations");
    expect(sectionForNote({ tags: ["nothing-known"] })).toBe("Other changes");
  });

  it("puts the biggest change first and prints every note once", () => {
    const body = foldNotes(
      [
        note({ title: "Small fix", tags: ["economy"], badges: ["patch"] }),
        note({ title: "Big feature", tags: ["economy"], badges: ["major"] }),
        note({ title: "An election thing", tags: ["elections"], badges: ["minor"] }),
      ],
      "A lede."
    );
    expect(body).toContain("3 changes shipped");
    expect(body.indexOf("Big feature")).toBeLessThan(body.indexOf("Small fix"));
    expect(body).toContain("### Elections and campaigns");
    expect(body.match(/An election thing/g)).toHaveLength(1);
  });

  it("takes the largest badge and the tags that recur", () => {
    const notes = [
      note({ tags: ["economy", "bonds"], badges: ["patch"] }),
      note({ tags: ["economy"], badges: ["minor"] }),
    ];
    expect(releaseBadge(notes)).toBe("minor");
    expect(releaseTags(notes)).toEqual(["economy", "bonds"]);
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

  // The generator writes the accepted vocabulary as YAML comments above each
  // field, which is the whole point: the author reads it where they type.
  // Comments must survive the hand-written frontmatter parser untouched.
  it("parses a generated note carrying the vocabulary comments", () => {
    const generated = `---
date: 2026-09-06
title: A change
summary: >-
  Why it matters.
# Free text. What the change was about: economy, elections, balance.
tags: [economy]
# How big this change is, which sets how it is grouped in the release post.
# One of: ${BADGE_VALUES.join(" | ")}
badges: [minor]
# Which part of the codebase moved. Any of: ${AREA_VALUES.join(" | ")}
areas: [backend, engine]
---
Body
`;
    expect(frontmatterDamage(generated)).toEqual([]);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-generated-"));
    fs.writeFileSync(path.join(dir, "a-change.md"), generated);
    expect(checkEntryDir(dir, { kind: "unreleased" })).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("rejects the exact values that broke the build, and accepts the extended ones", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-vocab-"));
    const write = (name: string, badges: string, areas: string) =>
      fs.writeFileSync(
        path.join(dir, name),
        `---\ndate: 2026-08-19\ntitle: T\nbadges: [${badges}]\nareas: [${areas}]\n---\nBody\n`
      );

    write("good.md", "minor", "backend, engine");
    expect(checkEntryDir(dir, { kind: "unreleased" })).toEqual([]);

    fs.rmSync(path.join(dir, "good.md"));
    write("bad.md", "patch, bugfix, balance", "frontend, database");
    const problems = checkEntryDir(dir, { kind: "unreleased" }).map((p) => p.problem);
    expect(problems).toHaveLength(3);
    expect(problems.join(" ")).toContain('"bugfix"');
    expect(problems.join(" ")).toContain('"balance"');
    expect(problems.join(" ")).toContain('"database"');

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
