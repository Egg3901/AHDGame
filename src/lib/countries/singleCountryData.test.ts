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

/**
 * A DECLARATION named for a country: `export const JP_SHUGIIN_SEATS = ...`.
 *
 * ⚠️ THIS RULE WAS DROPPED FROM THE OLD ROSTER WHEN THIS GUARD REPLACED IT, AND
 * ITS ABSENCE IMMEDIATELY CAUSED THE FAILURE IT EXISTED TO PREVENT.
 *
 * `constants/states.ts` is 955 lines of seat tables for SEVEN countries --
 * `JP_SHUGIIN_SEATS`, `JP_SANGIIN_SEATS`, `JP_GOVERNOR_SEATS`,
 * `UK_COMMONS_SEATS`, `CN_NPC_SEATS`, `DE_WAHLKREIS_SEATS`,
 * `NG_REGIONAL_COUNCIL_SEATS`, `RU_REGION_NAMES` -- and not one of those
 * countries appears as a key, a `countryId:` field or a slug anywhere in it.
 * They exist only in SYMBOL NAMES. With 48 US state keys and no other country
 * visible, the state-key rule claimed the whole file for the United States, and
 * relocating it would have carried six other countries' canonical chamber seat
 * counts into `us/`.
 *
 * The retired `jpCoverage.test.ts` carried this as "rule 5", added because the
 * same file had already slipped past four other heuristics; its comment records
 * that this was "the third recurrence of the same failure". Rebuilding the
 * detector without it made that the fourth.
 *
 * CONSUMERS ARE DELIBERATELY NOT MATCHED -- only declarations. A file that
 * merely imports `JP_SANGIIN_SEATS` needs its import path updated and typecheck
 * says so loudly; a file that DECLARES it gets no such warning.
 */
const COUNTRY_DECLARATION =
  /\b(?:export\s+)?(?:const|let|var|function|class|type|interface|enum)\s+([A-Z]{2})_[A-Z0-9_]/g;

/**
 * Prefixes that look like a country id and are not one.
 *
 * ⚠️ USSR IS RUSSIA. It is the only entry here that names a real country, so
 * matching it would file another country's data under the United States rather
 * than merely adding noise. JPY is a currency, JPEG and JPG are image formats,
 * USD is a currency, and matching those pulled 130-plus irrelevant files into
 * Japan's coverage set when the old rule was first written.
 */
const NOT_A_COUNTRY_PREFIX = /^(JPY|JPEG|JPG|USD|USE|USSR)([_A-Z]|$)/;

/** Every country id the game knows, so a match can be told from a state code. */
const COUNTRY_IDS = new Set(
  "US UK JP DE FR IT RU CN BR PL CS YU DD AT BG FI GR HU IE NG RO SE ES TR CA IN".split(" ")
);

/**
 * US state and territory codes.
 *
 * ⚠️ THREE OF THESE ARE ALSO COUNTRY IDS: CA (California / Canada), DE
 * (Delaware / Germany) and IN (Indiana / India). A file keyed by state code
 * therefore looks, to a rule that reads `XX:` as a country key, like a file
 * about four countries at once -- which is not single-country, so it is not
 * flagged at all.
 *
 * That is not hypothetical. It is how `seeds/reference/stateMetrics2027.ts` and
 * its seven era siblings -- about 5,900 lines of pure US data, keyed `AL:`,
 * `AK:`, `AZ:`, `CA:`, `DE:`, `IN:` -- sat INVISIBLE to the first version of
 * this guard. The header warned about exactly this collision and the rule still
 * had the hole, because the warning was written about bare two-letter STRINGS
 * and the leak was in two-letter KEYS.
 */
const US_STATE_CODES = new Set(
  (
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO " +
    "MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI AS MP"
  ).split(" ")
);

/** The three codes that are both: California/Canada, Delaware/Germany, Indiana/India. */
const AMBIGUOUS = new Set([...COUNTRY_IDS].filter((c) => US_STATE_CODES.has(c)));

