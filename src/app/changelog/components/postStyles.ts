import type { ChangelogBadge, DevArea } from "@/lib/changelog/types";

export const BADGE_STYLES: Record<ChangelogBadge, { label: string; classes: string }> = {
  major: {
    label: "Major",
    classes: "bg-primary/15 text-primary border-primary/30",
  },
  patch: {
    label: "Patch",
    classes: "bg-blue-500/10 text-blue-300 border-blue-500/25",
  },
  hotfix: {
    label: "Hotfix",
    classes: "bg-orange-500/10 text-orange-300 border-orange-500/25",
  },
};

export const AREA_STYLES: Record<DevArea, { label: string; classes: string }> = {
  backend: {
    label: "Backend",
    classes: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
  },
  frontend: {
    label: "Frontend",
    classes: "bg-blue-500/10 text-blue-400 border-blue-500/25",
  },
  fullstack: {
    label: "Full-stack",
    classes: "bg-violet-500/10 text-violet-400 border-violet-500/25",
  },
};

export const TAG_CHIP_CLASSES =
  "rounded-full border border-card-border bg-background px-2 py-0.5 text-xs font-medium text-muted";
