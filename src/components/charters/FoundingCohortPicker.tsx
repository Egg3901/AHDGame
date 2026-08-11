"use client";

import { useMemo, useState } from "react";
import { Label, Slider } from "@/components/ui";
import { adjacentStates } from "@/lib/constants/stateAdjacency";
import type { CountryId } from "@/lib/constants/countries";
import type { FoundingCohortPick } from "@/lib/db/types";

/**
 * F4 Founding-Cohort picker for the charter-draft flow.
 *
 * Lets the chair distribute the 2 player-controlled founding NPPs across
 * states adjacent to their home state (the 3rd NPP is implicit — always
 * spawned in the chair's home state, no picker needed).
 *
 * Pickers default to the chair's home state so a player clicking through
 * gets all 3 NPPs in the home state — matching the legacy F4 behavior.
 * Picking the same state in both slots is allowed (concentrates 2 NPPs).
 *
 * Per-NPP positions default to the charter platform converted to the
 * party-grid (axis/12 → [-5, +5]). Player can tweak per-NPP for jitter
 * / coalition feel. Position changes are slider-driven (-5..+5 with 0.5
 * step).
 */

/** Charter axis [-60, +60] → party-grid position [-5, +5]. Mirrors `ratifyCharter.axisToPartyPosition`. */
function axisToPartyPosition(axis: number): number {
  return Math.max(-5, Math.min(5, axis / 12));
}

export interface FoundingCohortPickerProps {
  countryId: CountryId;
  /** Chair's home state. Always the first option in each picker; the 3rd implicit NPP spawns here. */
  chairHomeState: string;
  /** Display-name map for the country's states/regions. Caller passes the full set. */
  stateNames: Readonly<Record<string, string>>;
  /** Charter platform's current economic axis — used to (re)default per-NPP position sliders. */
  platformEconomic: number;
  /** Charter platform's current social axis — used to (re)default per-NPP position sliders. */
  platformSocial: number;
  /** Current cohort value (lifted to parent for submission). Defaults built by `defaultCohort` helper. */
  value: [FoundingCohortPick, FoundingCohortPick];
  onChange: (next: [FoundingCohortPick, FoundingCohortPick]) => void;
}

/**
 * Build the default cohort from the chair's home state and the current
 * charter platform. Both picks point at the home state with platform-
 * derived positions — matches legacy 3-in-home-state behavior when the
 * player doesn't touch the picker.
 */
export function defaultCohort(
  chairHomeState: string,
  platformEconomic: number,
  platformSocial: number
): [FoundingCohortPick, FoundingCohortPick] {
  const econ = axisToPartyPosition(platformEconomic);
  const soc = axisToPartyPosition(platformSocial);
  const pick: FoundingCohortPick = {
    stateId: chairHomeState,
    economicPosition: econ,
    socialPosition: soc,
  };
  return [pick, { ...pick }];
}

export function FoundingCohortPicker({
  countryId,
  chairHomeState,
  stateNames,
  platformEconomic,
  platformSocial,
  value,
  onChange,
}: FoundingCohortPickerProps) {
  // Per-slot "edit mode" — collapsed by default to keep the form compact.
  const [openSlots, setOpenSlots] = useState<{ 0: boolean; 1: boolean }>({ 0: false, 1: false });

  const dropdownOptions = useMemo(() => {
    const ids = [chairHomeState, ...adjacentStates(countryId, chairHomeState)];
    return ids.map((id) => ({ id, name: stateNames[id] ?? id }));
  }, [countryId, chairHomeState, stateNames]);

  const updateSlot = (slot: 0 | 1, patch: Partial<FoundingCohortPick>) => {
    const next: [FoundingCohortPick, FoundingCohortPick] = [{ ...value[0] }, { ...value[1] }];
    next[slot] = { ...next[slot], ...patch };
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Your party starts with 3 founding NPPs. The first always spawns in your home state with the
        charter platform&apos;s positions. Place the other two anywhere your home state borders —
        picking the same state twice concentrates both there.
      </p>

      <div className="rounded-md border border-card-border bg-card/40 p-3 text-xs">
        <span className="font-semibold">Fixed:</span>{" "}
        <span>NPP 1 — {stateNames[chairHomeState] ?? chairHomeState}</span>
        <span className="ml-2 text-muted">(your home, platform positions)</span>
      </div>

      {([0, 1] as const).map((slot) => {
        const pick = value[slot];
        const isOpen = openSlots[slot];
        const npcNumber = slot + 2; // "NPP 2" / "NPP 3"

        return (
          <div key={slot} className="rounded-md border border-card-border bg-card/40 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor={`cohort-state-${slot}`} className="text-xs w-16 shrink-0">
                NPP {npcNumber}
              </Label>
              <select
                id={`cohort-state-${slot}`}
                value={pick.stateId}
                onChange={(e) => updateSlot(slot, { stateId: e.target.value })}
                className="flex-1 rounded-md border border-card-border bg-background px-2 py-1 text-sm"
              >
                {dropdownOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.name}
                    {opt.id === chairHomeState ? " (home)" : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setOpenSlots((p) => ({ ...p, [slot]: !p[slot] }))}
                className="text-xs text-muted underline hover:text-foreground"
                aria-expanded={isOpen}
              >
                {isOpen ? "Hide positions" : "Edit positions"}
              </button>
            </div>

            {isOpen && (
              <div className="space-y-2 pl-16">
                <div>
                  <Label htmlFor={`cohort-econ-${slot}`} className="text-xs">
                    Economic: {pick.economicPosition.toFixed(1)}
                  </Label>
                  <Slider
                    id={`cohort-econ-${slot}`}
                    min={-5}
                    max={5}
                    step={0.1}
                    value={pick.economicPosition}
                    onChange={(e) =>
                      updateSlot(slot, { economicPosition: parseFloat(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor={`cohort-soc-${slot}`} className="text-xs">
                    Social: {pick.socialPosition.toFixed(1)}
                  </Label>
                  <Slider
                    id={`cohort-soc-${slot}`}
                    min={-5}
                    max={5}
                    step={0.1}
                    value={pick.socialPosition}
                    onChange={(e) =>
                      updateSlot(slot, { socialPosition: parseFloat(e.target.value) })
                    }
                  />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    updateSlot(slot, {
                      economicPosition: axisToPartyPosition(platformEconomic),
                      socialPosition: axisToPartyPosition(platformSocial),
                    })
                  }
                  className="text-[11px] text-muted underline hover:text-foreground"
                >
                  Reset to platform
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
