"use client";

import Link from "next/link";
import type { InboxItem } from "@/lib/inbox";
import { LocalTime } from "@/components/time/LocalTime";
import { Button } from "@/components/ui/Button";
import { CatChip } from "./CatChip";
import { CATEGORY_VISUALS, URGENCY_VISUALS } from "./inboxVisuals";

interface NotifDetailProps {
  item: InboxItem;
  onArchive: () => void;
  onSnooze: () => void;
}

export function NotifDetail({ item, onArchive, onSnooze }: NotifDetailProps) {
  const category = CATEGORY_VISUALS[item.category];
  const urgency = URGENCY_VISUALS[item.urgency];

  return (
    <div className="flex h-full flex-col">
      <div className={`h-1 shrink-0 bg-gradient-to-r ${category.gradient}`} />

      <div className="flex-1 overflow-y-auto p-5 sm:p-7">
        {/* Header row */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <CatChip category={item.category} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`text-[11px] font-bold uppercase tracking-[0.16em] ${category.text}`}
                >
                  {category.label}
                </span>
                <span className="text-muted/50">·</span>
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  {item.label}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                <span>{item.time === "now" ? "Just now" : `${item.time} ago`}</span>
                {item.turn && <span>· Turn {item.turn}</span>}
                {item.createdAt && (
                  <>
                    <span>·</span>
                    <LocalTime
                      value={item.createdAt}
                      options={{ dateStyle: "medium", timeStyle: "short" }}
                    />
                  </>
                )}
              </div>
            </div>
          </div>
          <span
            className={`hidden shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide sm:inline-flex ${urgency.wash} ${urgency.border} ${urgency.text}`}
          >
            {item.action ? "Needs your attention" : urgency.label}
          </span>
        </div>

        {/* Headline */}
        <div className={`mt-7 rounded-2xl border ${category.border} ${category.wash} p-5 sm:p-6`}>
          <h2 className="font-serif text-2xl font-semibold leading-tight text-foreground">
            {item.title}
          </h2>
          <p className="mt-4 whitespace-pre-wrap text-[15px] leading-7 text-foreground/85">
            {item.body}
          </p>
        </div>

        {/* Mobile urgency marker */}
        <div className="mt-4 sm:hidden">
          <span
            className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${urgency.wash} ${urgency.border} ${urgency.text}`}
          >
            {item.action ? "Needs your attention" : urgency.label}
          </span>
        </div>

        {/* Context strip */}
        {item.meta && item.meta.length > 0 && (
          <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {item.meta.map(([label, value]) => (
              <div
                key={label}
                className="min-w-0 rounded-xl border border-card-border bg-card-elevated/65 px-3.5 py-3"
              >
                <dt className="truncate text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                  {label}
                </dt>
                <dd className="mt-1 truncate text-sm font-semibold text-foreground" title={value}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {/* Source CTA */}
        {item.source && (
          <div className="mt-6 rounded-xl border border-primary/25 bg-primary/5 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/75">
              Continue the thread
            </p>
            <p className="mt-1 text-xs text-muted">
              {item.source.hint ?? "Open the relevant game screen to act on this update."}
            </p>
            <Link
              href={item.source.href}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
            >
              {item.source.label}
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </Link>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-card-border bg-card-elevated/25 px-5 py-3 sm:px-7">
        <Button variant="ghost" size="sm" onClick={onSnooze} aria-label="Snooze">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          Snooze
        </Button>
        <Button variant="ghost" size="sm" onClick={onArchive} aria-label="Archive">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
            />
          </svg>
          Archive
        </Button>
      </div>
    </div>
  );
}
