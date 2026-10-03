import type { ReactNode } from "react";

/**
 * Shared layout pieces for the central bank page. Sections are set apart by a
 * heading and spacing, not by cards or boxes inside boxes. `main` headings
 * carry the primary blocks of a tab; `aside` headings are smaller so the side
 * column reads as secondary. Headings are never muted.
 */
export function CentralBankSection({
  title,
  meta,
  action,
  level = "main",
  className = "",
  children,
}: {
  title: ReactNode;
  /** Short muted line under the heading (units, period, what the figures mean). */
  meta?: ReactNode;
  /** Right-aligned control or link beside the heading. */
  action?: ReactNode;
  level?: "main" | "aside";
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`min-w-0 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2
          className={
            level === "main"
              ? "break-words text-heading-lg font-semibold tracking-tight text-foreground"
              : "break-words text-body-lg font-semibold text-foreground"
          }
        >
          {title}
        </h2>
        {action}
      </div>
      {meta != null && <div className="mt-1 text-body-sm text-muted">{meta}</div>}
      <div className={level === "main" ? "mt-4" : "mt-3"}>{children}</div>
    </section>
  );
}

/** A labelled figure: a small muted label over a larger foreground value. */
export function CentralBankFigure({
  label,
  value,
  hint,
  valueClassName = "text-foreground",
  size = "md",
}: {
  label: ReactNode;
  value: ReactNode;
  /** Small muted line under the value (period, unit, basis). */
  hint?: ReactNode;
  valueClassName?: string;
  size?: "md" | "lg";
}) {
  return (
    <div className="min-w-0">
      <div className="text-body-sm text-muted">{label}</div>
      <div
        className={`mt-1 break-words font-semibold tabular-nums ${
          size === "lg" ? "text-heading" : "text-body-lg"
        } ${valueClassName}`}
      >
        {value}
      </div>
      {hint != null && <div className="mt-0.5 text-body-sm text-muted">{hint}</div>}
    </div>
  );
}

/** Table header cell: sentence case, small and muted, no spaced capitals. */
export const CB_TH =
  "border-b border-card-border pb-2 pr-4 text-left text-body-sm font-medium text-muted";

/** A muted label-and-value line, for short lists of figures. */
export function CentralBankRow({
  label,
  value,
  note,
  valueClassName = "text-foreground",
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-card-border/60 py-2 last:border-b-0">
      <div className="min-w-0">
        <p className="text-body text-foreground">{label}</p>
        {note != null && <p className="text-body-sm text-muted">{note}</p>}
      </div>
      <span className={`shrink-0 text-body font-semibold tabular-nums ${valueClassName}`}>
        {value}
      </span>
    </div>
  );
}
