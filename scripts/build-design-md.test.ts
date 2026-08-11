import { describe, expect, it } from "vitest";
import {
  buildDesignMd,
  extractPropsBlock,
  parseComponentExports,
  parseDeclarations,
  parseThemeInline,
  parseThemes,
  resolveValue,
  tailwindUtilitiesFor,
  updateMarkedSection,
} from "./build-design-md.mjs";

const CSS_FIXTURE = `
@import "tailwindcss";
@import "./animations.css";

/* Default theme — premium dark */
:root,
[data-theme="default"] {
  --background: #14141c; /* trailing comment */
  --card: #1d1d2a;
  --shadow-sm: 0 1px 3px 0 rgb(0 0 0 / 0.5), 0 1px 2px -1px rgb(0 0 0 / 0.4);
}

[data-theme="light"] {
  --background: #f8fafc;
}

/* Decoy: descendant selector, NOT a theme block */
[data-theme="solarized"] body {
  background: linear-gradient(168deg, #002028 0%, #04303a 100%);
}

/* Typography scale */
:root {
  --text-body: 0.875rem;
}

@theme inline {
  --color-background: var(--background);
  --color-card: var(--card);
  --shadow-card: var(--shadow-sm);
  --font-size-body: var(--text-body);
}
`;

describe("parseDeclarations", () => {
  it("extracts custom properties and trims values", () => {
    expect(parseDeclarations("  --a: 1px;\n  --b-c: rgb(0 0 0 / 0.5);\n")).toEqual({
      "--a": "1px",
      "--b-c": "rgb(0 0 0 / 0.5)",
    });
  });
});

describe("parseThemes", () => {
  it("finds exact theme blocks and merges :root,[data-theme=default]", () => {
    const { themes } = parseThemes(CSS_FIXTURE);
    expect([...themes.keys()].sort()).toEqual(["default", "light"]);
    expect(themes.get("default")!["--background"]).toBe("#14141c");
    expect(themes.get("light")!["--background"]).toBe("#f8fafc");
  });

  it("ignores descendant decoy selectors like [data-theme=x] body", () => {
    const { themes } = parseThemes(CSS_FIXTURE);
    expect(themes.has("solarized")).toBe(false);
  });

  it("collects bare :root declarations separately", () => {
    const { root } = parseThemes(CSS_FIXTURE);
    expect(root["--text-body"]).toBe("0.875rem");
  });

  it("throws when no theme blocks exist (empty-section guard)", () => {
    expect(() => parseThemes("body { color: red; }")).toThrow(/no \[data-theme\]/);
  });
});

describe("parseThemeInline", () => {
  it("maps tailwind vars to their source vars", () => {
    expect(parseThemeInline(CSS_FIXTURE)).toEqual({
      "--color-background": "var(--background)",
      "--color-card": "var(--card)",
      "--shadow-card": "var(--shadow-sm)",
      "--font-size-body": "var(--text-body)",
    });
  });

  it("throws when the @theme inline block is missing", () => {
    expect(() => parseThemeInline("body {}")).toThrow(/@theme inline/);
  });
});

describe("resolveValue", () => {
  const { themes, root } = parseThemes(CSS_FIXTURE);
  const def = themes.get("default");

  it("resolves var() through the default theme", () => {
    expect(resolveValue("var(--card)", def, root)).toBe("#1d1d2a");
  });

  it("falls back to :root for typography vars", () => {
    expect(resolveValue("var(--text-body)", def, root)).toBe("0.875rem");
  });

  it("passes through non-var values and unresolvable vars", () => {
    expect(resolveValue("#fff", def, root)).toBe("#fff");
    expect(resolveValue("var(--font-geist-sans)", def, root)).toBe("var(--font-geist-sans)");
  });
});

const INDEX_FIXTURE = `
export { Skeleton } from "./Skeleton";
export {
  Badge,
  BadgeCount,
  type BadgeColor,
  type BadgeVariant,
} from "./Badge";
export { ResponsiveTable, type ResponsiveTableColumn } from "./ResponsiveTable";
`;

const COMPONENT_FIXTURE = `
"use client";

export type ButtonVariant = "primary" | "secondary";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: React.ReactNode;
}

export function Button({ variant = "primary" }: ButtonProps) {
  return null;
}
`;

describe("parseComponentExports", () => {
  it("lists component exports with their source file, skipping type exports", () => {
    expect(parseComponentExports(INDEX_FIXTURE)).toEqual([
      { name: "Skeleton", file: "Skeleton" },
      { name: "Badge", file: "Badge" },
      { name: "BadgeCount", file: "Badge" },
      { name: "ResponsiveTable", file: "ResponsiveTable" },
    ]);
  });

  it("throws on an index with no exports (empty-section guard)", () => {
    expect(() => parseComponentExports("// nothing here")).toThrow(/no exports/);
  });
});

describe("extractPropsBlock", () => {
  it("extracts a non-exported interface <Name>Props block verbatim", () => {
    const block = extractPropsBlock(COMPONENT_FIXTURE, "Button");
    expect(block).toContain("interface ButtonProps extends React.ButtonHTMLAttributes");
    expect(block).toContain("variant?: ButtonVariant;");
    expect(block?.trimEnd().endsWith("}")).toBe(true);
  });

  it("returns null when the component has no <Name>Props declaration", () => {
    expect(extractPropsBlock(COMPONENT_FIXTURE, "Missing")).toBeNull();
  });
});

describe("tailwindUtilitiesFor", () => {
  it("maps token prefixes to utility class names", () => {
    expect(tailwindUtilitiesFor("--color-card")).toBe("bg-card · text-card · border-card");
    expect(tailwindUtilitiesFor("--font-size-body")).toBe("text-body");
    expect(tailwindUtilitiesFor("--shadow-card")).toBe("shadow-card");
    expect(tailwindUtilitiesFor("--font-sans")).toBe("font-sans");
    expect(tailwindUtilitiesFor("--something-else")).toBe("—");
  });
});

const DOC_FIXTURE = `# Design

CURATED-SENTINEL: this line must survive regeneration.

<!-- GENERATED:tokens -->
stale tokens
<!-- /GENERATED:tokens -->

More curated prose.

<!-- GENERATED:components -->
stale components
<!-- /GENERATED:components -->
`;

describe("updateMarkedSection", () => {
  it("replaces only the content between markers", () => {
    const next = updateMarkedSection(DOC_FIXTURE, "tokens", "FRESH TOKENS");
    expect(next).toContain("FRESH TOKENS");
    expect(next).not.toContain("stale tokens");
    expect(next).toContain("CURATED-SENTINEL");
    expect(next).toContain("stale components"); // other section untouched
  });

  it("throws when markers are missing", () => {
    expect(() => updateMarkedSection("# no markers", "tokens", "x")).toThrow(/GENERATED:tokens/);
  });
});

describe("buildDesignMd", () => {
  const inputs = {
    css: CSS_FIXTURE,
    indexSource: INDEX_FIXTURE,
    readComponentSource: () => COMPONENT_FIXTURE,
  };

  it("fills both generated sections and preserves curated prose", () => {
    const next = buildDesignMd(DOC_FIXTURE, inputs);
    expect(next).toContain("CURATED-SENTINEL");
    expect(next).toContain("bg-card · text-card · border-card");
    expect(next).toContain("### Badge");
    expect(next).not.toContain("stale tokens");
  });

  it("is idempotent", () => {
    const once = buildDesignMd(DOC_FIXTURE, inputs);
    expect(buildDesignMd(once, inputs)).toBe(once);
  });
});
