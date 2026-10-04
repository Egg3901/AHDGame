"use client";

interface SectionLabelProps {
  children: React.ReactNode;
  as?: "h2" | "h3" | "h4" | "p" | "span";
  className?: string;
}

/** Callers that pass their own bottom margin replace the default one. */
const MARGIN_OVERRIDE = /(^|\s)(m|my|mb)-/;

export function SectionLabel({ children, as: Tag = "h2", className }: SectionLabelProps) {
  const margin = className && MARGIN_OVERRIDE.test(className) ? "" : "mb-3";
  return (
    <Tag className={`text-sm font-semibold text-muted ${margin} ${className ?? ""}`.trim()}>
      {children}
    </Tag>
  );
}