/**
 * Does this file key things by US state?
 *
 * Evidence is the codes that can only be states -- AL, AK, AZ, TX, FL. One of
 * those means state keys are in play somewhere in the file.
 *
 * ⚠️ THIS DELIBERATELY DOES NOT DECIDE THE WHOLE FILE, because a file can key by
 * both. `STATE_ADJACENCY` is `Record<CountryId, AdjacencyMap>`: 23 country keys
 * at the top level, 48 state keys nested under the US one. `sectorSeedWeights`
 * is the same shape. A file-level majority vote calls those state-keyed, since
 * 48 beats 23, and then throws away 23 genuine country keys -- which would make
 * a multi-country registry look like it declares no country at all, and a guard
 * that stops seeing countries stops flagging anything.
 *
 * So only the AMBIGUOUS codes are discounted. An unambiguous country key (JP,
 * UK, FR, RU) is always a country no matter what else the file contains, and
 * `countryId:` fields and `xx_` slugs are never in doubt either way.
 */
function countUsStateKeys(keys: Set<string>): number {
  let n = 0;
  for (const key of keys) {
    if (US_STATE_CODES.has(key) && !COUNTRY_IDS.has(key)) n++;
  }
  return n;
}

function hasUsStateKeys(keys: Set<string>): boolean {
  return countUsStateKeys(keys) > 0;
}

/**
 * How many unambiguous state codes make a file a US STATE TABLE.
 *
 * ⚠️ A HANDFUL OF THEM PROVES NOTHING, BECAUSE ISO COUNTRY CODES COLLIDE WITH US
 * STATE CODES TOO. `constants/alignmentRoster.ts` is the 233-entity world
 * alignment table, and it carries `MA: 1956`, `TN: 1956`, `GA: 1960`,
 * `MT: 1964` -- UN accession years for Morocco, Tunisia, Georgia and Malta, not
 * Massachusetts, Tennessee, Georgia and Montana. Claiming a 2,002-line world
 * table as United States data would have been a far worse error than the gap
 * this rule closes.
 *
 * Measured, that file has 8 colliding codes; a genuine US table has 48 or more,
 * because it enumerates every state. The threshold sits between them with room
 * on both sides, and the count is of state-ONLY codes so CA/DE/IN never inflate
 * it.
 */
const US_STATE_TABLE_MIN_KEYS = 20;

/**
 * ⚠️ US STATE KEYS ARE POSITIVE EVIDENCE OF US OWNERSHIP, NOT JUST A REASON TO
 * DISCOUNT CA/DE/IN.
 *
 * `seeds/reference/stateMetrics.ts` is 724 lines of US data with a generic name,
 * keyed purely by state code, and containing the string "US" exactly nowhere --
 * no `countryId:` field, no country key, no slug. Nothing identified it, so it
 * was invisible to every rule above. `stateMetrics1991.ts`, `stateBaselines*.ts`
 * and `stateMetricsEra1953.ts` are the same. That is not a detector bug so much
 * as the file genuinely not saying what it is.
 *
 * But the KEYS say it. Checked against every country's region ids in
 * `STATE_ADJACENCY`, the United States is the only one using bare two-letter
 * codes that are US state abbreviations. Everyone else uses three or more
 * letters (UK `LON`/`SEE`, IE `DUB`, BR `NORTE`, RU `CEN`) or a country prefix
 * (`PL_MAZ`, `FR_IDF`, `HU_BUD`), and the two-letter sets that do exist --
 * Germany's `SH`/`HH`/`NI`/`MV`/`BB` and East Germany's `MV`/`BB`/`ST`/`SN`/`TH`
 * -- collide with no US state code at all.
 *
 * So `AL:`/`AK:`/`AZ:` in a data file means the United States. A file that also
 * declares other countries is still multi-country: `STATE_ADJACENCY` and
 * `sectorSeedWeights` nest state keys under a US country key and keep their 23.
 */
