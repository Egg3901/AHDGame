import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "globals.css"), "utf8");

describe("mobile text-entry font size (ticket #1114)", () => {
  it("forces 16px on coarse-pointer text controls so iOS does not zoom on focus", () => {
    const block = css.match(
      /@media \(pointer: coarse\) \{[\s\S]*?font-size:\s*16px\s*!important;[\s\S]*?\}/
    );
    expect(block?.[0]).toBeTruthy();
    expect(block?.[0]).toMatch(/\btextarea\b/);
    expect(block?.[0]).toMatch(/\bselect\b/);
    expect(block?.[0]).toMatch(/input:not\(\[type="checkbox"\]\)/);
  });
});
