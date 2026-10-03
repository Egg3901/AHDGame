import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/*
 * The registry keeps its readout styling (mono, uppercase, tracked labels) but
 * nothing on its views is set under 12px. This keeps the 10px label class and
 * any small arbitrary size out of the route's source, including LeanChip,
 * which the region compare view shares.
 */

const ROUTE = path.resolve(__dirname, "..");
const SOURCE = /\.(?:ts|tsx)$/;
const TEST_FILE = /\.test\.(?:ts|tsx)$/;
// Built from parts so this file does not contain the classes it bans.
const SMALL_TEXT = new RegExp(`text-body-${"xs"}|text-\\[(?:[0-9]|1[01])(?:\\.\\d+)?px\\]`);

function collect(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, acc);
    else if (SOURCE.test(entry) && !TEST_FILE.test(entry)) acc.push(full);
  }
  return acc;
}

describe("political metrics text size floor", () => {
  const files = collect(ROUTE);

  it("scans the route", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("sets nothing under 12px", () => {
    const offenders = files
      .filter((file) => SMALL_TEXT.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(ROUTE, file));
    expect(offenders, `Under 12px in:\n${offenders.join("\n")}`).toEqual([]);
  });
});
