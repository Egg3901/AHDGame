import type { ChangelogBadge, DevArea } from "@/lib/changelog/types";

/**
 * Both maps are keyed by the full union, so adding a value to BADGE_VALUES or
 * AREA_VALUES fails the build here until it has a label and a colour. That is
 * deliberate: it is what stops a newly accepted value from rendering as an
 * unstyled chip. The feed's filter pills are built from these maps for the same
 * reason, so a value can never be filterable but unstyled, or styled but
 * unfilterable.
 */

export const BADGE_STYLES: Record<ChangelogBadge, { label: string; classes: string }> = {
  major: {
    label: "Major",
    classes: "bg-primary/15 text-primary border-primary/30",
  },
  minor: {
    label: "Minor",
    classes: "bg-sky-500/10 text-sky-300 border-sky-500/25",
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
  engine: {
    label: "Engine",
    classes: "bg-amber-500/10 text-amber-400 border-amber-500/25",
  },
};

export const TAG_CHIP_CLASSES =
  "rounded-full border border-card-border bg-background px-2 py-0.5 text-xs font-medium text-muted";
