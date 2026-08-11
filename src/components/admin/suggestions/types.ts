export interface SuggestionAdminItem {
  id: string;
  issueNumber: number;
  category: string;
  gameSystem: string;
  title: string;
  status: string;
  priority?: number;
  screenshotUrl?: string;
  commentCount: number;
  unreadCommentCount?: number;
  reporterUsername: string | null;
  reporterDiscordUsername?: string | null;
  reporterCharacterName?: string | null;
  githubIssueUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SuggestionAdminDetail {
  id: string;
  issueNumber: number;
  category: string;
  gameSystem: string;
  title: string;
  description: string;
  impact?: string | null;
  priority?: number | null;
  status: string;
  adminNotes?: string;
  screenshotUrl?: string | null;
  githubIssueUrl?: string | null;
  githubIssueNumber?: number | null;
  commentCount: number;
  context: Record<string, unknown>;
  reporterUsername?: string | null;
  reporterDiscordUsername?: string | null;
  reporterCharacterName?: string | null;
  createdAt: string;
  updatedAt: string;
  statusChangedAt?: string;
}

export type SuggestionStatusKey =
  "not_reviewed" | "planned" | "in_progress" | "completed" | "not_implementing";

export const STAGES: {
  key: SuggestionStatusKey;
  label: string;
  color: string;
  dot: string;
}[] = [
  {
    key: "not_reviewed",
    label: "Not reviewed",
    color: "bg-amber-500/20 text-amber-400",
    dot: "bg-amber-400",
  },
  {
    key: "planned",
    label: "Planned",
    color: "bg-violet-500/20 text-violet-400",
    dot: "bg-violet-400",
  },
  {
    key: "in_progress",
    label: "In progress",
    color: "bg-blue-500/20 text-blue-400",
    dot: "bg-blue-400",
  },
  {
    key: "completed",
    label: "Completed",
    color: "bg-green-500/20 text-green-400",
    dot: "bg-green-400",
  },
  {
    key: "not_implementing",
    label: "Not implementing",
    color: "bg-muted/20 text-muted",
    dot: "bg-muted",
  },
];

export const STATUS_OPTIONS = [
  { value: "not_reviewed", label: "Not reviewed" },
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "not_implementing", label: "Not implementing" },
] as const;

export const STATUS_COLORS: Record<string, string> = {
  not_reviewed: "bg-amber-500/20 text-amber-400",
  planned: "bg-violet-500/20 text-violet-400",
  in_progress: "bg-blue-500/20 text-blue-400",
  completed: "bg-green-500/20 text-green-400",
  not_implementing: "bg-muted/20 text-muted",
};

export const PAGE_SIZE = 15;

export function priorityLabel(value: number | undefined): string | null {
  if (value == null) return null;
  return `Pri ${value}/5`;
}

export function priorityColor(value: number | undefined): string {
  if (value == null) return "";
  if (value >= 4) return "text-red-400";
  if (value >= 3) return "text-amber-400";
  return "text-muted";
}
