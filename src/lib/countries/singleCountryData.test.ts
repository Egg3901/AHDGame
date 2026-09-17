import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { ACKNOWLEDGED_OUTSIDE, CONVERTED } from "./singleCountryData";

/**
 * For every converted country, does every file holding that country's data
 * actually live in that country's folder?
 *
 * See `singleCountryData.ts` for why this exists rather than another coverage
 * roster. The short version: the roster checks that a file is CLASSIFIED as
 * needing to move, and three Japanese files sat classified `bucket: "D"` against
 * completed phases while never moving.
 *
 * ⚠ OWNING DATA IS DECLARING IT, NOT BRANCHING ON IT. `if (countryId === "US")`
 * makes a file country-AWARE; it does not make the file the United States'.
 * `granularElectorate.ts` mentions the US exactly twice and both are
 * comparisons -- it is engine code, and a guard demanding it move into `us/`
 * would be demanding the wrong thing. So comparisons are deliberately NOT
 * evidence of ownership. A `countryId:` field, a registry key or a `xx_` slug is.
 *
 * ⚠ A BARE TWO-LETTER STRING IS NOT A COUNTRY, AND THAT MATTERS HERE MORE THAN
 * ANYWHERE. US state abbreviations have the same shape as country ids: in
 * `seeds/reference/states.ts`, "CA" is California, "DE" is Delaware and "IN" is
 * Indiana -- not Canada, Germany and India. A detector that counted bare
 * two-letter literals would read the United States' own state table as a
 * twenty-four-country file and wave it through. Japan's prefectures are `jp_`
 * slugs, so no rule in this repo has previously had to survive that.
 */

const ROOTS = ["src", "scripts"];

/** A row declaring which country it belongs to. The strongest evidence there is. */
const COUNTRY_ID_FIELD = /countryId:\s*"([A-Z]{2})"/g;
/** A registry key: `US: {`, `"JP": [`. */
const REGISTRY_KEY = /(?:^|[{,[(])\s*"?([A-Z]{2})"?\s*:/gm;
/** `jp_ldp`, `us_democratic`, `uk_labour`. Unambiguous by construction. */
const SLUG = /"([a-z]{2})_[a-z0-9_]+"/g;

/** Every country id the game knows, so a match can be told from a state code. */
const COUNTRY_IDS = new Set(
  "US UK JP DE FR IT RU CN BR PL CS YU DD AT BG FI GR HU IE NG RO SE ES TR CA IN".split(" ")
);

/**
 * Directories where authored DATA lives. Content-based detection is limited to
 * these: elsewhere a lone `countryId: "US"` is far more likely to be a default
 * in engine code or a fixture than a country's data table.
 */
const DATA_DIRS = [
  "src/lib/seeds/",
  "src/lib/constants/",
  "src/lib/politicalLegislation/laws/",
  "src/lib/politicalMetrics/seeds/",
  "src/lib/npp/rosters/",
  "src/lib/demographics/",
  "src/lib/maps/",
  "src/lib/events/pree/handlers/",
  "src/lib/turn/",
];

/**
 * File-name tokens that name a country.
 *
 * ⚠ The two-letter English words are the danger: `us`, `it`, `in`, `de`, `at`,
 * `se`. `useElectionNight.ts` is not American and `items.ts` is not Italian, so
 * a short token only counts as a country when it OPENS the name (`usLaws`,
 * `jpRegions`) or is a whole path segment (`seeds/uk/`).
 */
const NAME_TOKENS: Readonly<Record<string, string>> = {
  jp: "JP",
  japan: "JP",
  us: "US",
  usa: "US",
  america: "US",
  uk: "UK",
  britain: "UK",
  de: "DE",
  germany: "DE",
  fr: "FR",
  france: "FR",
  it: "IT",
  italy: "IT",
  ru: "RU",
  russia: "RU",
  cn: "CN",
  china: "CN",
  br: "BR",
  brazil: "BR",
  pl: "PL",
  poland: "PL",
  ie: "IE",
  ireland: "IE",
};
const SHORT_AMBIGUOUS = new Set(["us", "it", "in", "de", "at", "se", "br", "fr", "pl", "ie", "cn"]);

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry).replace(/\\/g, "/");
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__snapshots__") continue;
      out = out.concat(walk(full));
      continue;
    }
    if (!/\.tsx?$/.test(full)) continue;
    if (/\.test\./.test(full) || full.includes("/debug/")) continue;
    out.push(full);
  }
  return out;
}

