import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COUNTRY_ORDER } from "@/lib/constants/countries";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import { GAME_VERSION } from "./marketedWorld";

/**
 * THE REGRESSION THIS TEST EXISTS FOR.
 *
 * On 2026-09-06 five public surfaces disagreed about what this game is. The FAQ
 * said four playable countries, the about page said three and named Japan, the
 * README said twenty-four, the studio site said twenty-one, and the landing
 * promo pill advertised v1.0.0 while 1.6.0 was in production. Every one of them
 * had been correct when it was written. They rotted because each was a separate
 * hand-typed literal that nobody had a reason to revisit.
 *
 * `marketedWorld` fixed the resolution. This file fixes the discipline: it fails
 * the build when a marketing surface starts hardcoding again. If you are here
 * because this test is red, do not add your string to the allow-list — read the
 * value out of `marketedWorld` instead.
 */

const REPO_ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

/** Copy that is allowed to name a country, because the country IS the subject. */
const SURFACES_THAT_MUST_NOT_NAME_COUNTRIES = [
  "src/app/faq/page.tsx",
  "src/app/about/page.tsx",
  "src/app/layout.tsx",
  "src/lib/siteMetadata.ts",
];

/**
 * The names that have actually been printed wrong on a public page. Not every
 * country: a page may legitimately mention Ireland in a sentence about the euro.
 * These four are the ones that were sold as playable when they were not.
 */
const CLOSED_COUNTRY_NAMES = ["Japan", "West Germany", "Soviet Union", "East Germany"];

describe("public copy stays derived", () => {
  it.each(SURFACES_THAT_MUST_NOT_NAME_COUNTRIES)(
    "%s does not hardcode a playable country name",
    (rel) => {
      const source = read(rel);
      // Strip comments: the explanation of WHY a name must not appear here is
      // allowed to contain the name.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const name of CLOSED_COUNTRY_NAMES) {
        expect(code, `${rel} names ${name} in a literal; read it from marketedWorld`).not.toContain(
          name
        );
      }
    }
  );

  it("no public message string hardcodes a version number", () => {
    for (const locale of ["en", "de"]) {
      const messages = read(`messages/${locale}/auth.json`);
      expect(messages, `messages/${locale}/auth.json`).not.toMatch(/v\d+\.\d+\.\d+/);
    }
  });

  it("the landing promo pill interpolates version and year", () => {
    for (const locale of ["en", "de"]) {
      const messages = JSON.parse(read(`messages/${locale}/auth.json`));
      const pill: string = messages.auth.landing.promoPill;
      expect(pill, `messages/${locale}`).toContain("{version}");
      expect(pill, `messages/${locale}`).toContain("{year}");
    }
  });

  it("era world copy templates the playable count instead of spelling it", () => {
    const eraThemes = read("src/components/landing/eraThemes.ts");
    const deks = [...eraThemes.matchAll(/worldSectionDek:\s*\n?\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(deks.length).toBeGreaterThan(0);
    for (const dek of deks) {
      expect(dek, dek).toContain("{playableCount}");
      expect(dek, dek).not.toMatch(/\b(One|Two|Three|Four|Five|Six) (nations )?are open\b/);
    }
  });

  it("the README's registered-country count matches the registry", () => {
    const readme = read("README.md");
    const match = readme.match(/(\d+) registered countries/);
    expect(match, "README no longer states a registered-country count").not.toBeNull();
    expect(Number(match![1])).toBe(COUNTRY_ORDER.length);
  });

  it("the README does not confuse registered countries with playable ones", () => {
    const readme = read("README.md");
    expect(readme).not.toMatch(/\d+ playable countries/);
  });

  it("the FAQ's sector count matches the sector registry", () => {
    const faq = read("src/app/faq/page.tsx");
    expect(faq).toContain("${CORPORATION_TYPES.length} sectors");
    expect(faq).not.toMatch(/\b\d+ sectors\b/);
    // Guards the interpolation above against a registry that shrank to nothing.
    expect(CORPORATION_TYPES.length).toBeGreaterThan(1);
  });

  it("package.json is the only place the release version is written", () => {
    // GAME_VERSION is re-exported, not re-typed. If someone pins a literal here
    // the whole scheme is back to hand-maintained strings.
    const source = read("src/lib/marketing/marketedWorld.ts");
    expect(source).toContain("pkg.version");
    expect(source.replace(/"1953"|"1979"|"1991"|"1999"|"2007"|"2019"|"2023"/g, "")).not.toMatch(
      /["'`]\d+\.\d+\.\d+["'`]/
    );
    expect(GAME_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
