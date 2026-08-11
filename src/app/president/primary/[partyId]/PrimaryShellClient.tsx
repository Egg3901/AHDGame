"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { TierSelector, type RaceTier } from "@/components/elections/primary/TierSelector";
import { PrimaryCalendar } from "@/components/elections/primary/PrimaryCalendar";
import { CarveUpPanel } from "@/components/elections/primary/CarveUpPanel";
import { tierPrimaryRoute } from "@/lib/urls";
import type { PrimaryViewModel } from "@/lib/elections/primaryViewModel";

/**
 * Client wrapper for the per-party presidential primary shell. Composes the
 * TierSelector, PrimaryCalendar, and CarveUpPanel with URL-driven state for
 * the selected state — so server-rendered output and client-side selection
 * stay in sync via the `?state=` query param.
 *
 * Tier chips now navigate to their respective per-party aggregator
 * surfaces (`/elections/primary/[tier]/[partyId]`); the active "president"
 * chip on this page is a no-op.
 */
export function PrimaryShellClient({
  viewModel,
  selectedStateId,
  partyColor,
  countryId,
  winnerColorByState,
  /**
   * partyId used to build per-state detail links on the CarveUpPanel and
   * to construct outgoing tier-navigation URLs. When set, the carve-up
   * panel shows a "View state details →" link to
   * `/president/primary/{partyId}/state/{stateId}`. Functions can't be
   * passed server→client, so we accept the partyId and build hrefs
   * client-side.
   */
  partyIdForDetailLinks,
  /**
   * Turns remaining until the primary's final (T-0) closing wave fires.
   * Passed straight to PrimaryCalendar so it can render "In X turns"
   * labels for each wave relative to the current turn instead of the
   * raw T-X notation.
   */
  turnsToEnd,
}: {
  viewModel: PrimaryViewModel;
  selectedStateId: string | null;
  partyColor?: string;
  countryId: string;
  winnerColorByState?: Record<string, string | undefined>;
  partyIdForDetailLinks?: string;
  turnsToEnd?: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const onSelectState = useCallback(
    (stateId: string) => {
      const params = new URLSearchParams(searchParams);
      params.set("state", stateId);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  const onTierChange = useCallback(
    (tier: RaceTier) => {
      if (tier === "president") return; // already here
      if (!partyIdForDetailLinks) return;
      router.push(tierPrimaryRoute(tier, partyIdForDetailLinks));
    },
    [router, partyIdForDetailLinks]
  );

  const carveSlices = selectedStateId ? (viewModel.perStateSlices[selectedStateId] ?? []) : [];
  const stateName = selectedStateId
    ? (viewModel.stateNameById[selectedStateId] ?? selectedStateId)
    : "";

  return (
    <div className="space-y-4">
      <TierSelector
        countryId={countryId}
        activeTier="president"
        partyColor={partyColor}
        onTierChange={onTierChange}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <PrimaryCalendar
          waves={viewModel.waves}
          selectedStateId={selectedStateId}
          partyColor={partyColor}
          onSelectState={onSelectState}
          winnerColorByState={winnerColorByState}
          turnsToEnd={turnsToEnd}
        />
        {selectedStateId ? (
          <CarveUpPanel
            stateName={stateName}
            stateId={selectedStateId}
            slices={carveSlices}
            detailHref={
              partyIdForDetailLinks
                ? `/president/primary/${partyIdForDetailLinks}/state/${selectedStateId}`
                : undefined
            }
          />
        ) : (
          <div className="rounded-xl border border-card-border bg-card p-4 text-xs text-muted">
            Select a state in the calendar to see its carve-up.
          </div>
        )}
      </div>
    </div>
  );
}
