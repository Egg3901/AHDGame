"use client";

import Link from "next/link";
import type { InboxItem } from "@/lib/inbox";
import { CatChip } from "./CatChip";
import { Button } from "@/components/ui/Button";

interface NotifDetailProps {
  item: InboxItem;
  onArchive: () => void;
  onSnooze: () => void;
}

export function NotifDetail({ item, onArchive, onSnooze }: NotifDetailProps) {
  const eyebrow = [item.category.toUpperCase(), item.turn].filter(Boolean).join(" · ");

  return (
    <div className="flex h-full flex-col gap-5 p-6">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <CatChip category={item.category} />
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted">
            {eyebrow}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
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

      {/* Title */}
      <h2 className="font-serif text-xl font-semibold leading-snug text-foreground">
        {item.title}
      </h2>

      {/* Body */}
      <p className="text-sm leading-relaxed text-muted">{item.body}</p>

      {/* Metric strip */}
      {item.meta && item.meta.length > 0 && (
        <dl className="flex flex-wrap gap-x-6 gap-y-3 rounded-xl border border-card-border bg-card-elevated p-4">
          {item.meta.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                {label}
              </dt>
              <dd className="text-sm font-medium text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* Source CTA */}
      {item.source && (
        <div className="mt-auto">
          <Link
            href={item.source.href}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3.5 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
          >
            {item.source.label}
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
          {item.source.hint && <p className="mt-1.5 text-xs text-muted">{item.source.hint}</p>}
        </div>
      )}
    </div>
  );
}
