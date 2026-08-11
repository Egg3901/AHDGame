/**
 * RailItem — a single row in the inbox rail list.
 * Branches on item.kind: mail items show Avatar, notif items show CatChip.
 * Selected row gets a 3px primary left spine + bg-card-elevated + border-primary/45.
 */

"use client";

import type { InboxItem } from "@/lib/inbox/inboxItem";
import { Avatar } from "./Avatar";
import { CatChip } from "./CatChip";

interface RailItemProps {
  item: InboxItem;
  selected: boolean;
  compact: boolean;
  onSelect: () => void;
}

export function RailItem({ item, selected, compact, onSelect }: RailItemProps) {
  const eyebrow =
    item.kind === "mail"
      ? (item.counterpartName ?? "Mail")
      : item.category.charAt(0).toUpperCase() + item.category.slice(1);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "group relative w-full text-left transition-colors",
        "motion-reduce:transition-none",
        compact ? "py-2 px-3" : "py-3 px-4",
        selected
          ? "bg-card-elevated border-l-[3px] border-l-primary"
          : "border-l-[3px] border-l-transparent hover:bg-card-elevated/50",
        "border-b border-card-border",
        // Right border to show selection ring
        selected ? "border-r border-r-primary/45" : "border-r border-r-transparent",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-current={selected ? "true" : undefined}
    >
      <div className="flex items-start gap-3">
        {/* Lead icon */}
        <div className="mt-0.5 shrink-0">
          {item.kind === "mail" ? (
            <Avatar name={item.counterpartName ?? "?"} />
          ) : (
            <CatChip category={item.category} />
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          {/* Eyebrow + time row */}
          <div className="flex items-center justify-between gap-1">
            <span className="truncate text-[10px] font-medium uppercase tracking-wider text-muted">
              {eyebrow}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-muted tabular-nums">
              {item.time}
            </span>
          </div>

          {/* Title row */}
          <div className="mt-0.5 flex items-center gap-1.5">
            {item.unread && (
              <span
                className="mt-px h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                aria-label="Unread"
              />
            )}
            <p
              className={[
                "truncate text-sm leading-snug",
                item.unread ? "font-semibold text-foreground" : "font-normal text-muted",
              ].join(" ")}
            >
              {item.title}
            </p>
          </div>

          {/* Preview or action flag */}
          {!compact && (
            <div className="mt-0.5">
              {item.action ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-error">
                  <span className="h-1.5 w-1.5 rounded-full bg-error" aria-hidden="true" />
                  Needs you
                </span>
              ) : (
                <p className="truncate text-xs text-muted">{item.body}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
