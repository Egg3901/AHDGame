import type { ReactNode } from "react";
import { Tooltip } from "@/components/ui";

/**
 * One number in the overview strip. The label carries a `Tooltip` for the
 * what-and-why; an optional `action` jumps straight to the tab where the CEO
 * adjusts it, so a reading never strands the player away from its lever.
 */
export function StatCell({
  label,
  value,
  sub,
  tooltip,
  action,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  tooltip?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
        {label}
        {tooltip ? <Tooltip content={tooltip} label={`About ${label}`} /> : null}
      </p>
      <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-1 text-xs font-medium text-accent underline-offset-2 hover:underline"
        >
          {action.label} →
        </button>
      )}
    </div>
  );
}
