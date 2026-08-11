import type { SuggestionCategory, SuggestionGameSystem } from "@/lib/db/types";

export const inputBase =
  "w-full rounded-lg border border-card-border bg-background px-4 py-2.5 text-sm placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors duration-150";

export const BUG_CATEGORY_LABELS: Record<string, string> = {
  ui_ux: "UI / UX",
  performance: "Performance",
  data_display: "Wrong or missing data",
  authentication: "Login / Account",
  elections: "Elections",
  congress_bills: "Congress & Bills",
  parties: "Political Parties",
  npps: "NPPs (AI politicians)",
  map: "Map",
  actions: "Actions / Turn",
  notifications: "Notifications",
  other: "Other",
};

export const SUGGESTION_CATEGORY_LABELS: Record<SuggestionCategory, string> = {
  feature_request: "New feature",
  ui_improvement: "UI improvement",
  game_balance: "Game balance",
  new_content: "New content / variety",
  accessibility: "Accessibility",
  other: "Other",
};

export const SUGGESTION_GAME_SYSTEM_LABELS: Record<SuggestionGameSystem, string> = {
  elections: "Elections",
  legislature: "Congress / Legislature",
  executive: "Executive / White House",
  judiciary: "Courts / Judiciary",
  economy: "Economy & markets",
  corporations: "Corporations",
  parties: "Political parties",
  npps: "NPPs",
  map_geo: "Map & geography",
  combat_or_military: "Combat / Military",
  diplomacy: "Diplomacy",
  onboarding_account: "Account / onboarding",
  notifications: "Notifications",
  meta_other: "Other / meta",
};

export const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  wont_fix: "Won't fix",
};

export const SUGGESTION_CATEGORY_COLORS: Record<SuggestionCategory, string> = {
  feature_request: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  ui_improvement: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  game_balance: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  new_content: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  accessibility: "bg-pink-500/15 text-pink-400 border-pink-500/30",
  other: "bg-muted/15 text-muted border-muted/30",
};

export const GAME_SYSTEM_COLORS: Record<SuggestionGameSystem, string> = {
  elections: "bg-rose-500/15 text-rose-400",
  legislature: "bg-blue-500/15 text-blue-400",
  executive: "bg-indigo-500/15 text-indigo-400",
  judiciary: "bg-purple-500/15 text-purple-400",
  economy: "bg-yellow-500/15 text-yellow-400",
  corporations: "bg-orange-500/15 text-orange-400",
  parties: "bg-cyan-500/15 text-cyan-400",
  npps: "bg-teal-500/15 text-teal-400",
  map_geo: "bg-green-500/15 text-green-400",
  combat_or_military: "bg-red-500/15 text-red-400",
  diplomacy: "bg-fuchsia-500/15 text-fuchsia-400",
  onboarding_account: "bg-slate-500/15 text-slate-400",
  notifications: "bg-lime-500/15 text-lime-400",
  meta_other: "bg-muted/15 text-muted",
};
