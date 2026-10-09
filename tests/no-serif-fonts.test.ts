import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/*
 * The modern interface is set in one sans family, with mono only for figures.
 * Classic mode deliberately restores the pre-October editorial serif faces.
 * Keep those references confined to the root font loader and the stylesheet
 * whose selectors are explicitly scoped to data-interface="classic".
 *
 * The class names are assembled from parts so that Tailwind's source scanner
 * does not find them in this file and generate the utilities for it.
 */

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const SCANNED = /\.(?:[cm]?[jt]sx?|css|scss|mdx?)$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const CLASSIC_ALLOWLIST = new Set(["src/app/interface-modes.css", "src/app/layout.tsx"]);

const FONT = "font";
const BANNED: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: `${FONT}-serif`, pattern: new RegExp(`${FONT}-serif`) },
  {
    // The class or the theme alias, but not the @font-face `font-display:` descriptor.
    label: `${FONT}-display`,
    pattern: new RegExp(`--${FONT}-display|${FONT}-display(?!\\s*:)`),
  },
  { label: "a serif face name", pattern: /\b(?:lora|fraunces|playfair)(?![a-z])/i },
];

function collect(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "node_modules") collect(full, acc);
    } else if (SCANNED.test(entry) && !TEST_FILE.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

describe("serif fonts stay confined to classic interface mode", () => {
  const files = collect(SRC).map((full) => ({
    full,
    rel: path.relative(ROOT, full).split(path.sep).join("/"),
  }));

  it("scans the source tree", () => {
    expect(files.length).toBeGreaterThan(1000);
  });

  it.each(BANNED)(
    "has no $label",
    ({ pattern }) => {
      const offenders = files
        .filter(
          ({ full, rel }) => !CLASSIC_ALLOWLIST.has(rel) && pattern.test(readFileSync(full, "utf8"))
        )
        .map(({ rel }) => rel);
      expect(offenders, `Found in:\n${offenders.join("\n")}`).toEqual([]);
    },
    60_000
  );

  it("scopes classic typography rules to the classic interface attribute", () => {
    const css = readFileSync(path.join(SRC, "app", "interface-modes.css"), "utf8");
    expect(css).toContain('[data-interface="classic"] :is(h1, .display-heading)');
    expect(css).toContain('[data-interface="classic"] .font-serif');
    expect(css).toContain('[data-interface="classic"] .font-display');
  });

  it("matches what it is meant to match", () => {
    const [serif, display, faces] = BANNED.map((b) => b.pattern);
    expect(serif.test(`<h2 className="${FONT}-serif text-lg">`)).toBe(true);
    expect(serif.test(`fontFamily: "var(--${FONT}-serif, Georgia)"`)).toBe(true);
    expect(display.test(`<h1 className="${FONT}-display">`)).toBe(true);
    expect(display.test(`--${FONT}-display: var(--x);`)).toBe(true);
    expect(display.test(`@font-face { ${FONT}-display: swap; }`)).toBe(false);
    expect(faces.test('import { Playfair_Display } from "next/font/google";')).toBe(true);
    expect(faces.test("var(--font-lora)")).toBe(true);
    expect(faces.test('{ "name": "Lorain" }')).toBe(false);
  });
});
