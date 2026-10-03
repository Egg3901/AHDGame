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
  }
> = {
  crisis: {
    label: "Crisis",
    bar: "bg-error",
    wash: "bg-error/10",
    border: "border-error/30",
    text: "text-error",
  },
  legislation: {
    label: "Legislation",
    bar: "bg-primary",
    wash: "bg-primary/10",
    border: "border-primary/30",
    text: "text-primary",
  },
  election: {
    label: "Election",
    bar: "bg-secondary",
    wash: "bg-secondary/10",
    border: "border-secondary/30",
    text: "text-secondary",
  },
  party: {
    label: "Party",
    bar: "bg-warning",
    wash: "bg-warning/10",
    border: "border-warning/30",
    text: "text-warning",
  },
  standing: {
    label: "Standing",
    bar: "bg-success",
    wash: "bg-success/10",
    border: "border-success/30",
    text: "text-success",
  },
  treasury: {
    label: "Treasury",
    bar: "bg-info",
    wash: "bg-info/10",
    border: "border-info/30",
    text: "text-info",
  },
  system: {
    label: "System",
    bar: "bg-muted",
    wash: "bg-card-elevated",
    border: "border-card-border",
    text: "text-muted",
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
