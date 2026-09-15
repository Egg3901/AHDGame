"use client";

/**
 * Progressive conversational shell over the canonical creator steps.
 *
 * One step is active at a time; completed answers collect in a transcript
 * above it and any reached step can be reopened directly. The shell owns
 * progression only: step content, completion flags, and summaries all come
 * from the parent, which keeps rendering the exact same controls and the
 * exact same submit path as the classic form. No values are invented here
 * and nothing is submitted from here.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ConversationStep, ConversationStepId } from "./conversationSteps";

interface ConversationShellProps {
  steps: ConversationStep[];
  renderStep: (id: ConversationStepId) => ReactNode;
  /** Optional alert (for example a submit error) shown above the active step. */
  alert?: ReactNode;
  /** Destination of the outer Back action while on the first step. */
  startHref?: string;
  startLabel?: string;
}

export function ConversationShell({
  steps,
  renderStep,
  alert,
  startHref = "/dashboard",
  startLabel = "Back to dashboard",
}: ConversationShellProps) {
  const [activeId, setActiveId] = useState<string>(() => steps[0]?.id ?? "");
  const [reached, setReached] = useState<string[]>(() => (steps[0] ? [steps[0].id] : []));
  const headingRef = useRef<HTMLHeadingElement>(null);

  const activeIndex = Math.max(
    0,
    steps.findIndex((s) => s.id === activeId)
  );
  const active = steps[activeIndex] ?? null;
  const next = steps[activeIndex + 1] ?? null;
  const isLast = activeIndex === steps.length - 1;

  // Move keyboard focus to the new prompt on every step change, so screen
  // reader and keyboard users land on the question, not the top of the page.
  useEffect(() => {
    headingRef.current?.focus();
  }, [activeId]);

  if (!active) return null;

  const goTo = (id: string) => {
    setActiveId(id);
    setReached((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  const answered = steps.filter((s) => s.id !== active.id && s.complete && s.summary);
  const upcoming = steps.filter((s) => !reached.includes(s.id) && s.id !== active.id);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-5 sm:px-6">
      <p
        className="font-mono text-body-xs uppercase tracking-[0.14em] text-muted"
        aria-live="polite"
      >
        Step {activeIndex + 1} of {steps.length}
      </p>

      {/* Stepper: direct navigation to any reached step. */}
      <ol aria-label="Creation steps" className="mt-2 flex flex-wrap gap-1.5">
        {steps.map((s, i) => {
          const isActive = s.id === active.id;
          const canOpen = reached.includes(s.id);
          return (
            <li key={s.id}>
              {canOpen && !isActive ? (
                <button
                  type="button"
                  onClick={() => goTo(s.id)}
                  aria-label={`Go to ${s.title}`}
                  className={`flex min-h-[2.75rem] items-center gap-1.5 rounded-full border px-3 text-body-sm transition-colors ${
                    s.complete
                      ? "border-success/40 bg-success/10 text-success"
                      : "border-card-border bg-card text-muted hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  <span aria-hidden className="font-mono text-body-xs">
                    {i + 1}
                  </span>
                  {s.title}
                </button>
              ) : (
                <span
                  aria-current={isActive ? "step" : undefined}
                  className={`flex min-h-[2.75rem] items-center gap-1.5 rounded-full border px-3 text-body-sm ${
                    isActive
                      ? "border-primary bg-primary/10 font-semibold text-foreground"
                      : "border-card-border/50 text-muted/50"
                  }`}
                >
                  <span aria-hidden className="font-mono text-body-xs">
                    {i + 1}
                  </span>
                  {s.title}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {/* Transcript of answered steps, each directly editable. */}
      {answered.length > 0 && (
        <ol aria-label="Your answers so far" className="mt-4 space-y-2">
          {answered.map((s) => (
            <li key={s.id} className="rounded-lg border border-card-border bg-card px-3 py-2">
              <p className="font-mono text-body-xs uppercase tracking-[0.14em] text-muted">
                {s.title}
              </p>
              <div className="mt-1 flex items-start justify-between gap-3">
                <p className="min-w-0 flex-1 text-body-sm text-foreground">{s.summary}</p>
                {reached.includes(s.id) && (
                  <button
                    type="button"
                    onClick={() => goTo(s.id)}
                    aria-label={`Edit ${s.title}`}
                    className="shrink-0 rounded border border-card-border px-2.5 py-1.5 text-body-sm text-muted transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    Edit
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* Active prompt and its inputs. Only this step renders inputs. */}
      <section aria-labelledby="conversation-step-heading" className="mt-4">
        <div className="rounded-lg rounded-bl-none border border-card-border bg-card-muted px-4 py-3">
          <h2
            id="conversation-step-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-heading-sm font-semibold leading-tight outline-none"
          >
            {active.title}
          </h2>
          <p className="mt-0.5 text-body-sm text-muted">{active.prompt}</p>
        </div>
        {alert && <div className="mt-3">{alert}</div>}
        <div className="mt-3">{renderStep(active.id)}</div>
      </section>

      {upcoming.length > 0 && (
        <p className="mt-3 text-body-xs text-muted">
          Up next: {upcoming.map((s) => s.title).join(", ")}
        </p>
      )}

      {/* Navigation. Continue stays shut until the parent marks the step
          complete under the existing validation rules. */}
      <div className="mt-4 flex items-center justify-between gap-3">
        {activeIndex === 0 ? (
          <a
            href={startHref}
            className="flex min-h-[2.75rem] items-center rounded border border-card-border px-4 text-body-sm text-muted transition-colors hover:border-primary/40 hover:text-foreground"
          >
            {startLabel}
          </a>
        ) : (
          <button
            type="button"
            onClick={() => goTo(steps[activeIndex - 1].id)}
            className="min-h-[2.75rem] rounded border border-card-border px-4 text-body-sm text-muted transition-colors hover:border-primary/40 hover:text-foreground"
          >
            Back
          </button>
        )}
        {!isLast && next && (
          <button
            type="button"
            onClick={() => goTo(next.id)}
            disabled={!active.complete}
            className="min-h-[2.75rem] rounded bg-primary px-6 text-body-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {next.id === "review" ? "Review your file" : "Continue"}
          </button>
        )}
      </div>
    </div>
  );
}
