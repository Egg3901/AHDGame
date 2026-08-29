"use client";

import { useGameTurnStatus } from "@/hooks/useGameEvents";
import { rawTurnToLarpDate } from "@/lib/utils/formatters";
import { formatBadge } from "@/components/admin/nav/useAdminBadgeCounts";
import { LocalTime } from "@/components/time/LocalTime";

interface AdminStatusBarProps {
  /** Sum of all pending queue counts (0 hides the chip). */
  pendingTotal: number;
  onOpenPalette: () => void;
  /** Jump to the dashboard (Pending chip target is the queue rail there). */
  onGoDashboard: () => void;
}

/** Sticky at-a-glance strip under the global header: turn + LARP date, cron
 * state, pending-queue total, and the command-palette trigger. Reuses the
 * shared turn-status polling loop — no extra requests. */
export function AdminStatusBar({
  pendingTotal,
  onOpenPalette,
  onGoDashboard,
}: AdminStatusBarProps) {
  const status = useGameTurnStatus();

  const cron = !status
    ? null
    : status.isProcessing
      ? { label: "Processing…", cls: "text-info", dot: "bg-info animate-pulse" }
      : status.isActive
        ? { label: "Cron active", cls: "text-success", dot: "bg-success animate-pulse" }
        : status.pauseKind === "auto-drift"
          ? { label: "Auto-paused", cls: "text-error", dot: "bg-error" }
          : { label: "Cron paused", cls: "text-warning", dot: "bg-warning" };

  const nextTurn =
    status?.isActive && status.nextScheduledTurn ? new Date(status.nextScheduledTurn) : null;
  const nextTurnValid = nextTurn && !Number.isNaN(nextTurn.getTime());

  // top-14 tucks the strip's first few px under the sticky global navbar
  // (h-14 + flair/border ≈ 61px, z-50) so no scroll seam shows between them.
  return (
    <div className="z-30 border-b border-card-border bg-card/85 backdrop-blur lg:sticky lg:top-14">
      <div className="flex h-11 items-center gap-3 px-3 sm:gap-5 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden text-body-sm whitespace-nowrap sm:gap-5">
          {status && status.currentTurn > 0 ? (
            <>
              <span className="flex shrink-0 items-center gap-1.5">
                <span className="text-muted">Turn</span>
                <span className="font-mono font-semibold">
                  {status.currentTurn.toLocaleString("en-US")}
                </span>
                <span className="hidden text-muted sm:inline">
                  ·{" "}
                  {rawTurnToLarpDate(status.currentTurn, status.startingYear, {
                    preIterationTurns: status.preIterationTurns,
                  })}
                </span>
              </span>
              {cron && (
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${cron.dot}`} aria-hidden />
                  <span className={`font-semibold ${cron.cls}`}>{cron.label}</span>
                  {nextTurnValid && (
                    <span className="hidden text-muted md:inline">
                      · next{" "}
                      <LocalTime
                        value={nextTurn}
                        options={{ hour: "2-digit", minute: "2-digit" }}
                      />
                    </span>
                  )}
                </span>
              )}
              {status.fastMode && (
                <span className="hidden shrink-0 rounded bg-warning/15 px-1.5 py-px text-body-xs font-bold text-warning md:inline">
                  FAST
                </span>
              )}
            </>
          ) : (
            <span className="text-muted">Loading turn status…</span>
          )}
          {pendingTotal > 0 && (
            <button
              type="button"
              onClick={onGoDashboard}
              className="flex shrink-0 cursor-pointer items-center gap-1.5"
              title="Open pending queues on the dashboard"
            >
              <span className="text-muted">Pending</span>
              <span className="rounded bg-error/15 px-1.5 py-px font-mono text-body-xs font-semibold text-error">
                {formatBadge(pendingTotal)}
              </span>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onOpenPalette}
          className="hidden shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-card-border bg-card-muted/60 px-2.5 py-1.5 text-body-sm text-muted transition-colors hover:border-foreground/30 hover:text-foreground sm:flex sm:w-56"
          aria-label="Open command palette"
        >
          <SearchIcon />
          <span className="min-w-0 flex-1 truncate text-left">Jump to tab, tool…</span>
          <kbd className="rounded border border-card-border px-1 py-px font-mono text-body-xs">
            ⌘K
          </kbd>
        </button>
        <button
          type="button"
          onClick={onOpenPalette}
          className="flex shrink-0 cursor-pointer items-center rounded-lg border border-card-border p-2 text-muted transition-colors hover:text-foreground sm:hidden"
          aria-label="Open command palette"
        >
          <SearchIcon />
        </button>
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z"
      />
    </svg>
  );
}
