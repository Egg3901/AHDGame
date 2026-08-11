import React from "react";
import { BE_SIGNALS, FE_SIGNALS, FIXED_MAJOR_SIGNALS } from "./changelogTypes";
import type {
  AdminBlock,
  AdminItem,
  AdminSection,
  ChangelogEntry,
  ClassifiedItem,
  ItemImportance,
  ItemTag,
  TagFilter,
} from "./changelogTypes";

// ─── Classification ───────────────────────────────────────────────────────────

export function classifyTag(text: string): ItemTag {
  const lower = text.toLowerCase();
  const be = BE_SIGNALS.filter((s) => lower.includes(s.toLowerCase())).length;
  const fe = FE_SIGNALS.filter((s) => lower.includes(s.toLowerCase())).length;
  if (be > 0 && fe > 0) return "both";
  if (be > fe) return "backend";
  if (fe > be) return "frontend";
  return "backend"; // default ambiguous → backend
}

export function classifyImportance(text: string, sectionHeading: string): ItemImportance {
  if (sectionHeading === "Added" || sectionHeading === "Changed") return "major";
  if (sectionHeading === "Refactored" || sectionHeading === "Technical") return "minor";
  // "Fixed" and others: check for major signals
  const lower = text.toLowerCase();
  return FIXED_MAJOR_SIGNALS.some((s) => lower.includes(s)) ? "major" : "minor";
}

export function classifyItem(item: AdminItem, sectionHeading: string): ClassifiedItem {
  return {
    ...item,
    tag: classifyTag(item.text),
    importance: classifyImportance(item.text, sectionHeading),
  };
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

// Canonical public categories that carry an icon/color chip (see CATEGORY_META).
const CANONICAL_CATEGORIES = ["Highlights", "Mechanics", "UI", "Content", "Platform", "Bug Fixes"];

/**
 * Normalize a `### Heading` to its canonical category name. A leading emoji
 * (e.g. "⚙️ Mechanics") is stripped so the heading matches CATEGORY_META
 * whether or not the markdown author included the emoji. Themed one-off headings
 * whose stripped form isn't a known category (e.g. "🇩🇪 Germany") are returned
 * unchanged so they keep their flavor.
 */
export function canonicalCategoryName(name: string): string {
  const t = name.trim();
  if (CANONICAL_CATEGORIES.includes(t)) return t;
  const stripped = t.replace(/^[\p{Extended_Pictographic}️‍\s]+/u, "").trim();
  return CANONICAL_CATEGORIES.includes(stripped) ? stripped : t;
}

export function parsePublicChangelog(raw: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  let currentCategory: {
    name: string;
    subcategories: { name: string | null; items: string[] }[];
  } | null = null;
  let currentSubcategory: { name: string | null; items: string[] } | null = null;

  // Content that appears between `## vX.Y.Z` and the first `### Heading`
  // (intro paragraph bullets, summary captions) gets attached to a synthetic
  // "Highlights" category so it renders on the page and posts to Discord.
  function ensureCategory(): NonNullable<typeof currentCategory> {
    if (!currentCategory) {
      currentCategory = { name: "Highlights", subcategories: [] };
      current!.categories.push(currentCategory);
    }
    return currentCategory;
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();

    // Version heading
    const heading = trimmed.match(/^## (v[\d.]+)\s*[-—]\s*(\d{4}-\d{2}-\d{2})$/);
    if (heading) {
      current = { version: heading[1], date: heading[2], items: [], categories: [] };
      entries.push(current);
      currentCategory = null;
      currentSubcategory = null;
      continue;
    }

    if (!current) continue;

    // Category heading (### Mechanics, ### ⚙️ Mechanics, ### UI, etc.)
    const categoryMatch = trimmed.match(/^### (.+)$/);
    if (categoryMatch) {
      currentCategory = { name: canonicalCategoryName(categoryMatch[1]), subcategories: [] };
      current.categories.push(currentCategory);
      currentSubcategory = null;
      continue;
    }

    // Subcategory heading (standalone **Bold** line, not a list item)
    const subcategoryMatch = trimmed.match(/^\*\*([^*]+)\*\*$/);
    if (subcategoryMatch) {
      const cat = ensureCategory();
      currentSubcategory = { name: subcategoryMatch[1], items: [] };
      cat.subcategories.push(currentSubcategory);
      continue;
    }

    // List item
    if (trimmed.startsWith("- ")) {
      const itemText = trimmed.slice(2);
      current.items.push(itemText);

      const cat = ensureCategory();
      if (currentSubcategory) {
        currentSubcategory.items.push(itemText);
      } else {
        const subs = cat.subcategories;
        if (subs.length === 0 || subs[subs.length - 1].name !== null) {
          currentSubcategory = { name: null, items: [] };
          subs.push(currentSubcategory);
        } else {
          currentSubcategory = subs[subs.length - 1];
        }
        currentSubcategory.items.push(itemText);
      }
      continue;
    }

    // Continuation of a hard-wrapped bullet: a non-blank line that isn't a
    // heading or new bullet belongs to the previous item. Without this, wrapped
    // bullets render truncated to their first physical line.
    if (trimmed.length > 0 && current.items.length > 0) {
      current.items[current.items.length - 1] += ` ${trimmed}`;
      if (currentSubcategory && currentSubcategory.items.length > 0) {
        currentSubcategory.items[currentSubcategory.items.length - 1] += ` ${trimmed}`;
      }
    }
  }
  return entries;
}

export function parseAdminChangelog(raw: string): AdminBlock[] {
  const blocks: AdminBlock[] = [];
  let currentBlock: AdminBlock | null = null;
  let currentSection: AdminSection | null = null;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    const versionMatch = trimmed.match(/^## \[(.+?)\](?:\s*[-—]\s*(\d{4}-\d{2}-\d{2}))?/);
    if (versionMatch) {
      currentBlock = { version: versionMatch[1], date: versionMatch[2], sections: [] };
      blocks.push(currentBlock);
      currentSection = null;
      continue;
    }
    const sectionMatch = trimmed.match(/^### (.+)$/);
    if (sectionMatch && currentBlock) {
      currentSection = { heading: sectionMatch[1], items: [] };
      currentBlock.sections.push(currentSection);
      continue;
    }
    if (currentSection && line.match(/^\s*-\s/)) {
      const indent = line.search(/\S/);
      const text = line.replace(/^\s*-\s/, "").trim();
      if (text) currentSection.items.push({ text, indent: Math.floor(indent / 2) });
    } else if (currentSection && trimmed.length > 0 && !trimmed.startsWith("#")) {
      // Continuation of a hard-wrapped bullet — append to the last item so it
      // isn't truncated to its first physical line.
      const items = currentSection.items;
      if (items.length > 0) items[items.length - 1].text += ` ${trimmed}`;
    }
  }
  return blocks;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function itemMatchesTagFilter(tag: ItemTag, filter: TagFilter): boolean {
  if (filter === "all") return true;
  if (filter === "both") return tag === "both";
  if (filter === "frontend") return tag === "frontend" || tag === "both";
  if (filter === "backend") return tag === "backend" || tag === "both";
  return true;
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

export function renderMarkdownText(text: string): (string | React.ReactElement)[] {
  const parts: (string | React.ReactElement)[] = [];
  const regex = /(\*\*(.+?)\*\*|`(.+?)`)/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    if (match[2])
      parts.push(
        <strong key={match.index} className="font-semibold text-foreground">
          {match[2]}
        </strong>
      );
    else if (match[3])
      parts.push(
        <code
          key={match.index}
          className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs font-mono text-emerald-400"
        >
          {match[3]}
        </code>
      );
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}
