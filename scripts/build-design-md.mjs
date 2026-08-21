// Generates the machine-derived sections of docs/DESIGN.md from
// src/app/globals.css and src/components/ui/. Curated prose outside the
// GENERATED markers is preserved. CLI: node scripts/build-design-md.mjs [--check]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------- CSS parsing ----------

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** @param {string} body @returns {Record<string, string>} */
export function parseDeclarations(body) {
  const out = {};
  const re = /--([\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(body))) out[`--${m[1]}`] = m[2].trim();
  return out;
}

// Matches only exact theme selectors: `[data-theme="x"]` optionally preceded
// by `:root,`. Descendant selectors (`[data-theme="x"] body`) must not match.
const THEME_SELECTOR = /^(?::root\s*,\s*)?\[data-theme="([\w-]+)"\]$/;

/** @param {string} css @returns {{ themes: Map<string, Record<string, string>>, root: Record<string, string> }} */
export function parseThemes(css) {
  const themes = new Map();
  const root = {};
  const re = /([^{}]+)\{([^{}]*)\}/g;
  const clean = stripComments(css);
  let m;
  while ((m = re.exec(clean))) {
    // Preceding statements (@import ...;) share the chunk before the first
    // block — keep only the text after the last semicolon as the selector.
    const selector = m[1].split(";").pop().trim();
    const themeMatch = selector.match(THEME_SELECTOR);
    if (themeMatch) {
      const name = themeMatch[1];
      themes.set(name, { ...(themes.get(name) ?? {}), ...parseDeclarations(m[2]) });
    } else if (selector === ":root") {
      Object.assign(root, parseDeclarations(m[2]));
    }
  }
  if (themes.size === 0) {
    throw new Error(
      "parseThemes: no [data-theme] blocks found in globals.css — refusing to write an empty token section"
    );
  }
  return { themes, root };
}

/** @param {string} css @returns {Record<string, string>} */
export function parseThemeInline(css) {
  const clean = stripComments(css);
  const start = clean.indexOf("@theme inline");
  if (start === -1)
    throw new Error("parseThemeInline: no @theme inline block found in globals.css");
  const open = clean.indexOf("{", start);
  const close = clean.indexOf("}", open);
  return parseDeclarations(clean.slice(open + 1, close));
}

export function resolveValue(decl, defaultTheme, root) {
  const m = decl.match(/^var\((--[\w-]+)\)$/);
  if (!m) return decl;
  return defaultTheme[m[1]] ?? root[m[1]] ?? decl;
}

// ---------- Component inventory ----------

/** @param {string} indexSource @returns {Array<{ name: string, file: string }>} */
export function parseComponentExports(indexSource) {
  const out = [];
  const re = /export\s*\{([^}]+)\}\s*from\s*"\.\/([\w-]+)"/g;
  let m;
  while ((m = re.exec(indexSource))) {
    const names = m[1]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("type "));
    for (const name of names) out.push({ name, file: m[2] });
  }
  if (out.length === 0) {
    throw new Error(
      "parseComponentExports: no exports found in src/components/ui/index.ts — refusing to write an empty component section"
    );
  }
  return out;
}

// Components are prettier-formatted, so the closing brace of a top-level
// interface/type block sits at column 0 — anchor on that.
/** @param {string} source @param {string} componentName @returns {string | null} */
export function extractPropsBlock(source, componentName) {
  const re = new RegExp(
    `(?:export\\s+)?(?:interface|type)\\s+${componentName}Props[^\\n]*\\n[\\s\\S]*?^\\}`,
    "m"
  );
  const m = source.match(re);
  return m ? m[0] : null;
}

export function tailwindUtilitiesFor(themeVar) {
  if (themeVar.startsWith("--color-")) {
    const n = themeVar.slice("--color-".length);
    return `bg-${n} · text-${n} · border-${n}`;
  }
  if (themeVar.startsWith("--font-size-")) return `text-${themeVar.slice("--font-size-".length)}`;
  if (themeVar.startsWith("--shadow-")) return `shadow-${themeVar.slice("--shadow-".length)}`;
  if (themeVar.startsWith("--font-")) return `font-${themeVar.slice("--font-".length)}`;
  return "—";
}

// ---------- Rendering ----------

// Curated one-liners. Themes/components absent from these maps render with an
// empty note — keep entries short and update when a theme/component is added.
const THEME_NOTES = {
  default: "Premium dark — warmed graphite, red primary / blue secondary (baseline theme)",
  light: "Clean, airy slate light theme",
  oled: "True-black backdrop; accents brightened to pop on #000",
  usa: "Patriotic navy / parchment / crimson",
  pastel: "Light theme, soft magenta-tinted pastels",
  "dark-pastel": "Dark surfaces with pastel accents",
  retro: "Warm dark amber/olive retro feel",
  solarized: "Solarized teal dark with warm gradient body",
  cloakroom: "Muted, stately parliamentary dark",
  broadsheet: "Light newsprint — serif, ink-on-paper",
  coldwar: "Stark cold-war dark — olive and red",
  "command-1953": "Phosphor-green command console with radar-era scanlines",
};

