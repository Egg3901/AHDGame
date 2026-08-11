// Shared shell for StatusBar chips — InfoTooltip + colored button trigger.
// Caller passes color classes (so each chip's exact bg/text/hover combo is
// preserved verbatim), an optional icon, the value text/element to display,
// an aria-label, and the tooltip body as children.
//
// Replaces ~7-8 lines of repeated boilerplate per chip with a single typed
// call. The base button class string lives here so layout changes propagate
// without hunting through call sites.

import type { ReactNode } from "react";
import { InfoTooltip } from "@/components/InfoTooltip";

const BUTTON_BASE =
  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:gap-1.5 sm:px-2 sm:py-1 sm:text-xs";

interface StatusChipProps {
  /** Tailwind color classes for the button: bg, text, hover:bg. Caller-owned
   * so each chip can keep its exact shade (some chips use text-green-500,
   * others text-green-400). */
  colorClasses: string;
  /** Optional icon — typically <svg>. Caller controls breakpoint visibility
   * via icon className (e.g. `hidden sm:block`). */
  icon?: ReactNode;
  /** Trigger value text or element shown after the icon. */
  value: ReactNode;
  /** aria-label for the button trigger. */
  ariaLabel: string;
  /** Tooltip popover width. Default 220. */
  width?: number;
  /** Extra classes appended to the InfoTooltip wrapper (e.g.
   * `"hidden sm:inline-flex"` for desktop-only chips). */
  wrapperClassName?: string;
  /** Tooltip body content. */
  children: ReactNode;
}

export function StatusChip({
  colorClasses,
  icon,
  value,
  ariaLabel,
  width = 220,
  wrapperClassName,
  children,
}: StatusChipProps) {
  return (
    <InfoTooltip
      className={`cursor-pointer ${wrapperClassName ?? ""}`.trim()}
      width={width}
      trigger={
        <button type="button" className={`${BUTTON_BASE} ${colorClasses}`} aria-label={ariaLabel}>
          {icon}
          {value}
        </button>
      }
    >
      {children}
    </InfoTooltip>
  );
}
