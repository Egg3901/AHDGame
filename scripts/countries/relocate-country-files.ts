/**
 * Moves every file that holds one country's data into that country's folder,
 * leaving a forwarder behind so no importer has to change.
 *
 *   npx tsx scripts/countries/relocate-country-files.ts DE --dry
 *   npx tsx scripts/countries/relocate-country-files.ts DE
 *
 * ⚠ THE SET COMES FROM THE GUARD, NOT FROM A LIST HERE. `singleCountryFiles()`
 * is the same classifier `singleCountryData.test.ts` fails CI with. A second
 * list would drift from it, and drift in this exact place is what retired the
 * coverage roster: three Japanese files sat classified as needing to move,
 * against completed phases, and never moved.
 *
 * ⚠ A FORWARDER HOLDS NO COPY. The old path becomes `export * from "<new>"`, so
 * there is one declaration and every existing import keeps working. Two things
 * that looks like but is not:
 *   - `export *` does NOT carry a default export. Twenty-one UK shims were
 *     silently missing theirs until the build said so, so a default is
 *     re-exported explicitly.
 *   - a module that exports nothing REGISTERS something. Rewriting an event
 *     handler's registration side effect as a re-export drops the registration
 *     entirely, so those become a bare `import "<new>";`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { singleCountryFiles } from "./classifySingleCountryFiles";
import { ACKNOWLEDGED_OUTSIDE } from "../../src/lib/countries/singleCountryData";

/**
 * Where a file belongs inside the folder, by where it came from.
 *
 * ⚠ THE BASENAME KEEPS ITS COUNTRY PREFIX. `de/data/deRegions.ts` reads as
 * redundant and renaming to `regions.ts` is tempting, but the prefix is what
 * every `git log --follow` and every existing import already says, and Japan's
 * folder kept it. A rename is churn that buys nothing and loses history for
 * anyone not passing `--follow`.
 */
