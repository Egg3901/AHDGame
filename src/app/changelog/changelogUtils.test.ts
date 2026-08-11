import { describe, it, expect } from "vitest";
import { parsePublicChangelog, parseAdminChangelog, canonicalCategoryName } from "./changelogUtils";

describe("canonicalCategoryName", () => {
  it("maps emoji-prefixed headings to their canonical name", () => {
    expect(canonicalCategoryName("⚙️ Mechanics")).toBe("Mechanics");
    expect(canonicalCategoryName("🐛 Bug Fixes")).toBe("Bug Fixes");
    expect(canonicalCategoryName("🎨 UI")).toBe("UI");
  });

  it("passes plain canonical names through unchanged", () => {
    expect(canonicalCategoryName("Mechanics")).toBe("Mechanics");
    expect(canonicalCategoryName("Bug Fixes")).toBe("Bug Fixes");
  });

  it("leaves themed one-off headings (non-canonical) intact", () => {
    expect(canonicalCategoryName("🇩🇪 Germany")).toBe("🇩🇪 Germany");
    expect(canonicalCategoryName("📰 News Wire")).toBe("📰 News Wire");
  });
});

describe("parsePublicChangelog", () => {
  it("joins hard-wrapped bullet continuation lines into one item", () => {
    const raw = [
      "## v0.3.4 - 2026-06-20",
      "",
      "### ⚙️ Mechanics",
      "",
      "- **Index funds now actually track their target holdings.** Funds rebalance every turn toward their",
      "  target basket — trimming positions they hold too much of and topping up the ones they're short on —",
      "  instead of buying once and sitting frozen.",
      "",
      "- **A single-line bullet.** Stays intact.",
    ].join("\n");

    const [entry] = parsePublicChangelog(raw);
    expect(entry.version).toBe("v0.3.4");
    expect(entry.categories).toHaveLength(1);
    expect(entry.categories[0].name).toBe("Mechanics"); // emoji stripped → maps to CATEGORY_META

    const items = entry.categories[0].subcategories.flatMap((s) => s.items);
    expect(items).toHaveLength(2);
    // The wrapped bullet is fully captured, not truncated to its first line.
    expect(items[0]).toContain("target basket");
    expect(items[0]).toContain("sitting frozen");
    expect(items[0].endsWith("frozen.")).toBe(true);
    expect(items[1]).toBe("**A single-line bullet.** Stays intact.");
  });

  it("counts each bullet once regardless of wrapping", () => {
    const raw = [
      "## v0.1.0 - 2026-01-01",
      "",
      "### 🐛 Bug Fixes",
      "",
      "- One bug that wraps",
      "  across two lines.",
      "- Another bug.",
    ].join("\n");
    const [entry] = parsePublicChangelog(raw);
    expect(entry.items).toHaveLength(2);
  });
});

describe("parseAdminChangelog", () => {
  it("joins wrapped continuation lines for dev changelog items", () => {
    const raw = [
      "## [0.3.4] - 2026-06-20",
      "",
      "### Added",
      "",
      "- **Feature.** First line of a wrapped",
      "  bullet that continues here.",
    ].join("\n");
    const [block] = parseAdminChangelog(raw);
    expect(block.sections[0].items).toHaveLength(1);
    expect(block.sections[0].items[0].text).toContain("continues here");
  });
});
