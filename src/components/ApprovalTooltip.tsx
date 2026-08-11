"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";
import { computeRegionalConditionMargin } from "@/lib/states/conditions/marginEffects";

interface ApprovalTooltipProps {
  /** Final approval (with modifiers applied). */
  approval: number;
  /** Pre-modifier base approval score. Required unless `summary`. */
  baseApproval?: number;
  modifiers: ActiveModifier[];
  /** If set, clicking the trigger navigates here. */
  href?: string;
  /** Extra className for the trigger span. */
  className?: string;
  /**
   * Summary mode: omit the "base + net = approval" arithmetic and show the
   * conditions as informational factors only. Use where the approval value is
   * not a clean base+modifiers sum (e.g. national approval, which is a
   * population-weighted aggregate of regional approval).
   */
  summary?: boolean;
}

interface TriggerRect {
  bottom: number;
  left: number;
  width: number;
}

function EffectIcon({ effect }: { effect: number }) {
  if (effect > 0) {
    return (
      <svg
        className="h-3 w-3 text-emerald-500 shrink-0"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden
      >
        <path
          fillRule="evenodd"
          d="M10 3a.75.75 0 01.75.75v10.5a.75.75 0 01-1.5 0V3.75A.75.75 0 0110 3z"
          clipRule="evenodd"
        />
        <path d="M5.75 8.25a.75.75 0 010-1.5h8.5a.75.75 0 010 1.5h-8.5z" />
      </svg>
    );
  }
  return (
    <svg
      className="h-3 w-3 text-rose-500 shrink-0"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M10 3a.75.75 0 01.75.75v10.5a.75.75 0 01-1.5 0V3.75A.75.75 0 0110 3z"
        clipRule="evenodd"
      />
      <path d="M5.75 11.75a.75.75 0 010-1.5h8.5a.75.75 0 010 1.5h-8.5z" />
    </svg>
  );
}

export function ApprovalTooltip({
  approval,
  baseApproval,
  modifiers,
  href,
  className,
  summary = false,
}: ApprovalTooltipProps) {
  const [rect, setRect] = useState<TriggerRect | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  const positives = modifiers.filter((m) => m.effect > 0);
  const negatives = modifiers.filter((m) => m.effect < 0);
  const net = modifiers.reduce((s, m) => s + m.effect, 0);
  const hasModifiers = modifiers.length > 0;
  const netMargin = computeRegionalConditionMargin(modifiers);

  function handleMouseEnter() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setRect({ bottom: r.bottom, left: r.left, width: r.width });
    }
  }

  function handleMouseLeave() {
    timeoutRef.current = setTimeout(() => setRect(null), 120);
  }

  function handleClick(e: React.MouseEvent) {
    if (!href) return;
    e.preventDefault();
    setRect(null);
    router.push(href);
  }

  const approvalColor =
    approval >= 50 ? "text-success" : approval >= 40 ? "text-warning" : "text-error";

  const tooltip = rect && (
    <div
      style={{
        position: "fixed",
        top: rect.bottom + 8,
        left: rect.left + rect.width / 2,
        transform: "translateX(-50%)",
        zIndex: 9999,
      }}
      className="w-72 rounded-xl border border-card-border bg-card shadow-modal p-3 text-xs pointer-events-auto"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Arrow pointing up */}
      <div
        className="absolute left-1/2 -translate-x-1/2 border-[5px] border-transparent border-b-card-border"
        style={{ bottom: "100%" }}
      />
      <div
        className="absolute left-1/2 -translate-x-1/2 border-[5px] border-transparent border-b-card"
        style={{ bottom: "calc(100% - 1px)" }}
      />

      {/* Title */}
      <p className="mb-2.5 font-semibold text-foreground">Government Approval</p>

      {/* Base row (omitted in summary mode — value isn't a base+modifiers sum) */}
      {!summary && baseApproval != null && (
        <div className="flex items-center justify-between mb-2">
          <span className="text-muted">Base (metrics)</span>
          <span className="font-medium tabular-nums text-foreground">
            {baseApproval.toFixed(1)}%
          </span>
        </div>
      )}
      {summary && hasModifiers && (
        <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted/70">Key factors</p>
      )}

      {/* Positive modifiers */}
      {positives.length > 0 && (
        <div className="space-y-1 mb-2">
          {positives.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-muted">
                <EffectIcon effect={m.effect} />
                {m.label}
              </span>
              <span className="font-medium text-success tabular-nums">+{m.effect}</span>
            </div>
          ))}
        </div>
      )}

      {/* Negative modifiers */}
      {negatives.length > 0 && (
        <div className="space-y-1 mb-2">
          {negatives.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-muted">
                <EffectIcon effect={m.effect} />
                {m.label}
              </span>
              <span className="font-medium text-error tabular-nums">{m.effect}</span>
            </div>
          ))}
        </div>
      )}

      {!hasModifiers && <p className="text-muted mb-2 italic">No active conditions</p>}

      {/* Net modifier row (only when decomposing; omitted in summary mode) */}
      {!summary && hasModifiers && (
        <div className="flex items-center justify-between text-muted mb-2">
          <span>Net modifiers</span>
          <span className={`font-medium tabular-nums ${net >= 0 ? "text-success" : "text-error"}`}>
            {net >= 0 ? "+" : ""}
            {net}
          </span>
        </div>
      )}

      {/* Net margin row */}
      {hasModifiers && (
        <div className="flex items-center justify-between text-muted mb-2">
          <span>Net margin</span>
          <span
            className={`font-medium tabular-nums ${netMargin >= 0 ? "text-success" : "text-error"}`}
          >
            {netMargin >= 0 ? "+" : ""}
            {netMargin}pp
          </span>
        </div>
      )}

      {/* Divider + Final approval */}
      <div className="border-t border-card-border/60 pt-2 flex items-center justify-between">
        <span className="font-semibold text-foreground">Approval</span>
        <span className={`font-bold tabular-nums ${approvalColor}`}>{approval.toFixed(1)}%</span>
      </div>

      {href && (
        <p className="mt-2 text-center text-muted/70 text-[10px]">Click to view full breakdown →</p>
      )}
    </div>
  );

  return (
    <span
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span
        ref={triggerRef}
        onClick={handleClick}
        className={`${href ? "cursor-pointer" : "cursor-help"} underline decoration-dotted decoration-muted underline-offset-2 ${className ?? ""}`}
      >
        {approval.toFixed(1)}%
      </span>

      {typeof document !== "undefined" && rect && createPortal(tooltip, document.body)}
    </span>
  );
}
