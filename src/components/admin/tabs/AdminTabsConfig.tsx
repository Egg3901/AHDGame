import type { ReactNode } from "react";

export type MainTabId =
  | "dashboard"
  | "traffic"
  | "politics"
  | "economy"
  | "world"
  | "players"
  | "content"
  | "support"
  | "system";

export interface MainTabConfig {
  id: MainTabId;
  label: string;
  icon: ReactNode;
}

const HomeIcon = (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
    />
  </svg>
);

const TrafficIcon = (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M4 20V10M12 20V4M20 20v-6"
    />
  </svg>
);

const PoliticsIcon = (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
    />
  </svg>
);

const WorldIcon = (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const EconomyIcon = (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const ContentIcon = (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
    />
  </svg>
);

const UsersIcon = (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
    />
  </svg>
);

const SupportIcon = (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z"
    />
  </svg>
);

const SystemIcon = (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
    />
  </svg>
);

export const MAIN_TABS: MainTabConfig[] = [
  { id: "dashboard", label: "Dashboard", icon: HomeIcon },
  { id: "traffic", label: "Traffic", icon: TrafficIcon },
  { id: "politics", label: "Politics", icon: PoliticsIcon },
  { id: "world", label: "World", icon: WorldIcon },
  { id: "economy", label: "Economy", icon: EconomyIcon },
  { id: "players", label: "Players", icon: UsersIcon },
  { id: "content", label: "Content", icon: ContentIcon },
  { id: "support", label: "Support", icon: SupportIcon },
  { id: "system", label: "System", icon: SystemIcon },
];

export const MAIN_TAB_IDS: MainTabId[] = MAIN_TABS.map((t) => t.id);

/** Sidebar grouping for the admin nav.
 * Groups follow the structure of the panel: Overview at top, then world-state
 * sections (Politics/World/Economy), then Community (Players/Content), then
 * Support/System ops at the bottom. Order mirrors MAIN_TABS so legacy URL
 * params and keyboard nav stay in sync. */
export interface AdminNavGroup {
  label: string;
  ids: MainTabId[];
}

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  { label: "Overview", ids: ["dashboard", "traffic"] },
  { label: "Game World", ids: ["politics", "world", "economy"] },
  { label: "Community", ids: ["players", "content"] },
  { label: "Operations", ids: ["support", "system"] },
];

/** Sub-tab metadata for navigation chrome (mobile selector, breadcrumbs).
 * Ids/labels must stay in sync with the SUB_TABS arrays inside each tab
 * component — this is the single nav-level source for what exists where. */
export interface SubTabConfig {
  id: string;
  label: string;
}

export const SUB_TABS_BY_TAB: Record<MainTabId, readonly SubTabConfig[]> = {
  dashboard: [],
  traffic: [],
  politics: [
    { id: "elections", label: "Elections" },
    { id: "parties", label: "Parties" },
    { id: "legislation", label: "Legislation" },
    { id: "law-types", label: "Law Types" },
  ],
  economy: [
    { id: "central-banks", label: "Central Banks" },
    { id: "inflation", label: "Inflation" },
    { id: "command-economy", label: "Command Economy" },
    { id: "stock-market", label: "Stock Market" },
    { id: "forex", label: "Forex" },
    { id: "corporations", label: "Corporations" },
    { id: "labour", label: "Labour" },
    { id: "market", label: "Market" },
    { id: "bonds", label: "Bonds" },
    { id: "commodities", label: "Commodities" },
    { id: "resource-capacity", label: "Resource Capacity" },
    { id: "extraction", label: "Prospecting & Contracts" },
    { id: "budgets", label: "Budget Overview" },
    { id: "npp-economy", label: "NPP Economy" },
    { id: "index-funds", label: "Index Funds" },
    { id: "financial-ledger", label: "Financial Ledger" },
    { id: "sector-seed", label: "Sector Seed" },
  ],
  world: [
    { id: "demographics", label: "Demographics" },
    { id: "npps", label: "NPPs" },
    { id: "politicians", label: "Politician Profiles" },
    { id: "crises", label: "Crises" },
    { id: "events", label: "Random Events" },
    { id: "countries", label: "Countries" },
    { id: "conflicts", label: "Conflicts" },
  ],
  content: [
    { id: "wiki", label: "Wiki Pages" },
    { id: "wiki-review", label: "Wiki Review" },
    { id: "roadmap", label: "Roadmap" },
  ],
  players: [
    { id: "users", label: "Users" },
    { id: "resources", label: "Grant Resources" },
    { id: "achievements", label: "Achievements" },
    { id: "characters", label: "Characters" },
    { id: "patreon", label: "Patreon" },
    { id: "banner-ads", label: "Banner Ads" },
    { id: "activity-log", label: "Activity Log" },
    { id: "suspicious", label: "Suspicious" },
    { id: "alts", label: "Alts" },
    { id: "forensics", label: "Forensics" },
    { id: "dossier", label: "Dossier" },
    { id: "watchlist", label: "Watchlist" },
    { id: "moderators", label: "Moderators" },
    { id: "mod-audit-log", label: "Mod Audit Log" },
    { id: "ip-bans", label: "IP Bans" },
    { id: "api-keys", label: "API Keys" },
    { id: "api-abuse", label: "API Abuse" },
  ],
  support: [
    { id: "suggestions", label: "Suggestions" },
    { id: "feedback", label: "Feedback (legacy)" },
    { id: "logs", label: "Logs" },
    { id: "debug", label: "Debug" },
    { id: "migrations", label: "Migrations" },
    { id: "mail-reports", label: "Mail Reports" },
  ],
  system: [
    { id: "seed", label: "Seed Database" },
    { id: "universal-seeder", label: "Universal Seeder" },
    { id: "reset", label: "Game Reset" },
    { id: "post-reset", label: "Post Reset Checklist" },
    { id: "heal", label: "Heal" },
    { id: "game-health", label: "Game Health" },
    { id: "code-quality", label: "Code Quality" },
    { id: "integrations", label: "Integrations" },
    { id: "observability", label: "Observability" },
  ],
};

/** Default sub-tab per main tab ("" = tab has no sub-tabs). */
export const DEFAULT_SUBS: Record<MainTabId, string> = {
  dashboard: "",
  traffic: "",
  politics: "elections",
  economy: "central-banks",
  world: "demographics",
  content: "wiki",
  players: "users",
  support: "suggestions",
  system: "seed",
};

/** Heal categories (third navigation level under System → Heal, `?heal=` param).
 * Mirrors HEAL_CATEGORIES in AdminSystemTab. */
export const HEAL_CATEGORIES_NAV: readonly SubTabConfig[] = [
  { id: "elections", label: "Elections" },
  { id: "officials", label: "Officials & Government" },
  { id: "parties", label: "Parties & Membership" },
  { id: "corporations", label: "Corporations" },
  { id: "data", label: "Economy & Data" },
];

/** Grouped sub-navigation for the desktop side panel. Every id must exist in
 * SUB_TABS_BY_TAB for the same tab, and every sub-tab must appear exactly once
 * — `adminTabsConfig.test.ts` enforces both. Tabs without sub-tabs are absent. */
export interface SubNavGroup {
  /** Group heading; null renders the items without a heading. */
  label: string | null;
  ids: string[];
}

export const SUB_GROUPS_BY_TAB: Partial<Record<MainTabId, readonly SubNavGroup[]>> = {
  politics: [{ label: "Governing", ids: ["elections", "parties", "legislation", "law-types"] }],
  economy: [
    { label: "Monetary", ids: ["central-banks", "inflation", "forex", "command-economy"] },
    {
      label: "Markets",
      ids: ["stock-market", "bonds", "commodities", "index-funds", "financial-ledger"],
    },
    {
      label: "Corporate",
      ids: ["corporations", "labour", "market", "sector-seed", "resource-capacity", "extraction"],
    },
    { label: "Fiscal", ids: ["budgets", "npp-economy"] },
  ],
  world: [
    { label: "Population", ids: ["demographics", "npps", "politicians"] },
    { label: "Events", ids: ["crises", "events", "conflicts"] },
    { label: "Setup", ids: ["countries"] },
  ],
  content: [{ label: "Publishing", ids: ["wiki", "wiki-review", "roadmap"] }],
  players: [
    {
      label: "Accounts",
      ids: ["users", "resources", "achievements", "characters", "patreon", "banner-ads"],
    },
    {
      label: "Monitoring",
      ids: ["activity-log", "suspicious", "alts", "forensics", "dossier", "watchlist"],
    },
    { label: "Moderation", ids: ["moderators", "mod-audit-log", "ip-bans"] },
    { label: "API", ids: ["api-keys", "api-abuse"] },
  ],
  support: [
    { label: "Queues", ids: ["suggestions", "mail-reports", "feedback"] },
    { label: "Ops", ids: ["logs", "debug", "migrations"] },
  ],
  system: [
    { label: "Seeding", ids: ["seed", "universal-seeder", "reset", "post-reset"] },
    { label: "Repair", ids: ["heal"] },
    { label: "Health", ids: ["game-health", "code-quality"] },
    { label: "Ops", ids: ["integrations", "observability"] },
  ],
};

/** One jumpable destination for the admin command palette. */
export interface AdminDestination {
  /** Group label shown in the palette result row (main-tab label). */
  group: string;
  label: string;
  tab: MainTabId;
  sub?: string;
  /** Extra query params beyond tab/sub (e.g. heal category). */
  params?: Record<string, string>;
  /** Additional match terms beyond the visible label. */
  keywords?: string;
}

/** Flat destination index for the ⌘K palette: every main tab, every sub-tab,
 * and the heal categories under System → Heal. */
export function getAdminDestinations(): AdminDestination[] {
  const dests: AdminDestination[] = [];
  for (const tab of MAIN_TABS) {
    dests.push({ group: tab.label, label: tab.label, tab: tab.id });
    for (const sub of SUB_TABS_BY_TAB[tab.id]) {
      dests.push({ group: tab.label, label: sub.label, tab: tab.id, sub: sub.id });
    }
  }
  for (const cat of HEAL_CATEGORIES_NAV) {
    dests.push({
      group: "System",
      label: `Heal · ${cat.label}`,
      tab: "system",
      sub: "heal",
      params: { heal: cat.id },
      keywords: "repair fix",
    });
  }
  return dests;
}

export function getSubTabLabel(tab: MainTabId, sub: string): string {
  return SUB_TABS_BY_TAB[tab].find((s) => s.id === sub)?.label ?? sub;
}

/** Map legacy tab param to new tab + sub for backward compatibility */
export function resolveLegacyTab(tabParam: string | null): { tab: MainTabId; sub?: string } | null {
  if (!tabParam) return null;
  const legacyMap: Record<string, { tab: MainTabId; sub: string }> = {
    // Old main tabs
    main: { tab: "dashboard", sub: "" },
    game: { tab: "politics", sub: "elections" }, // Default game to politics

    // Politics mappings
    elections: { tab: "politics", sub: "elections" },
    legislation: { tab: "politics", sub: "legislation" },
    "law-types": { tab: "politics", sub: "law-types" },

    // World mappings
    demographics: { tab: "world", sub: "demographics" },
    "party-org": { tab: "politics", sub: "parties" }, // Moved to Politics
    npps: { tab: "world", sub: "npps" },
    politicians: { tab: "world", sub: "politicians" }, // Assuming new sub

    // Economy mappings
    "central-banks": { tab: "economy", sub: "central-banks" },
    inflation: { tab: "economy", sub: "inflation" },
    "command-economy": { tab: "economy", sub: "command-economy" },
    "stock-market": { tab: "economy", sub: "stock-market" },
    forex: { tab: "economy", sub: "forex" },
    corporations: { tab: "economy", sub: "corporations" },
    bonds: { tab: "economy", sub: "bonds" },
    commodities: { tab: "economy", sub: "commodities" },
    budgets: { tab: "economy", sub: "budgets" },
    "npp-economy": { tab: "economy", sub: "npp-economy" },
    "index-funds": { tab: "economy", sub: "index-funds" },
    "financial-ledger": { tab: "economy", sub: "financial-ledger" },

    // Players mappings
    users: { tab: "players", sub: "users" },
    achievements: { tab: "players", sub: "achievements" },
    resources: { tab: "players", sub: "resources" },
    patreon: { tab: "players", sub: "patreon" },
    alts: { tab: "players", sub: "alts" },
    forensics: { tab: "players", sub: "forensics" },

    // Content mappings
    wiki: { tab: "content", sub: "wiki" },
    roadmap: { tab: "content", sub: "roadmap" },

    // Support mappings
    suggestions: { tab: "support", sub: "suggestions" },
    feedback: { tab: "support", sub: "feedback" },
    logs: { tab: "support", sub: "logs" },

    // System mappings
    reset: { tab: "system", sub: "reset" },
    seed: { tab: "system", sub: "seed" },
    heal: { tab: "system", sub: "heal" },
  };
  return legacyMap[tabParam] ?? null;
}
