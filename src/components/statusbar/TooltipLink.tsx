// Small arrow link rendered at the bottom of each StatusBar chip tooltip.
// Extracted from src/components/StatusBar.tsx.

import Link from "next/link";
import type { ReactNode } from "react";

export function TooltipLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-1 pt-2 mt-1 border-t border-card-border/60 text-[11px] font-medium text-primary hover:underline"
    >
      <span>{children}</span>
      <svg
        className="h-3 w-3 shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}
