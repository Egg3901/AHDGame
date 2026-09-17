/**
 * RailItem — a single row in the inbox rail list.
 * Branches on item.kind: mail items show Avatar, notif items show CatChip.
 * Selected row gets a 3px primary left spine + bg-card-elevated + border-primary/45.
 */

"use client";

import type { InboxItem } from "@/lib/inbox/inboxItem";
import { Avatar } from "./Avatar";
import { CatChip } from "./CatChip";
import { CATEGORY_VISUALS, URGENCY_VISUALS } from "./inboxVisuals";

interface RailItemProps {
  item: InboxItem;
  selected: boolean;
  compact: boolean;
  onSelect: () => void;
}

export function RailItem({ item, selected, compact, onSelect }: RailItemProps) {
  const category = CATEGORY_VISUALS[item.category];
  const urgency = URGENCY_VISUALS[item.urgency];
  const eyebrow = item.label;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "group relative w-full overflow-hidden text-left transition-colors",
        "motion-reduce:transition-none",
        compact ? "py-2.5 px-3" : "py-4 px-4",
        selected
          ? `bg-card-elevated ${category.border}`
          : "border-b border-card-border hover:bg-card-elevated/50",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-current={selected ? "true" : undefined}
    >
      <span
        className={`absolute inset-y-0 left-0 w-1 ${category.bar} ${item.unread ? "opacity-100" : "opacity-35"}`}
        aria-hidden="true"
      />

      <div className="flex items-start gap-3 pl-1">
        {/* Lead icon */}
        <div className="mt-0.5 shrink-0">
          {item.kind === "mail" ? (
            <Avatar name={item.counterpartName ?? "?"} />
          ) : (
            <CatChip category={item.category} size={compact ? "sm" : "md"} />
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          {/* Type + time row */}
          <div className="flex items-center gap-2">
            <span
              className={`truncate text-[10px] font-bold uppercase tracking-[0.14em] ${category.text}`}
            >
              {eyebrow}
            </span>
            {item.kind === "mail" && item.counterpartName && (
              <span className="truncate text-[10px] text-muted">from {item.counterpartName}</span>
            )}
            <span className="ml-auto shrink-0 font-mono text-[10px] text-muted tabular-nums">
              {item.time}
            </span>
          </div>

          {/* Title row */}
          <div className="mt-1 flex items-start gap-1.5">
            {item.unread && (
              <span
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${category.bar}`}
                aria-label="Unread"
              />
            )}
            <p
              className={[
                "line-clamp-2 text-sm leading-snug",
                item.unread ? "font-semibold text-foreground" : "font-normal text-muted",
              ].join(" ")}
            >
              {item.title}
            </p>
          </div>

          {/* Preview and signal */}
          {!compact && (
            <div className="mt-2 space-y-2">
              <p className="line-clamp-2 text-xs leading-relaxed text-muted">{item.body}</p>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${item.action ? URGENCY_VISUALS[item.urgency].wash : urgency.wash} ${item.action ? URGENCY_VISUALS[item.urgency].border : urgency.border} ${item.action ? URGENCY_VISUALS[item.urgency].text : urgency.text}`}
                >
                  {item.action ? "Needs you" : urgency.label}
                </span>
                {item.meta?.[0] && (
                  <span className="truncate text-[10px] text-muted">
                    <span className="font-medium text-foreground/70">{item.meta[0][0]}:</span>{" "}
                    {item.meta[0][1]}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
