/**
 * CatChip — category icon chip for the unified Inbox rail.
 * Maps one of the 6 player-facing InboxCategory values to a tone colour + icon.
 * Icons are reused from TYPE_CONFIG in notificationConfig.tsx (representative type per category).
 */

import type { InboxCategory } from "@/lib/inbox/categories";

type ChipConfig = {
  bg: string;
  text: string;
  label: string;
  icon: React.ReactNode;
};

// Representative icon paths per category, reused from TYPE_CONFIG
const CRISIS_ICON = (
  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
    />
  </svg>
);

const LEGISLATION_ICON = (
  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
    />
  </svg>
);

const ELECTION_ICON = (
  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
    />
  </svg>
);

const PARTY_ICON = (
  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
    />
  </svg>
);

const STANDING_ICON = (
  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
    />
  </svg>
);

const TREASURY_ICON = (
  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const SYSTEM_ICON = (
  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const CHIP_CONFIG: Record<InboxCategory, ChipConfig> = {
  crisis: {
    bg: "bg-error/10",
    text: "text-error",
    label: "Crisis",
    icon: CRISIS_ICON,
  },
  legislation: {
    bg: "bg-primary/10",
    text: "text-primary",
    label: "Legislation",
    icon: LEGISLATION_ICON,
  },
  election: {
    bg: "bg-secondary/10",
    text: "text-secondary",
    label: "Election",
    icon: ELECTION_ICON,
  },
  party: {
    bg: "bg-warning/10",
    text: "text-warning",
    label: "Party",
    icon: PARTY_ICON,
  },
  standing: {
    bg: "bg-success/10",
    text: "text-success",
    label: "Standing",
    icon: STANDING_ICON,
  },
  treasury: {
    bg: "bg-info/10",
    text: "text-info",
    label: "Treasury",
    icon: TREASURY_ICON,
  },
  system: {
    bg: "bg-card-border/50",
    text: "text-muted",
    label: "System",
    icon: SYSTEM_ICON,
  },
};

interface CatChipProps {
  category: InboxCategory;
  /** Optionally override with a custom icon */
  icon?: React.ReactNode;
  className?: string;
}

export function CatChip({ category, icon, className }: CatChipProps) {
  const cfg = CHIP_CONFIG[category] ?? CHIP_CONFIG.system;
  return (
    <span
      className={[
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
        cfg.bg,
        cfg.text,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      title={cfg.label}
      aria-label={cfg.label}
    >
      {icon ?? cfg.icon}
    </span>
  );
}
