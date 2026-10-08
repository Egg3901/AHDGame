import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, sep } from "path";

/**
 * Every production file that deletes a corporation document must also write
 * its exit record, or be listed here with the reason it is not an exit. The
 * corporation document is the only other place a corporation's identity lives,
 * so a delete without a record is a corporation that vanished with no cause.
 */
const NOT_AN_EXIT: Record<string, string> = {
  "src/lib/corporations/subsidiaries/commands/spinOff.ts":
    "Rolls back a spin-off corporation that was created and never went live.",
  "src/app/api/corporations/route.ts":
    "Rolls back a founding that failed part-way; the corporation never existed.",
  "src/lib/world/succession/materializeCustody.ts":
    "Moves a state shell into federation custody archives; the document is restorable.",
  "src/lib/world/succession/materializePublicCorporations.ts":
    "Archives a public corporation into federation custody inside a transaction; restorable.",
  "src/lib/remediation/defects/AHD-command-economy-private-sector-ownership.ts":
    "One-off data repair retiring a historical merge shell, not a game event.",
};

const CORPORATION_DELETE =
  /(?:collection<Corporation>\(\s*"corporations"\s*\)|\bcorps|\bcorporations)\s*\.deleteOne\(/;

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
}

describe("corporation exit coverage", () => {
  it("records an exit wherever a corporation document is deleted", () => {
    const files: string[] = [];
    walk(join(process.cwd(), "src"), files);
    const uncovered: string[] = [];
    for (const file of files) {
      const rel = file
        .slice(process.cwd().length + 1)
        .split(sep)
        .join("/");
      const source = readFileSync(file, "utf8");
      if (!CORPORATION_DELETE.test(source)) continue;
      if (rel in NOT_AN_EXIT) continue;
      if (!source.includes("recordCorporationExit(")) uncovered.push(rel);
    }
    expect(uncovered).toEqual([]);
  });
});
