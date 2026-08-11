// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChangelogEntry {
  version: string;
  date: string;
  items: string[];
  categories: PublicCategory[];
}

export interface PublicCategory {
  name: string;
  subcategories: PublicSubcategory[];
}

export interface PublicSubcategory {
  name: string | null;
  items: string[];
}

// Icons and colors for public changelog categories
export const CATEGORY_META: Record<
  string,
  { icon: string; color: string; bg: string; border: string }
> = {
  Highlights: {
    icon: "✨",
    color: "text-primary",
    bg: "bg-primary/10",
    border: "border-primary/25",
  },
  Mechanics: {
    icon: "\u2699\uFE0F",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/25",
  },
  UI: {
    icon: "\uD83C\uDFA8",
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/25",
  },
  Content: {
    icon: "\uD83D\uDCDA",
    color: "text-purple-400",
    bg: "bg-purple-500/10",
    border: "border-purple-500/25",
  },
  Platform: {
    icon: "\uD83D\uDD27",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/25",
  },
  "Bug Fixes": {
    icon: "\uD83D\uDC1B",
    color: "text-orange-400",
    bg: "bg-orange-500/10",
    border: "border-orange-500/25",
  },
};

export interface AdminSection {
  heading: string;
  items: AdminItem[];
}

export interface AdminItem {
  text: string;
  indent: number;
}

export interface AdminBlock {
  version: string;
  date?: string;
  sections: AdminSection[];
}

export type ItemTag = "frontend" | "backend" | "both";
export type ItemImportance = "major" | "minor";
export type TagFilter = "all" | "frontend" | "backend" | "both";

export interface ClassifiedItem extends AdminItem {
  tag: ItemTag;
  importance: ItemImportance;
}

// ─── Classification signals ───────────────────────────────────────────────────

export const BE_SIGNALS = [
  "api/",
  " route",
  "endpoint",
  "collection",
  "mongodb",
  "cron",
  "turn system",
  "turn processor",
  "turn-based",
  "auth",
  "server-side",
  "schema",
  "seed",
  "sync-date",
  "recalibrate",
  "resolv",
  "spawn",
  "tally",
  "getdb",
  "getauth",
  "processturn",
  "ensur",
  "query",
  "index",
  "migration",
  "objectid",
  "matchedcount",
  "insertmany",
  "deletemany",
  "updateone",
  "findone",
  "gamestate",
  "gametime",
  "lastturnprocessed",
  "electedofficial",
  "leadershipelection",
  "perpetual",
  "bill lifecycle",
  "election cycle",
  "election resol",
  "election status",
  "ci lint",
  "eslint",
  "vitest",
  "no-country-literals",
  "react compiler",
  "post /api",
  "get /api",
  "database",
  "nomination",
  "useReducer",
  "withRouteError",
  "handleRouteError",
  "invalidatecache",
];

export const FE_SIGNALS = [
  "component",
  " page",
  " view",
  " tab",
  "button",
  " form",
  "modal",
  "dropdown",
  "chart",
  " bar",
  "badge",
  " card",
  " nav",
  "menu",
  "header",
  "layout",
  "animation",
  "hover",
  "responsive",
  " color",
  "theme",
  " icon",
  "svg",
  "tooltip",
  "timeline",
  " table",
  " list",
  "panel",
  " ui",
  "redesign",
  "mobile",
  "display",
  "useState",
  "useEffect",
  "usereducer",
  " style",
  "tailwind",
  "collapse",
  "expand",
  "search",
  " filter",
  "scroll",
  "skeleton",
  "loading",
  "spinner",
  "toast",
  "commons page",
  "parliament page",
  "public view",
  "admin view",
  "timeline",
  "ap-style",
  "ap/nyt",
  "results display",
  "primary results",
  "composition tab",
  "bills tab",
  "leadership tab",
  "version in",
  "mobile nav",
  "mobile menu",
  "year label",
  "label",
  "color-coded",
];

// Keywords that push a "Fixed" item to "major" importance
export const FIXED_MAJOR_SIGNALS = [
  "election",
  "vote",
  " seat",
  "resolution",
  "spawn",
  "cycle",
  "official",
  "auth",
  "endpoint",
  "commons page",
  "bill proposal",
  "insert-first",
  "data loss",
  "silent",
  "no-op",
  "stale clock",
  "self-heal",
  "incompleteness",
  "anchorin",
  "discrepancy",
  "seat count",
  "proposal auth",
  "senate class",
];

// ─── Styles ───────────────────────────────────────────────────────────────────

export const SECTION_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  Added: { bg: "bg-green-500/5", text: "text-green-400", dot: "bg-green-500" },
  Changed: { bg: "bg-blue-500/5", text: "text-blue-400", dot: "bg-blue-500" },
  Fixed: { bg: "bg-orange-500/5", text: "text-orange-400", dot: "bg-orange-500" },
  Removed: { bg: "bg-red-500/5", text: "text-red-400", dot: "bg-red-500" },
  Deprecated: { bg: "bg-yellow-500/5", text: "text-yellow-400", dot: "bg-yellow-500" },
  Security: { bg: "bg-purple-500/5", text: "text-purple-400", dot: "bg-purple-500" },
  Refactored: { bg: "bg-cyan-500/5", text: "text-cyan-400", dot: "bg-cyan-500" },
  Technical: { bg: "bg-violet-500/5", text: "text-violet-400", dot: "bg-violet-500" },
};

export const DEFAULT_SECTION = { bg: "bg-card", text: "text-muted", dot: "bg-muted" };

export const TAG_STYLES: Record<ItemTag, { label: string; classes: string }> = {
  frontend: { label: "FE", classes: "bg-blue-500/10 text-blue-400 border-blue-500/25" },
  backend: { label: "BE", classes: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" },
  both: { label: "BE+FE", classes: "bg-violet-500/10 text-violet-400 border-violet-500/25" },
};

export const TAG_FILTER_OPTIONS: { value: TagFilter; label: string; desc: string }[] = [
  { value: "all", label: "All", desc: "Show everything" },
  { value: "frontend", label: "Frontend", desc: "UI, components, pages" },
  { value: "backend", label: "Backend", desc: "API routes, DB, server logic" },
  { value: "both", label: "Full-stack", desc: "Touches both layers" },
];
