"use client";

import { useGameClock } from "@/contexts/useGameClock";

interface ClockDriftBannerProps {
  /**
   * Where the "investigate" link should point. Defaults to "/admin" but the
   * moderator panel mounts the banner with "/moderator" so the link routes
   * moderators to a page they actually have access to.
   */
  panelHref?: string;
  /** Human-readable label for the destination panel. Defaults to "admin panel". */
  panelLabel?: string;
}

/**
 * Banner that surfaces a cron-stall auto-pause to staff (admins + moderators).
 *
 * - pauseKind === "auto-drift" → red banner with reason + link
 * - otherwise renders null.
 *
 * Note: the old "game clock is behind real time" warn-drift banner was removed
 * once deadlines became turn-based (Phase 5) — a game-clock/wall-clock offset no
 * longer affects any deadline, so warning about it was misleading. The
 * cron-stall auto-pause (no turn completed in N hours) is a real failure and
 * keeps its banner.
 *
 * Mount inside a panel layout (admin or moderator) — it consumes useGameClock
 * so it stays in sync with the shared turn-status polling. Gate visibility to
 * staff at the mount-point layout rather than inside this component.
 */
export function ClockDriftBanner({
  panelHref = "/admin",
  panelLabel = "admin panel",
}: ClockDriftBannerProps = {}) {
  const clock = useGameClock();

  if (clock.pauseKind === "auto-drift") {
    return (
      <div className="border-l-4 border-error bg-error/10 text-error px-4 py-2 text-sm">
        <strong>Cron auto-paused.</strong>{" "}
        {clock.pauseReason ?? "Drift exceeded auto-pause threshold."}{" "}
        <a className="underline" href={panelHref}>
          Open {panelLabel} to investigate &rarr;
        </a>
      </div>
    );
  }

  return null;
}
