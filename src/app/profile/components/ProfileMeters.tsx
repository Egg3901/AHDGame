import type { ReactNode } from "react";

/**
 * Section heading for the profile pages, with an optional action on the right.
 * Sections are separated by spacing, not rules or cards. `main` headings carry
 * the page's primary blocks; `aside` headings are smaller so the side column
 * reads as secondary. Headings are never muted.
 */
export function SectionHeader({
  children,
  action,
  level = "main",
}: {
  children: ReactNode;
  action?: ReactNode;
  level?: "main" | "aside";
}) {
  return (
    <div
      className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 ${
        level === "main" ? "mb-4" : "mb-3"
      }`}
    >
      <h2
        className={
          level === "main"
            ? "text-heading-lg font-semibold tracking-tight text-foreground"
            : "text-body-lg font-semibold text-foreground"
        }
      >
        {children}
      </h2>
      {action}
    </div>
  );
}
