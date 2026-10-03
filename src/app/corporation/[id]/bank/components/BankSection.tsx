"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { DenseSection } from "@/components/corporation/dense/DenseKit";

/**
 * Shared frame for the bank console's panels.
 *
 * Every panel answers one question first: can the CEO change this? The answer
 * rides beside the heading as plain text ("CEO control", "Monitor",
 * "Reference", "Supervision") instead of an uppercase eyebrow above it.
 * Detail that used to sit in always-visible paragraphs (formulas, inputs,
 * levers) lives in `Tooltip`s so the panel shows the number and the action,
 * not the manual.
 */
export type EyebrowKind = "ceoControl" | "monitor" | "reference" | "supervision";

export function BankPanel({
  kind,
  title,
  meta,
  actions,
  children,
  className = "",
}: {
  kind?: EyebrowKind;
  title: ReactNode;
  /** Extra muted text after the kind (a turn, a count). */
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const t = useTranslations("corporations.bankConsole");
  const kindLabel = kind ? t(`eyebrow.${kind}`) : null;
  return (
    <DenseSection
      title={title}
      meta={
        kindLabel || meta ? (
          <>
            {kindLabel}
            {kindLabel && meta ? ", " : null}
            {meta}
          </>
        ) : undefined
      }
      actions={actions}
      className={className}
    >
      {children}
    </DenseSection>
  );
}