function ownedByStateKeys(keys: Set<string>, declared: Set<string>): boolean {
  return declared.size === 0 && countUsStateKeys(keys) >= US_STATE_TABLE_MIN_KEYS;
}

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
  // ⚠️ In a file that keys by US state, `CA:` is California and `DE:` is
  // Delaware. Counting them as Canada and Germany makes a pure US data file look
  // like a four-country one, so it stops being single-country and is never
  // flagged -- which is how 5,900 lines of stateMetrics went unseen. Only the
  // three ambiguous codes are discounted, and only when the file demonstrably
  // uses state keys; an unambiguous country key still counts.
  const keys = new Set([...source.matchAll(REGISTRY_KEY)].map(([, cc]) => cc));
  const stateKeyed = hasUsStateKeys(keys);
  for (const cc of keys) {
    if (!COUNTRY_IDS.has(cc)) continue;
    if (stateKeyed && AMBIGUOUS.has(cc)) continue;
    found.add(cc);
  }
  for (const [, cc] of source.matchAll(SLUG)) {
    if (COUNTRY_IDS.has(cc.toUpperCase())) found.add(cc.toUpperCase());
  }
  // A symbol NAMED for a country is that country's data, wherever it sits.
  for (const match of source.matchAll(COUNTRY_DECLARATION)) {
    const cc = match[1];
    if (!COUNTRY_IDS.has(cc)) continue;
    if (NOT_A_COUNTRY_PREFIX.test(match[0].slice(match[0].indexOf(cc)))) continue;
    found.add(cc);
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
      const keys = new Set([...stripComments(source).matchAll(REGISTRY_KEY)].map(([, cc]) => cc));
      const inDataDir = DATA_DIRS.some((d) => file.startsWith(d));
      let country: string | null = null;
      let by: "name" | "content" = "name";
      if (named && (declared.size === 0 || (declared.size === 1 && declared.has(named)))) {
        country = named;
      } else if (declared.size === 1 && inDataDir) {
        country = [...declared][0];
        by = "content";
      } else if (inDataDir && ownedByStateKeys(keys, declared)) {
        // Keyed by US state and saying nothing else about itself. See
        // `ownedByStateKeys`: 724-line `stateMetrics.ts` contains the string
        // "US" nowhere at all, and only its keys give it away.
        country = "US";
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
   *
   * ⚠️ IT COUNTS ONLY WHAT IS STILL OUTSIDE THE FOLDER. The first version counted
   * every single-country file, including the ones already relocated, so moving
   * 42 files and 30,315 lines of United States data into `us/` left the number
   * completely unchanged. A progress metric that cannot move is worse than none:
   * it invites the reading that the work did nothing.
   *
   * This is the same mistake the plan already recorded once, in a different
   * shape. Japan's file COUNT went 120 -> 121 across the whole conversion,
   * because the registries keep their keys and gain forwarders; only literal
   * lines outside the folder ever moved (1,191 -> 10). Both times the fix was to
   * measure what is still in the wrong place, not what exists.
   */
  it("reports the backlog for countries not yet converted", () => {
    const byCountry = new Map<string, { files: number; lines: number }>();
    for (const f of singleCountryFiles()) {
      if (CONVERTED.includes(f.country)) continue;
      // Already in its own folder: relocated, not outstanding.
      if (f.file.startsWith(`src/lib/countries/${f.country.toLowerCase()}/`)) continue;
      const row = byCountry.get(f.country) ?? { files: 0, lines: 0 };
      row.files++;
      row.lines += f.lines;
      byCountry.set(f.country, row);
    }
    const ranked = [...byCountry].sort((a, b) => b[1].lines - a[1].lines);
    const total = ranked.reduce((sum, [, r]) => sum + r.lines, 0);
    console.log(
      `\nstill outside a country folder: ${ranked.length} countries, ${total} lines\n` +
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
