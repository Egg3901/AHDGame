import type { ReactNode } from "react";

/**
 * Heading for a section of the landing drawer: 24px semibold in the foreground,
 * so each section reads as a step in the page without a label above it or a
 * box around it.
 */
export function LandingSectionHeading({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-heading-lg font-semibold tracking-tight text-foreground">
      {children}
    </h2>
  );
}

/** Class for a plain text link inside a landing section. */
export const LANDING_TEXT_LINK_CLASS =
  "font-medium text-foreground underline decoration-card-border underline-offset-4 transition-colors hover:decoration-foreground";
