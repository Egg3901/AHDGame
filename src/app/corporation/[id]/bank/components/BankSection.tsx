"use client";

import { useTranslations } from "next-intl";

/**
 * Shared visual hierarchy for the bank console.
 *
 * Every panel answers one question first: can the CEO change this? Panels the
 * CEO adjusts carry a "CEO control" eyebrow; read-only explainers carry
 * "Monitor" or "Reference". Detail that used to sit in always-visible
 * paragraphs (formulas, inputs, levers) moves into `Tooltip`s so the panel
 * shows the number and the action, not the manual.
 */
export type EyebrowKind = "ceoControl" | "monitor" | "reference" | "supervision";

export function Eyebrow({ kind }: { kind: EyebrowKind }) {
  const t = useTranslations("corporations.bankConsole");

  return (
    <div className="text-[10px] font-semibold uppercase tracking-widest text-accent">
      {t(`eyebrow.${kind}`)}
    </div>
  );
}
