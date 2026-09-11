"use client";

import type { ReactNode } from "react";
import { Tooltip } from "@/components/ui";

/**
 * Shared visual hierarchy for the bank console.
 *
 * Every panel answers one question first: can the CEO change this? Panels the
 * CEO adjusts carry a "CEO control" eyebrow; read-only explainers carry
 * "Monitor" or "Reference". Detail that used to sit in always-visible
 * paragraphs (formulas, inputs, levers) moves into `Tooltip`s so the panel
 * shows the number and the action, not the manual.
 */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-widest text-accent">
      {children}
    </div>
  );
}

export function BankSection({
  eyebrow,
  title,
  tooltip,
  action,
  children,
  className = "",
}: {
  eyebrow?: ReactNode;
  title: string;
  tooltip?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`space-y-4 rounded-xl border border-card-border bg-card p-5 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <h3 className="text-base font-semibold text-foreground">
            {title}
            {tooltip ? <Tooltip content={tooltip} label={`About ${title}`} /> : null}
          </h3>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
