export interface FeedbackItem {
  id: string;
  issueNumber: number;
  type: string;
  category: string;
  title: string;
  status: string;
  severity?: number;
  priority?: number;
  screenshotUrl?: string;
  reporterUsername: string | null;
  githubIssueUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackDetail {
  id: string;
  issueNumber: number;
  type: string;
  category: string;
  title: string;
  description: string;
  stepsToReproduce?: string;
  severity?: number;
  impact?: string;
  priority?: number;
  status: string;
  adminNotes?: string;
  githubIssueUrl?: string;
  githubIssueNumber?: number;
  screenshotUrl?: string;
  context: {
    pathname: string;
    url: string;
    capturedAt: string;
    lastAction?: { label: string };
    recentActions: Array<{ label: string }>;
    viewport: { width: number; height: number };
  };
  reporterUsername?: string | null;
  createdAt: string;
  updatedAt: string;
  statusChangedAt?: string;
}

export type StatusKey = "open" | "in_progress" | "resolved" | "wont_fix";

export const STAGES: { key: StatusKey; label: string; color: string; dot: string }[] = [
  { key: "open", label: "Open", color: "bg-amber-500/20 text-amber-400", dot: "bg-amber-400" },
  {
    key: "in_progress",
    label: "In Progress",
    color: "bg-blue-500/20 text-blue-400",
    dot: "bg-blue-400",
  },
  {
    key: "resolved",
    label: "Resolved",
    color: "bg-green-500/20 text-green-400",
    dot: "bg-green-400",
  },
  { key: "wont_fix", label: "Won't Fix", color: "bg-muted/20 text-muted", dot: "bg-muted" },
];

export const STATUS_COLORS: Record<string, string> = {
  open: "bg-amber-500/20 text-amber-400",
  in_progress: "bg-blue-500/20 text-blue-400",
  resolved: "bg-green-500/20 text-green-400",
  wont_fix: "bg-muted/20 text-muted",
};

export const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
  { value: "wont_fix", label: "Won't Fix" },
];

export const PAGE_SIZE = 15;

export function priorityLabel(value: number | undefined, type: string): string | null {
  if (value == null) return null;
  if (type === "bug") return `Sev ${value}/5`;
  return `Pri ${value}/5`;
}

export function priorityColor(value: number | undefined): string {
  if (value == null) return "";
  if (value >= 4) return "text-red-400";
  if (value >= 3) return "text-amber-400";
  return "text-muted";
}
