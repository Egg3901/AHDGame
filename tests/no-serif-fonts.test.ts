import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/*
 * The site is set in one sans family, with mono only for figures. The serif
 * faces (Lora, Fraunces, Playfair Display) are gone, and the font-serif and
 * font-display utilities no longer exist. Tailwind still ships its own default
 * serif stack, so a stray font-serif class would quietly render in Georgia, and
 * nothing else in the suite would notice. This guard keeps both the classes and
 * the face names out of src.
 *
 * The class names are assembled from parts so that Tailwind's source scanner
 * does not find them in this file and generate the utilities for it.
 */

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const SCANNED = /\.(?:[cm]?[jt]sx?|css|scss|mdx?)$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

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

describe("no serif fonts in src", () => {
  const files = collect(SRC).map((full) => ({
    full,
    rel: path.relative(ROOT, full).split(path.sep).join("/"),
  }));

  it("scans the source tree", () => {
    expect(files.length).toBeGreaterThan(1000);
  });

  it.each(BANNED)("has no $label", ({ pattern }) => {
    const offenders = files
      .filter(({ full }) => pattern.test(readFileSync(full, "utf8")))
      .map(({ rel }) => rel);
    expect(offenders, `Found in:\n${offenders.join("\n")}`).toEqual([]);
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
