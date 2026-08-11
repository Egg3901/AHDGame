import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Layout contract for HeroStatsStrip — grid mode must paint tile backgrounds
 * via [&>*] so gap-px gutters don't leave transparent holes, and must not use
 * overflow-x-auto (that's the scroll layout's job).
 */
describe("HeroStatsStrip layout contract", () => {
  const source = readFileSync(join(__dirname, "HeroStatsStrip.tsx"), "utf8");

  it("exposes scroll and grid layouts", () => {
    expect(source).toContain('layout = "scroll"');
    expect(source).toContain('layout === "grid"');
    expect(source).toContain("VARIANT_GRID");
    expect(source).toContain("VARIANT_SCROLL");
  });

  it("grid layout wraps on mobile and paints tile surfaces", () => {
    expect(source).toMatch(/grid-cols-2/);
    expect(source).toMatch(/\[&>\*\]:bg-card/);
    expect(source).toMatch(/\[&>\*\]:min-w-0/);
  });

  it("keeps overflow-x-auto only on the scroll variant", () => {
    const scrollBlock = source.slice(
      source.indexOf("VARIANT_SCROLL"),
      source.indexOf("VARIANT_GRID")
    );
    const gridBlock = source.slice(
      source.indexOf("VARIANT_GRID"),
      source.indexOf("export interface")
    );
    expect(scrollBlock).toContain("overflow-x-auto");
    expect(gridBlock).not.toContain("overflow-x-auto");
  });
});
