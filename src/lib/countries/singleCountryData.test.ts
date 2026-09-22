import { describe, expect, it } from "vitest";
import { ACKNOWLEDGED_OUTSIDE, CONVERTED } from "./singleCountryData";
import { singleCountryFiles } from "../../../scripts/countries/classifySingleCountryFiles";

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
    /*
     * ⚠️ THIS USED TO ASSERT THERE WAS STILL A BACKLOG, and it failed the day the
     * backlog reached zero -- which is the right moment for a progress reporter
     * to stop being one. Inverted, it is a real guard: every country the
     * classifier claims files for is now in CONVERTED, so a NEW country whose
     * data lands outside a folder fails here rather than being noticed later.
     *
     * The five registry-only entities -- SCO, WAL, BLR, UKR, BAL -- are not in
     * CONVERTED and have no claimed files, so they neither pass nor fail on a
     * technicality; they simply have nothing to relocate.
     */
    expect(
      ranked.map(([cc, r]) => `${cc} (${r.files} files, ${r.lines} lines)`),
      `
${ranked.length} countries still hold data outside a folder.
` +
        `Convert them, or explain each file in ACKNOWLEDGED_OUTSIDE.
`
    ).toEqual([]);
  });
});
