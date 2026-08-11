"use client";

/**
 * Small shared building blocks for the character creator. Kept local to the
 * route: these are creator-specific compositions of existing tokens, not
 * candidates for `@/components/ui`.
 */

import type { ReactNode } from "react";

/** Uppercase field caption used above every control in the creator. */
export function FieldCaption({
  children,
  required,
  hint,
}: {
  children: ReactNode;
  required?: boolean;
  hint?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <span className="text-body-xs font-semibold uppercase tracking-[0.14em] text-muted">
        {children}
        {required && <span className="text-error"> *</span>}
      </span>
      {hint && <span className="text-body-xs text-muted/70">{hint}</span>}
    </div>
  );
}

/**
 * A numbered step panel.
 *
 * The marker always carries the step number. It used to swap the number for a
 * tick once the step was complete, which made the creator read "1, 2, 3, ✓, ✓,
 * 6": the player could no longer tell which step they were looking at, or how
 * many there were. Completion is now a state of the number (success colouring
 * plus a "Done" tag), not a replacement for it.
 */
export function StepPanel({
  step,
  title,
  subtitle,
  complete,
  disabled,
  children,
}: {
  step: number;
  title: string;
  subtitle?: string;
  complete?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`creator-step-${step}`}
      className={`rounded-lg border bg-card shadow-card transition-opacity ${
        disabled ? "pointer-events-none border-card-border/50 opacity-45" : "border-card-border"
      }`}
    >
      <header className="flex items-start gap-3 border-b border-card-border/70 px-4 py-3">
        <span
          aria-hidden
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border font-mono text-body-xs font-bold ${
            complete
              ? "border-success/40 bg-success/10 text-success"
              : "border-card-border bg-card-muted text-muted"
          }`}
        >
          {step}
        </span>
        <div className="min-w-0">
          <h2
            id={`creator-step-${step}`}
            className="flex flex-wrap items-baseline gap-2 text-heading-sm font-semibold leading-tight"
          >
            {title}
            {complete && (
              <span className="rounded border border-success/40 bg-success/10 px-1.5 font-mono text-body-xs font-semibold uppercase tracking-[0.1em] text-success">
                Done
              </span>
            )}
          </h2>
          {subtitle && <p className="mt-0.5 text-body-sm text-muted">{subtitle}</p>}
        </div>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Single-select chip row — replaces the creator's native `<select>` fields. */
export function ChipGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  required,
  hint,
}: {
  label: string;
  /** Current selection. Plain `string` so callers can pass raw form state. */
  value: string;
  options: { value: T; label: string; note?: string }[];
  onChange: (value: T) => void;
  required?: boolean;
  hint?: ReactNode;
}) {
  return (
    <fieldset>
      <legend className="contents">
        <FieldCaption required={required} hint={hint}>
          {label}
        </FieldCaption>
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              aria-pressed={selected}
              className={`rounded border px-2.5 py-1.5 text-left text-body-sm transition-colors ${
                selected
                  ? "border-primary bg-primary/10 font-semibold text-foreground"
                  : "border-card-border bg-card-muted text-muted hover:border-primary/40 hover:text-foreground"
              }`}
            >
              <span className="block leading-tight">{opt.label}</span>
              {opt.note && (
                <span
                  className={`mt-0.5 block font-mono text-body-xs leading-tight ${
                    selected ? "text-foreground/70" : "text-muted/70"
                  }`}
                >
                  {opt.note}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