function nameCountry(path: string): string | null {
  for (const segment of path.split("/")) {
    const token = NAME_TOKENS[segment.toLowerCase()];
    if (token && segment.length <= 7) return token;
  }
  const stem = basename(path).replace(/\.tsx?$/, "");
  const tokens = stem
    .replace(/(?<=[a-z0-9])(?=[A-Z])/g, " ")
    .replace(/(?<=[A-Z])(?=[A-Z][a-z])/g, " ")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const country = NAME_TOKENS[token];
    if (!country) continue;
    // A short ambiguous token only names a country when it opens the name and
    // something follows it: `usLaws` yes, `us` alone or `focusMode` no.
    if (SHORT_AMBIGUOUS.has(token) && !(i === 0 && tokens.length > 1)) continue;
    return country;
  }
  return null;
}

/**
 * Strip comments before looking for evidence.
 *
 * ⚠ PROSE IS NOT DATA, AND THIS RULE HAS BEEN LEARNED REPEATEDLY IN THIS WORK.
 * `billLifecycle/types.ts` carries the comment "(JP: delete Shūgiin billWhips)",
 * and the registry-key pattern matched `JP:` inside it -- reading a shared,
 * country-agnostic type module as one of Japan's data files. The same mistake
 * appeared twice before: the D7 line-count instrument matched quoted object KEYS
 * as payload, and the coverage roster had to be taught that a script whose
 * comments discuss Japan is not a Japanese file. Each time the fix was to stop
 * reading comments, so this one strips them up front rather than excusing the
 * file that happened to trip it.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function declaredCountries(raw: string): Set<string> {
  const source = stripComments(raw);
  const found = new Set<string>();
  for (const [, cc] of source.matchAll(COUNTRY_ID_FIELD)) {
    if (COUNTRY_IDS.has(cc)) found.add(cc);
  }
  for (const [, cc] of source.matchAll(REGISTRY_KEY)) {
    if (COUNTRY_IDS.has(cc)) found.add(cc);
  }
  for (const [, cc] of source.matchAll(SLUG)) {
    if (COUNTRY_IDS.has(cc.toUpperCase())) found.add(cc.toUpperCase());
  }
  return found;
}

/**
 * Is this file nothing but a forwarder onto a country folder?
 *
 * ⚠️ SHIMS ARE RECOGNISED, NOT LISTED, AND THAT IS A SCALING DECISION. Japan
 * alone leaves twelve of them behind -- `constants/japan.ts`, the three cabinet
 * shims, the two election-config shims, two seed shims, and the three this
 * change adds. Writing them out by hand for twenty-four countries is roughly
 * 250 entries whose only content is "this is a shim", which is the artifact
 * `jpCoverage.ts` already demonstrated nobody maintains: two unrelated scripts
 * had to be hand-registered in it during this session before the suite would go
 * green.
 *
 * A shim is mechanically identifiable, so it is identified. The test is strict
 * on purpose: once comments are stripped, EVERY remaining statement must be an
 * `export * from` or a bare `import` pointing into `@/lib/countries/`. A file
 * that forwards and also declares something of its own is not a shim, it is a
 * file holding data next to a forwarder, and it must still be justified.
 */
function isCountryFolderShim(raw: string): boolean {
  const body = stripComments(raw).trim();
  if (!body) return false;
  const statements = body
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  if (statements.length === 0) return false;
  return statements.every((s) =>
    /^(?:export\s+\*\s+from|import)\s+["']@\/lib\/countries\/[^"']+["']$/.test(s)
  );
}

interface Owned {
  readonly file: string;
  readonly country: string;
  readonly by: "name" | "content";
  readonly lines: number;
}

let cached: Owned[] | null = null;

