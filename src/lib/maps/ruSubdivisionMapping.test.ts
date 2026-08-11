import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/** Extract the SUBJECT_TO_REGION mapping from a script file as {subject: region}. */
function extractMapping(file: string): Record<string, string> {
  const text = readFileSync(join(process.cwd(), file), "utf-8");
  const start = text.indexOf("const SUBJECT_TO_REGION = {");
  expect(start).toBeGreaterThan(-1);
  const end = text.indexOf("};", start);
  const body = text.slice(start, end);
  const mapping: Record<string, string> = {};
  // Lines like `Moscow: "CEN",` or `"Moscow Oblast": "CEN",`
  for (const m of body.matchAll(
    /^\s*(?:"([^"]+)"|([A-Za-z]+)):\s*"([A-Z]{3})",?\s*(?:\/\/.*)?$/gm
  )) {
    mapping[m[1] ?? m[2]] = m[3];
  }
  expect(Object.keys(mapping).length).toBeGreaterThan(50);
  return mapping;
}

describe("RU subdivision mapping drift guard", () => {
  it("prepare-ru-map-data SUBJECT_TO_REGION matches build-ru-geo verbatim", () => {
    expect(extractMapping("scripts/prepare-ru-map-data.ts")).toEqual(
      extractMapping("scripts/maps/build-ru-geo.mjs")
    );
  });
});
