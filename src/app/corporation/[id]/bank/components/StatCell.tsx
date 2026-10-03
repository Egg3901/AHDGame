import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Tooltip } from "@/components/ui";

/**
 * One figure in a stat grid: a small label over the value. The label carries
 * a `Tooltip` for the what-and-why; an optional `action` jumps straight to the
 * tab where the CEO adjusts it, so a reading never strands the player away
 * from its lever.
 */
export function StatCell({
  label,
  value,
  sub,
  tooltip,
  action,
  tone = "text-foreground",
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  tooltip?: string;
  action?: { label: string; onClick: () => void };
  /** Text colour for the value, for figures whose sign or band matters. */
  tone?: string;
}) {
  const t = useTranslations("corporations.bankConsole");

  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-[11px] text-muted">
        {label}
        {tooltip ? <Tooltip content={tooltip} label={t("about", { label })} /> : null}
      </p>
      <div className={`mt-0.5 font-mono text-sm font-medium tabular-nums ${tone}`}>{value}</div>
      {sub && <p className="mt-0.5 text-[11px] text-muted">{sub}</p>}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-0.5 text-[11px] text-foreground underline decoration-card-border underline-offset-2 hover:decoration-foreground"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
