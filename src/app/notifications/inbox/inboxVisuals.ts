import type { InboxCategory } from "@/lib/inbox/categories";
import type { InboxUrgency } from "@/lib/inbox/presentation";

export const CATEGORY_VISUALS: Record<
  InboxCategory,
  {
    label: string;
    bar: string;
    wash: string;
    border: string;
    text: string;
    gradient: string;
  }
> = {
  crisis: {
    label: "Crisis",
    bar: "bg-error",
    wash: "bg-error/10",
    border: "border-error/30",
    text: "text-error",
    gradient: "from-error/30 via-error/5 to-transparent",
  },
  legislation: {
    label: "Legislation",
    bar: "bg-primary",
    wash: "bg-primary/10",
    border: "border-primary/30",
    text: "text-primary",
    gradient: "from-primary/30 via-primary/5 to-transparent",
  },
  election: {
    label: "Election",
    bar: "bg-secondary",
    wash: "bg-secondary/10",
    border: "border-secondary/30",
    text: "text-secondary",
    gradient: "from-secondary/30 via-secondary/5 to-transparent",
  },
  party: {
    label: "Party",
    bar: "bg-warning",
    wash: "bg-warning/10",
    border: "border-warning/30",
    text: "text-warning",
    gradient: "from-warning/30 via-warning/5 to-transparent",
  },
  standing: {
    label: "Standing",
    bar: "bg-success",
    wash: "bg-success/10",
    border: "border-success/30",
    text: "text-success",
    gradient: "from-success/30 via-success/5 to-transparent",
  },
  treasury: {
    label: "Treasury",
    bar: "bg-info",
    wash: "bg-info/10",
    border: "border-info/30",
    text: "text-info",
    gradient: "from-info/30 via-info/5 to-transparent",
  },
  system: {
    label: "System",
    bar: "bg-muted",
    wash: "bg-card-elevated",
    border: "border-card-border",
    text: "text-muted",
    gradient: "from-muted/20 via-muted/5 to-transparent",
  },
};

export const URGENCY_VISUALS: Record<
  InboxUrgency,
  { label: string; wash: string; border: string; text: string }
> = {
  urgent: {
    label: "Urgent",
    wash: "bg-error/10",
    border: "border-error/30",
    text: "text-error",
  },
  decision: {
    label: "Needs decision",
    wash: "bg-warning/10",
    border: "border-warning/30",
    text: "text-warning",
  },
  social: {
    label: "Social",
    wash: "bg-secondary/10",
    border: "border-secondary/25",
    text: "text-secondary",
  },
  update: {
    label: "Update",
    wash: "bg-card-elevated",
    border: "border-card-border",
    text: "text-muted",
  },
};