const RULES: ReadonlyArray<readonly [RegExp, (cc: string, base: string) => string]> = [
  /*
   * ⚠ `data/` IS THE SIZE-CAP-EXEMPT DIRECTORY, SO ONLY DATA MAY GO THERE.
   * The fallback sent `cnRegionalBudget.ts` -- a 467-line turn processor -- to
   * `cn/data/`, which would have quietly exempted a logic module from the 2,000
   * line cap forever. Cabinet tables get `cabinet/` and logic keeps the folder
   * root, matching what Japan, the United States and the United Kingdom did by
   * hand.
   */
  [/\/constants\/[a-z]{2}Cabinet[A-Za-z]*\.ts$/, (_cc, b) => `cabinet/${b}`],
  [/\/turn\/[a-z]{2}[A-Z][A-Za-z]*\.ts$/, (_cc, b) => b],
  [/\/elections\//, (_cc, b) => `elections/${b}`],
  [/\/seeds\/[a-z]{2}\//, (_cc, b) => `data/${b}`],
  [/\/seeds\/international\//, () => "layer1Model.ts"],
  [/\/seeds\/wiki\/content\//, (_cc, b) => `wiki/${b}`],
  [/\/turn\/billLifecycle\/configs\//, () => "elections/billLifecycle.ts"],
  [/\/turn\/perpetualElections\/countries\//, (_cc, b) => `elections/${b}`],
  [/\/turn\/election\//, (_cc, b) => `elections/${b}`],
  [/\/db\/collections\//, (_cc, b) => `db/${b}`],
  [/\/db\/types\//, (_cc, b) => `db/${b.replace(/\.ts$/, "Types.ts")}`],
  [/\/admin\/seed\//, (_cc, b) => `${b}`],
  [/\/events\/worldEvents\/handlers\//, (_cc, b) => `worldEvents/${b}`],
  [/\/events\/pree\/handlers\//, (_cc, b) => `${b}`],
  [/\/politicalLegislation\/laws\//, (_cc, b) => `data/${b}`],
  [/\/constituencies\//, (_cc, b) => `data/${b}`],
  [/\/npp\/rosters\//, (_cc, b) => `data/${b}`],
  [/\/commodity-map\//, (_cc, b) => `data/${b}`],
  /*
   * ⚠ UPSTREAM KEEPS AUTHORING PER-COUNTRY FEATURES UNDER `src/lib/<cc>/`, and
   * they are LOGIC, not data. Without these rules the fallback below sends them
   * to `data/` -- the size-cap-exempt directory -- which is exactly the misfile
   * the `cnRegionalBudget.ts` note above records. Each feature keeps its own
   * subdirectory inside the folder so the upstream shape survives the move and
   * a later merge still lines up.
   *
   * `cabinet/rules/` MUST precede `cabinet/`: `uk/cabinet/nppResignation.ts` and
   * `uk/cabinet/rules/nppResignation.ts` share a basename, and a single
   * `cabinet/` rule collapses both onto one destination. The tool aborts on that
   * collision rather than silently overwriting, which is how it was found.
   */
  [/\/lib\/[a-z]{2}\/cabinet\/rules\//, (_cc, b) => `cabinet/rules/${b}`],
  [/\/lib\/[a-z]{2}\/cabinet\//, (_cc, b) => `cabinet/${b}`],
  [/\/lib\/[a-z]{2}\/conference\//, (_cc, b) => `conference/${b}`],
  [/\/lib\/[a-z]{2}\/leadership\//, (_cc, b) => `leadership/${b}`],
  [/\/lib\/[a-z]{2}\/dualMinistry\//, (_cc, b) => `dualMinistry/${b}`],
  /* A bare `src/lib/<cc>/<file>.ts` is country logic: folder root, not data/. */
  [/\/lib\/[a-z]{2}\/[A-Za-z0-9]+\.ts$/, (_cc, b) => b],
];

function destination(cc: string, file: string): string {
  const base = basename(file);
  for (const [pattern, to] of RULES) {
    if (pattern.test(file)) return `src/lib/countries/${cc.toLowerCase()}/${to(cc, base)}`;
  }
  return `src/lib/countries/${cc.toLowerCase()}/data/${base}`;
}

/** `../foo` relative to the OLD location, as an `@/lib/...` alias. */
function absolutise(source: string, oldFile: string): string {
  const dir = dirname(oldFile);
  /*
   * ⚠ A DYNAMIC IMPORT IS AN IMPORT. The first version matched only
   * `from "..."`, so `await import("./persistRegionLeans")` inside `seedRU.ts`
   * travelled to the new directory still pointing at the old one's sibling.
   * Static imports fail typecheck; this one failed it too, but only because the
   * module happened not to exist at the new path -- a dynamic import that
   * resolved to a DIFFERENT real module would have compiled and run the wrong
   * code.
   */
  return source.replace(/(from|import\()\s*"(\.\.?\/[^"]+)"/g, (_m, lead: string, rel: string) => {
    const joined = `${dir}/${rel}`
      .split("/")
      .reduce<string[]>((acc, part) => {
        if (part === "." || part === "") return acc;
        if (part === "..") {
          acc.pop();
          return acc;
        }
        acc.push(part);
        return acc;
      }, [])
      .join("/");
    const head = lead === "from" ? "from " : "import(";
    return joined.startsWith("src/lib/")
      ? `${head}"@/lib/${joined.slice("src/lib/".length)}"`
      : `${head}"${rel}"`;
  });
}

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const countries = args.filter((a) => !a.startsWith("--")).map((a) => a.toUpperCase());
if (countries.length === 0) {
  console.error("usage: npx tsx scripts/countries/relocate-country-files.ts <CC>... [--dry]");
  process.exit(1);
}

for (const CC of countries) {
  const cc = CC.toLowerCase();
  const folder = `src/lib/countries/${cc}/`;
  const excused = new Set(ACKNOWLEDGED_OUTSIDE.filter((e) => e.country === CC).map((e) => e.file));

  const stranded = singleCountryFiles()
    .filter((f) => f.country === CC)
    .filter((f) => !f.file.startsWith(folder))
    .filter((f) => !excused.has(f.file));

  if (stranded.length === 0) {
    console.log(`${CC}: nothing stranded.`);
    continue;
  }

  const collisions = new Map<string, string>();
  for (const f of stranded) {
    const dst = destination(CC, f.file);
    const prior = collisions.get(dst);
    if (prior) {
      console.error(`ABORT  ${f.file} and ${prior} both map to ${dst}. Add a rule for one.`);
      process.exit(1);
    }
    collisions.set(dst, f.file);
  }

  let moved = 0;
  for (const f of stranded) {
    const dst = destination(CC, f.file);
    console.log(`  ${f.file}  ->  ${dst}  (${f.lines} lines, by ${f.by})`);
    if (DRY) continue;

    mkdirSync(dirname(dst), { recursive: true });
    execFileSync("git", ["mv", f.file, dst]);

    const body = absolutise(readFileSync(dst, "utf8"), f.file);
    writeFileSync(dst, body, "utf8");

    const alias = `@/lib/${dst.slice("src/lib/".length, -".ts".length)}`;
    const exportsSomething = /^export /m.test(body);
    const hasDefault = /^export default/m.test(body);

    const shim = exportsSomething
      ? `/**\n` +
        ` * Forwarder. Moved into ${CC}'s country folder.\n` +
        ` *\n` +
        ` * A forwarder holds no copy, so existing importers are untouched and there is\n` +
        ` * still exactly one declaration.${
          hasDefault
            ? "\n *\n * The default is re-exported separately: `export *` does not carry it."
            : ""
        }\n` +
        ` */\nexport * from "${alias}";\n${hasDefault ? `export { default } from "${alias}";\n` : ""}`
      : `/**\n` +
        ` * Forwarder. Moved into ${CC}'s country folder.\n` +
        ` *\n` +
        ` * A SIDE-EFFECTING IMPORT, NOT A RE-EXPORT: this module registers handlers and\n` +
        ` * exports nothing, so there is no binding to forward and a re-export would\n` +
        ` * drop the registration.\n` +
        ` */\nimport "${alias}";\n`;
    writeFileSync(f.file, shim, "utf8");
    moved++;
  }

  console.log(
    `${CC}: ${DRY ? `${stranded.length} would move` : `${moved} moved`}, ` +
      `${excused.size} acknowledged in place.`
  );
}
