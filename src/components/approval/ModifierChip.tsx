"use client";

import type { ActiveModifier } from "@/lib/utils/approvalModifiers";
import { buildModifierTitle, toneFor } from "./modifierTitle";

function marginForModifier(modifier: ActiveModifier): number | null {
  if (modifier.source === "address" || modifier.source === "war") return null;
  if (modifier.marginEffect === 0) return null;
  return modifier.marginEffect ?? null;
}

function EffectIcon({ effect }: { effect: number }) {
  // A war that nets to zero gets a flat bar rather than the falling arrow: it is
  // neither costing nor earning the government approval this turn.
  if (effect === 0) {
    return (
      <svg
        className="h-3.5 w-3.5 text-slate-500 shrink-0"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden
      >
        <path d="M5.75 10.75a.75.75 0 010-1.5h8.5a.75.75 0 010 1.5h-8.5z" />
      </svg>
    );
  }
  if (effect > 0) {
    return (
      <svg
        className="h-3.5 w-3.5 text-emerald-500 shrink-0"
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
      className="h-3.5 w-3.5 text-rose-500 shrink-0"
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

const TONE_CLASSES: Record<ReturnType<typeof toneFor>, string> = {
  positive: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  neutral: "border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-300",
  negative: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

function ModifierChip({ modifier }: { modifier: ActiveModifier }) {
  const tone = toneFor(modifier.effect);
  const positive = tone === "positive";
  const isAddress = modifier.source === "address";
  const margin = marginForModifier(modifier);
  const marginPositive = margin != null && margin > 0;

  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium " +
        TONE_CLASSES[tone] +
        (isAddress ? " border-dashed" : "")
      }
      title={buildModifierTitle(modifier)}
    >
      <EffectIcon effect={modifier.effect} />
      <span>{modifier.label}</span>
      <span className="tabular-nums font-semibold">
        {positive ? "+" : ""}
        {modifier.effect} approval
      </span>
      {margin != null && margin !== 0 && (
        <span
          className={
            "tabular-nums text-[10px] font-medium opacity-90 " +
            (marginPositive
              ? "text-emerald-600 dark:text-emerald-300"
              : "text-rose-600 dark:text-rose-300")
          }
        >
          · {marginPositive ? "+" : ""}
          {margin}pp
        </span>
      )}
    </span>
  );
}

interface ModifierListProps {
  modifiers: ActiveModifier[];
  emptyText?: string;
}

export function ModifierList({
  modifiers,
  emptyText = "No active conditions.",
}: ModifierListProps) {
  if (modifiers.length === 0) {
    return <p className="text-sm italic text-[var(--muted)]">{emptyText}</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {modifiers.map((m) => (
        <ModifierChip key={m.id} modifier={m} />
      ))}
    </div>
  );
}

export { ModifierChip, marginForModifier };
