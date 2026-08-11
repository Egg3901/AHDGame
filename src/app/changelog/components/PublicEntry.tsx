"use client";

import { useState } from "react";
import type { ChangelogEntry } from "../changelogTypes";
import { CATEGORY_META } from "../changelogTypes";
import { formatDate } from "../changelogUtils";

interface PublicEntryProps {
  entry: ChangelogEntry;
  isLatest: boolean;
  startExpanded: boolean;
}

function renderItem(item: string, j: number) {
  const dashIdx = item.indexOf(" \u2014 ");
  return (
    <li key={j} className="text-sm leading-relaxed text-muted">
      <span className="mr-1.5 text-card-border">&#x2022;</span>
      {dashIdx > -1 ? (
        <>
          <span className="font-medium text-foreground">{item.slice(0, dashIdx)}</span>
          <span> &mdash; {item.slice(dashIdx + 3)}</span>
        </>
      ) : (
        <span>{item}</span>
      )}
    </li>
  );
}

export function PublicEntry({ entry, isLatest, startExpanded }: PublicEntryProps) {
  const [expanded, setExpanded] = useState(startExpanded);
  const hasCategories = entry.categories.length > 0;
  const totalItems = entry.items.length;

  return (
    <div className="relative pl-8">
      {/* Timeline dot */}
      <div
        className={`absolute left-0 top-1.5 h-[15px] w-[15px] rounded-full border-2 ${
          isLatest ? "border-primary bg-primary/20" : "border-card-border bg-card"
        }`}
      />

      {/* Version header — clickable to expand/collapse */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="mb-2 flex w-full items-center gap-3 text-left"
      >
        <span
          className={`text-base font-semibold ${isLatest ? "text-primary" : "text-foreground"}`}
        >
          {entry.version}
        </span>
        <span className="text-xs text-muted">{formatDate(entry.date)}</span>
        <span className="text-xs text-muted">
          {totalItems} change{totalItems !== 1 ? "s" : ""}
        </span>
        {isLatest && (
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
            Latest
          </span>
        )}
        <svg
          className={`ml-auto h-4 w-4 shrink-0 text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Category summary pills (visible when collapsed) */}
      {hasCategories && !expanded && (
        <div className="mb-1 flex flex-wrap gap-1.5">
          {entry.categories.map((cat, idx) => {
            const meta = CATEGORY_META[cat.name];
            const count = cat.subcategories.reduce((s, sub) => s + sub.items.length, 0);
            return (
              // Composite key — category headings repeat within a single
              // version (e.g. two `### Mechanics` blocks split by other
              // content in some long releases), so `cat.name` alone collides.
              <span
                key={`${cat.name}-${idx}`}
                className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                  meta
                    ? `${meta.bg} ${meta.color} ${meta.border}`
                    : "bg-card text-muted border-card-border"
                }`}
              >
                {meta?.icon} {cat.name} ({count})
              </span>
            );
          })}
        </div>
      )}

      {/* Expanded content */}
      {expanded && (
        <>
          {hasCategories ? (
            <div className="space-y-4">
              {entry.categories.map((cat, idx) => {
                const meta = CATEGORY_META[cat.name];
                return (
                  <div key={`${cat.name}-${idx}`}>
                    {/* Category heading */}
                    <div className="mb-2 flex items-center gap-2">
                      {meta && <span className="text-sm">{meta.icon}</span>}
                      <span
                        className={`text-xs font-bold uppercase tracking-wider ${meta?.color ?? "text-muted"}`}
                      >
                        {cat.name}
                      </span>
                      <span className="h-px flex-1 bg-card-border" />
                    </div>

                    {/* Subcategories */}
                    <div className="space-y-3 pl-1">
                      {cat.subcategories.map((sub, si) => (
                        <div key={si}>
                          {sub.name && (
                            <div className="mb-1 text-xs font-semibold text-foreground/70">
                              {sub.name}
                            </div>
                          )}
                          <ul className="space-y-1.5">
                            {sub.items.map((item, j) => renderItem(item, j))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Legacy flat list for older versions without categories */
            <ul className="space-y-1.5">{entry.items.map((item, j) => renderItem(item, j))}</ul>
          )}
        </>
      )}
    </div>
  );
}
