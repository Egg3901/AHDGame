import type { ReactNode } from "react";

export type ModTabId = "priority" | "players" | "transactions" | "content" | "site";

export interface ModTabConfig {
  id: ModTabId;
  label: string;
  icon: ReactNode;
}

const PriorityIcon = (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 9v2m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z"
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

const ContentIcon = (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"
    />
  </svg>
);

const TransactionsIcon = (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M17 9V7a5 5 0 00-10 0v2M5 9h14l-1 10H6L5 9zm4 4h6"
    />
  </svg>
);

const SiteIcon = (
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

export const MOD_TABS: ModTabConfig[] = [
  { id: "priority", label: "Priority", icon: PriorityIcon },
  { id: "players", label: "Players", icon: UsersIcon },
  { id: "transactions", label: "Transactions", icon: TransactionsIcon },
  { id: "content", label: "Content", icon: ContentIcon },
  { id: "site", label: "Site", icon: SiteIcon },
];

export const MOD_TAB_IDS: ModTabId[] = MOD_TABS.map((t) => t.id);

export type ModPlayersSubTab =
  "users" | "achievements" | "characters" | "patreon" | "activity-log" | "suspicious" | "audit-log";

export type ModContentSubTab =
  "news" | "banner-ads" | "wiki" | "wiki-review" | "supporter-requests" | "mail-reports";

export const VALID_MOD_SUBS: Record<ModTabId, string[]> = {
  priority: [],
  players: [
    "users",
    "achievements",
    "characters",
    "patreon",
    "activity-log",
    "suspicious",
    "audit-log",
  ],
  transactions: [],
  content: ["news", "banner-ads", "wiki", "wiki-review", "supporter-requests", "mail-reports"],
  site: [],
};

export const DEFAULT_MOD_SUBS: Record<ModTabId, string> = {
  priority: "",
  players: "users",
  transactions: "",
  content: "news",
  site: "",
};
