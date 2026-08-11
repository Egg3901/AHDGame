import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("BillListItem surface contract", () => {
  const source = readFileSync(join(__dirname, "BillListItem.tsx"), "utf8");

  it("uses card surface tokens so rows do not blend into the page", () => {
    expect(source).toContain("bg-card");
    expect(source).toContain("border-card-border");
    expect(source).toContain("shadow-card");
    expect(source).toContain("rounded-xl");
  });

  it("stacks items with a gap rather than hairline divides", () => {
    expect(source).toContain("flex flex-col gap-3");
  });
});
