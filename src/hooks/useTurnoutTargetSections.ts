"use client";

import { useState } from "react";
import { useAbortableEffectFetch } from "@/hooks/useAbortableEffectFetch";
import type { TurnoutTargetSection } from "@/lib/demographics/turnoutTargets";

/** Load the active world's country- and era-specific turnout target catalog. */
export function useTurnoutTargetSections(countryId: string): TurnoutTargetSection[] {
  const normalizedCountryId = countryId.toUpperCase();
  const [loaded, setLoaded] = useState<{
    countryId: string;
    sections: TurnoutTargetSection[];
  } | null>(null);

  useAbortableEffectFetch(
    async (signal) => {
      try {
        const response = await fetch(
          `/api/country/${normalizedCountryId.toLowerCase()}/turnout-targets`,
          {
            cache: "no-store",
            signal,
          }
        );
        if (!response.ok) {
          setLoaded({ countryId: normalizedCountryId, sections: [] });
          return;
        }
        const data = (await response.json()) as { sections?: TurnoutTargetSection[] };
        setLoaded({ countryId: normalizedCountryId, sections: data.sections ?? [] });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        setLoaded({ countryId: normalizedCountryId, sections: [] });
      }
    },
    [normalizedCountryId]
  );

  // Never expose the previous country's options while the next request is in
  // flight. Doing so briefly allowed a fast submit to save an invalid target.
  return loaded?.countryId === normalizedCountryId ? loaded.sections : [];
}