const COMPONENT_NOTES = {
  Button: "Buttons and loading button states",
  Input: "Form text fields",
  Label: "Form field labels",
  EmptyState: "Zero-data states",
  Skeleton: "Loading placeholder blocks",
  PageLoader: "Full-page loading state",
  PageError: "Full-page error states",
  PageErrorBoundary: "Error boundary wrapper for pages",
  ErrorPageContent: "Shared error page body",
  SectionLabel: "Section headings inside panels",
  ResponsiveTable: "Tables that need horizontal overflow handling",
  Modal: "Dialogs and confirmations",
  Tooltip: "Hover/focus tooltips",
  Toast: "Transient notifications",
  Badge: "Status and category badges",
  BadgeCount: "Numeric count badges",
  TallyBadge: "Vote tally badges",
  LiveDot: "Live/pulsing indicator dot",
  Slider: "Range inputs",
  MobileSelect: "Native select styled for mobile",
  LoadingSpinner: "Inline spinner",
  HeroStatsStrip: "Hero header stat strips",
  CardSkeleton: "Card-shaped loading placeholder",
  StatGridSkeleton: "Stat grid loading placeholder",
  ListRowSkeleton: "List row loading placeholder",
  TabRowSkeleton: "Tab row loading placeholder",
  PageHeaderSkeleton: "Page header loading placeholder",
};

const GENERATED_NOTE = "_Generated by `npm run design:build` — do not edit this section by hand._";

export function renderTokensSection({ themes, root, inline }) {
  const lines = [GENERATED_NOTE, ""];

  lines.push("#### Themes (brand tier)", "");
  lines.push("| Theme | Personality |", "| --- | --- |");
  for (const name of themes.keys()) {
    lines.push(`| \`${name}\` | ${THEME_NOTES[name] ?? ""} |`);
  }
  lines.push("");

  const def = themes.get("default") ?? {};
  lines.push("#### Semantic tokens (use these — never raw values)", "");
  lines.push("| Token | Source var | Default-theme value | Tailwind utilities |");
  lines.push("| --- | --- | --- | --- |");
  for (const [tokenVar, decl] of Object.entries(inline)) {
    lines.push(
      `| \`${tokenVar}\` | \`${decl}\` | \`${resolveValue(decl, def, root)}\` | ${tailwindUtilitiesFor(tokenVar)} |`
    );
  }
  return lines.join("\n");
}

export function renderComponentsSection(components) {
  const lines = [GENERATED_NOTE, ""];
  for (const c of components) {
    lines.push(`### ${c.name}`, "");
    const note = COMPONENT_NOTES[c.name];
    if (note) lines.push(`${note}. Source: \`src/components/ui/${c.file}.tsx\``, "");
    else lines.push(`Source: \`src/components/ui/${c.file}.tsx\``, "");
    if (c.props) {
      lines.push("```ts", c.props, "```", "");
    } else {
      lines.push(`Props: see \`src/components/ui/${c.file}.tsx\` (no <Name>Props block).`, "");
    }
  }
  return lines.join("\n");
}

export function updateMarkedSection(doc, name, content) {
  const start = `<!-- GENERATED:${name} -->`;
  const end = `<!-- /GENERATED:${name} -->`;
  const si = doc.indexOf(start);
  const ei = doc.indexOf(end);
  if (si === -1 || ei === -1) {
    throw new Error(
      `docs/DESIGN.md is missing its ${start} / ${end} markers — restore them from git`
    );
  }
  return `${doc.slice(0, si + start.length)}\n\n${content.trim()}\n\n${doc.slice(ei)}`;
}

export function buildDesignMd(existingDoc, { css, indexSource, readComponentSource }) {
  const { themes, root } = parseThemes(css);
  const inline = parseThemeInline(css);
  const components = parseComponentExports(indexSource).map((c) => ({
    ...c,
    props: extractPropsBlock(readComponentSource(c.file), c.name),
  }));
  let doc = existingDoc;
  doc = updateMarkedSection(doc, "tokens", renderTokensSection({ themes, root, inline }));
  doc = updateMarkedSection(doc, "components", renderComponentsSection(components));
  return doc;
}

// ---------- CLI ----------

const normalize = (s) => s.replace(/\r\n/g, "\n");

async function formatMarkdown(text, filepath) {
  const mod = await import("prettier");
  const prettier = mod.default ?? mod;
  const config = (await prettier.resolveConfig(filepath)) ?? {};
  return prettier.format(text, { ...config, parser: "markdown" });
}

async function main() {
  const check = process.argv.includes("--check");
  const cssPath = path.join(ROOT, "src", "app", "globals.css");
  const indexPath = path.join(ROOT, "src", "components", "ui", "index.ts");
  const outPath = path.join(ROOT, "docs", "DESIGN.md");

  if (!fs.existsSync(outPath)) {
    console.error(
      "docs/DESIGN.md not found — its curated sections cannot be regenerated. Restore it from git."
    );
    process.exit(1);
  }

  const existing = fs.readFileSync(outPath, "utf8");
  const next = buildDesignMd(existing, {
    css: fs.readFileSync(cssPath, "utf8"),
    indexSource: fs.readFileSync(indexPath, "utf8"),
    readComponentSource: (file) =>
      fs.readFileSync(path.join(ROOT, "src", "components", "ui", `${file}.tsx`), "utf8"),
  });
  const formatted = await formatMarkdown(next, outPath);

  if (check) {
    if (normalize(existing) !== normalize(formatted)) {
      console.error("docs/DESIGN.md is stale — run `npm run design:build` and stage the result.");
      process.exit(1);
    }
    console.log("design:check OK — docs/DESIGN.md is fresh.");
    return;
  }
  fs.writeFileSync(outPath, formatted);
  console.log("docs/DESIGN.md regenerated.");
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