function singleCountryFiles(): Owned[] {
  if (cached) return cached;
  const out: Owned[] = [];
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      // ⚠ THE META-MODULES IN `src/lib/countries/` DESCRIBE THE RULE, THEY ARE NOT
      // DATA. `jpCoverage.ts` is a 1,140-line roster ABOUT Japan and names JP on
      // nearly every line; `contract.ts` and this module's own data list are the
      // same kind of thing. Only the per-country subdirectories hold facts.
      if (/^src\/lib\/countries\/[^/]+\.tsx?$/.test(file)) continue;
      const source = readFileSync(file, "utf8");
      // A forwarder holds no copy, so it is not the country's data by
      // definition -- it is the absence of a second one.
      if (isCountryFolderShim(source)) continue;
      const named = nameCountry(file);
      const declared = declaredCountries(source);
      let country: string | null = null;
      let by: "name" | "content" = "name";
      if (named && (declared.size === 0 || (declared.size === 1 && declared.has(named)))) {
        country = named;
      } else if (declared.size === 1 && DATA_DIRS.some((d) => file.startsWith(d))) {
        country = [...declared][0];
        by = "content";
      }
      if (country) out.push({ file, country, by, lines: source.split("\n").length });
    }
  }
  cached = out.sort((a, b) => a.file.localeCompare(b.file));
  return cached;
}

describe("single-country data lives in that country's folder", () => {
  /**
   * ⚠ THE ASSERTION THE COVERAGE ROSTER COULD NOT MAKE. It asked whether a file
   * was classified as needing to move. This asks whether it moved.
   */
  it.each(CONVERTED)("%s holds no data outside its folder", (country) => {
    const folder = `src/lib/countries/${country.toLowerCase()}/`;
    const excused = new Set(
      ACKNOWLEDGED_OUTSIDE.filter((e) => e.country === country).map((e) => e.file)
    );

    const stranded = singleCountryFiles()
      .filter((f) => f.country === country)
      .filter((f) => !f.file.startsWith(folder))
      .filter((f) => !excused.has(f.file));

    expect(
      stranded.map((f) => `${f.file} (${f.lines} lines, matched by ${f.by})`),
      `\n${stranded.length} file(s) hold ${country} data but do not live in ${folder}.\n` +
        `Relocate each into the folder with a re-export shim behind it, or add it to\n` +
        `ACKNOWLEDGED_OUTSIDE with a reason that is not "it would be awkward to move".\n`
    ).toEqual([]);
  });

  /** An excuse with no reasoning is how the roster's entries rotted. */
  it("gives every acknowledged file a real reason", () => {
    const thin = ACKNOWLEDGED_OUTSIDE.filter((e) => e.why.trim().length < 30);
    expect(
      thin.map((e) => e.file),
      "reasons must actually explain"
    ).toEqual([]);
  });

  /**
   * Keeps the list from rotting the way the roster did: an entry naming a file
   * that no longer holds that country's data is stale, and a stale excuse hides
   * the next real one.
   */
  it("acknowledges no file that has stopped holding that country's data", () => {
    const owned = new Map(singleCountryFiles().map((f) => [f.file, f.country]));
    const stale = ACKNOWLEDGED_OUTSIDE.filter((e) => owned.get(e.file) !== e.country);
    expect(
      stale.map((e) => `${e.file} (listed as ${e.country})`),
      "no longer single-country data; remove the entry"
    ).toEqual([]);
  });

  /**
   * Not an assertion -- a report. The unconverted countries are a backlog, not a
   * failure, and a backlog nobody can see is one nobody schedules.
   */
  it("reports the backlog for countries not yet converted", () => {
    const byCountry = new Map<string, { files: number; lines: number }>();
    for (const f of singleCountryFiles()) {
      if (CONVERTED.includes(f.country)) continue;
      const row = byCountry.get(f.country) ?? { files: 0, lines: 0 };
      row.files++;
      row.lines += f.lines;
      byCountry.set(f.country, row);
    }
    const ranked = [...byCountry].sort((a, b) => b[1].lines - a[1].lines);
    const total = ranked.reduce((sum, [, r]) => sum + r.lines, 0);
    console.log(
      `\ncountry folders remaining: ${ranked.length} countries, ${total} lines of single-country data\n` +
        ranked
          .map(
            ([cc, r]) =>
              `  ${cc.padEnd(3)} ${String(r.files).padStart(3)} files ${String(r.lines).padStart(6)} lines`
          )
          .join("\n")
    );
    expect(ranked.length).toBeGreaterThan(0);
  });
});
