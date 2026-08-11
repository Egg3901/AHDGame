"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { PrimaryElectoralMap, type PrimaryStateData } from "@/components/PrimaryElectoralMap";

interface PrimaryMapWithLinksProps {
  partyId: string;
  stateData: Record<string, PrimaryStateData>;
  waveHighlight?: string[];
  header?: React.ReactNode;
  footer?: React.ReactNode;
  /**
   * Phase 4: when `mode="select"`, clicking a state updates the `?state=`
   * query param so the carve-up panel below the map updates in sync (per
   * the Phase 4 acceptance criterion "Click any state in the map → carve-up
   * panel updates"). When `mode="navigate"` (legacy behavior, kept for
   * compatibility with surfaces that haven't adopted the new shell), the
   * click navigates to the per-state detail page.
   */
  mode?: "select" | "navigate";
  /** Default map display mode. */
  defaultMapMode?: "leader" | "delegates";
}

/**
 * Client wrapper around PrimaryElectoralMap.
 *
 * Phase 4 default (`mode="select"`): clicking a state updates the URL's
 * `?state=` query param, syncing with the new TierSelector + Calendar +
 * CarveUpPanel shell. The per-state primary detail page is still
 * accessible via the CarveUpPanel's "View state details" link.
 *
 * Legacy mode (`mode="navigate"`): kept for surfaces that haven't been
 * reworked yet; clicking a state navigates straight to the detail page.
 */
export function PrimaryMapWithLinks({
  partyId,
  stateData,
  waveHighlight,
  header,
  footer,
  mode = "select",
  defaultMapMode = "leader",
}: PrimaryMapWithLinksProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mapMode, setMapMode] = useState<"leader" | "delegates">(defaultMapMode);

  const modeToggle = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setMapMode("leader")}
        className={`rounded border px-2 py-1 text-xs font-medium transition-colors ${
          mapMode === "leader"
            ? "border-primary bg-primary/10 text-primary"
            : "border-card-border bg-card text-muted hover:text-foreground"
        }`}
        aria-pressed={mapMode === "leader"}
      >
        Leader
      </button>
      <button
        type="button"
        onClick={() => setMapMode("delegates")}
        className={`rounded border px-2 py-1 text-xs font-medium transition-colors ${
          mapMode === "delegates"
            ? "border-primary bg-primary/10 text-primary"
            : "border-card-border bg-card text-muted hover:text-foreground"
        }`}
        aria-pressed={mapMode === "delegates"}
      >
        Delegates
      </button>
    </div>
  );

  return (
    <PrimaryElectoralMap
      stateData={stateData}
      waveHighlight={waveHighlight}
      header={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1">{header}</div>
          {modeToggle}
        </div>
      }
      footer={footer}
      mode={mapMode}
      onStateClick={(stateId) => {
        if (mode === "navigate") {
          router.push(`/president/primary/${partyId}/state/${stateId}`);
          return;
        }
        const params = new URLSearchParams(searchParams);
        params.set("state", stateId);
        router.push(`${pathname}?${params.toString()}`, { scroll: false });
      }}
    />
  );
}
