"use client";

/**
 * Opt-in editor for the `economic_system_reform` bill provision, on economy
 * bills in countries that begin the era planned (see
 * `canLegislateEconomicSystem`). The provision stands on its own, so a bill may
 * carry nothing else; the parent modal counts it toward `MAX_PROVISIONS`.
 */
import type { EconomicSystemTarget } from "@/lib/db/types/legislation";
import {
  ECONOMIC_SYSTEM_TARGETS,
  ECONOMIC_SYSTEM_TARGET_DESCRIPTION,
  ECONOMIC_SYSTEM_TARGET_LABEL,
} from "@/lib/economy/economicSystemReformRules";

export function EconomicSystemReformEditor({
  include,
  onIncludeChange,
  target,
  onTargetChange,
}: {
  include: boolean;
  onIncludeChange: (next: boolean) => void;
  target: EconomicSystemTarget;
  onTargetChange: (next: EconomicSystemTarget) => void;
}) {
  return (
    <div className="rounded-lg border border-dashed border-emerald-500/35 bg-emerald-500/5 p-3 space-y-3">
      <p className="text-xs font-medium text-muted">Economic system (optional)</p>
      <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={include}
          onChange={(e) => onIncludeChange(e.target.checked)}
          className="rounded"
        />
        Change how the economy is run
      </label>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        {ECONOMIC_SYSTEM_TARGETS.map((option) => (
          <label key={option} className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              name="economic-system-target"
              checked={target === option}
              disabled={!include}
              onChange={() => onTargetChange(option)}
            />
            {ECONOMIC_SYSTEM_TARGET_LABEL[option]}
          </label>
        ))}
      </div>
      <p className="text-[11px] italic text-muted/60">
        {include
          ? `${ECONOMIC_SYSTEM_TARGET_DESCRIPTION[target]} The change phases in over the turns after enactment.`          : "No economic system provision will be included in this bill."}
      </p>
    </div>
  );
}
