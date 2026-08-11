"use client";

import Link from "next/link";

export interface TocHeading {
  id: string;
  text: string;
  level: number;
}

export function WikiTableOfContents({
  headings,
  className = "",
}: {
  headings: TocHeading[];
  className?: string;
}) {
  if (headings.length === 0) return null;

  return (
    <nav
      aria-label="Table of contents"
      className={`rounded-xl border border-card-border bg-card p-4 ${className}`}
    >
      <div className="mb-3 flex items-center gap-2">
        <svg
          className="h-3.5 w-3.5 text-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
        </svg>
        <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">Contents</h2>
      </div>
      <ul className="space-y-1.5 text-sm">
        {headings.map((h) => (
          <li key={h.id} className={h.level === 3 ? "ml-4" : ""}>
            <Link href={`#${h.id}`} className="text-muted transition-colors hover:text-primary">
              {h.text}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
