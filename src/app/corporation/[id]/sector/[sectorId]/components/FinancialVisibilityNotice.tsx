import { EyeOff } from "lucide-react";
import type { FinancialVisibilityReason } from "../types";
import { financialVisibilityCopy } from "../lib/financialVisibility";

/**
 * Stands in for the money/plant panel when the figures are withheld. Without it
 * a fogged viewer sees the hero card's bare dash cells and an empty column,
 * which reads as "this sector earns nothing / is broken", the exact confusion
 * that had a player report a healthy sector as a $0 bug.
 *
 * Renders nothing for `visible` (owner / admin), so it is a pure explainer, not
 * a gate.
 */
export default function FinancialVisibilityNotice({
  reason,
}: {
  reason: FinancialVisibilityReason;
}) {
  const copy = financialVisibilityCopy(reason);
  if (!copy) return null;
  return (
    <div className="rounded-xl border border-card-border bg-card p-5 shadow-card">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-card-border bg-background/60">
          <EyeOff className="h-4 w-4 text-muted" aria-hidden />
        </span>
        <div>
          <h2 className="text-body-md font-semibold text-foreground">{copy.title}</h2>
          <p className="mt-1 text-body-sm text-muted">{copy.body}</p>
        </div>
      </div>
    </div>
  );
}
