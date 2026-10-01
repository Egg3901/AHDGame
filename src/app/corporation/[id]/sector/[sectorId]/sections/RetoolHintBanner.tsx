"use client";

import { COMMODITY_LABELS } from "@/lib/constants/commodities";
import type { RetoolHint } from "@/lib/corporations/retoolHint";

interface RetoolHintBannerProps {
  hint: RetoolHint;
  isCeo: boolean;
  /** Opens the tab that holds the strategy picker. */
  onOpenStrategy: () => void;
}

const pct = (share: number) => `${Math.round(share * 100)}%`;

/**
 * Shown while the demand throttle holds a plant down because the valuable part
 * of its output is oversupplied, and another strategy for this sector would
 * sell into a shortage in the same market (ticket 1370 follow-up).
 *
 * COPY RULE (project standing): plain language, concrete numbers, no dashes.
 */
export default function RetoolHintBanner({ hint, isCeo, onOpenStrategy }: RetoolHintBannerProps) {
  const current = COMMODITY_LABELS[hint.currentMain.commodity] ?? hint.currentMain.commodity;
  const suggested = COMMODITY_LABELS[hint.suggestedMain.commodity] ?? hint.suggestedMain.commodity;
  return (
    <div
      role="status"
      aria-label="Strategy suggestion"
      className="rounded-xl border border-info/40 bg-info/10 p-4"
    >
      <p className="text-sm font-semibold text-foreground">
        This plant&apos;s main product is oversupplied here
      </p>
      <p className="mt-1 text-xs text-muted">
        {current} is {pct(hint.currentMain.valueShare)} of this plant&apos;s output by value, and
        buyers took {pct(hint.currentMain.fill)} of it last turn because this market has more than
        it needs. Overall the plant sold {pct(hint.currentValueFill)} of its output by value, so it
        is running below capacity.
      </p>
      <p className="mt-1 text-xs text-muted">
        The {hint.suggestedStrategyName} strategy makes mostly {suggested}, and this market is{" "}
        {pct(hint.suggestedMain.unmetShare)} short of it. On {hint.suggestedStrategyName} this plant
        would sell about {pct(hint.suggestedValueFill)} of its output by value, enough to climb back
        toward full capacity. Changing strategy costs money and takes a few turns to complete; the
        strategy panel shows both.
      </p>
      {isCeo && (
        <button
          type="button"
          onClick={onOpenStrategy}
          className="mt-2 rounded-lg border border-info/40 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-info/15"
        >
          Review strategy
        </button>
      )}
    </div>
  );
}
