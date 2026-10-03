import type { ReactNode } from "react";

/**
 * The one section heading on the profile pages: a sans, sentence-case title
 * over a hairline rule, with an optional action on the right. Sections are
 * grouped by this heading and spacing, not by cards.
 */
export function SectionHeader({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-card-border pb-2">
      <h2 className="text-heading-sm font-semibold text-foreground">{children}</h2>
      {action}
    </div>
  );
}
