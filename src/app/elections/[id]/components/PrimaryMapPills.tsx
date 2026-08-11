"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";
import { tierPrimaryRoute } from "@/lib/urls";
import type { ElectionDetail, PartyGroup } from "./ElectionDetailTypes";

/** Country defaults fetched once when activeParties is empty so we can still
 *  render the primary-map pills (the per-party primary surfaces are useful
 *  even when no one has filed yet). Shape matches the parties API response. */
interface DefaultParty {
  sequentialId: number;
  name: string;
  abbreviation: string;
  color?: string;
  isDefault?: boolean;
}

const TIER_FROM_ELECTION_TYPE: Record<
  string,
  "president" | "senate" | "stateSenate" | "governor" | "house"
> = {
  president: "president",
  senate: "senate",
  stateSenate: "stateSenate",
  governor: "governor",
  house: "house",
};

const TIER_LABEL: Record<NonNullable<ReturnType<typeof resolveTier>>, string> = {
  president: "presidential primary",
  senate: "Senate primary",
  stateSenate: "State Senate primary",
  governor: "gubernatorial primary",
  house: "House primary",
};

/**
 * Tier the pills should link to. `tierPrimaryRoute` returns the presidential
 * URL for "president" and the /elections/primary/* tree for the lower tiers.
 * The per-party primary pages are US-only (hardcoded US state list + GeoJSON),
 * so non-US elections must not link to them — a Japanese party's sequentialId
 * would otherwise resolve to the same-numbered US party (ticket #954).
 */
function resolveTier(election: ElectionDetail) {
  if (election.countryId !== "US") return undefined;
  return TIER_FROM_ELECTION_TYPE[election.electionType];
}

/**
 * Links to the per-party primary map pages. Lives in the page rail rather than
 * as a full-width card at the top of the body — it is navigation, not the
 * standings the page is about.
 */
export function PrimaryMapPills({
  election,
  activeParties,
}: {
  election: ElectionDetail;
  activeParties: PartyGroup[];
}) {
  const tier = resolveTier(election);

  // Fetch the country's default parties when there are no active parties yet —
  // so the primary-map navigation is discoverable even before any candidate
  // files. Skipped when `activeParties` is non-empty (the pills derive from
  // those directly) or when the tier isn't one we route to.
  const [defaultParties, setDefaultParties] = useState<DefaultParty[]>([]);
  const shouldFallbackFetch = tier !== undefined && activeParties.length === 0;
  useEffect(() => {
    if (!shouldFallbackFetch) return;
    const controller = new AbortController();
    fetch(`/api/country/${election.countryId.toLowerCase()}/parties`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ parties?: DefaultParty[] }>) : null))
      .then((data) => {
        if (!data?.parties) return;
        setDefaultParties(
          data.parties
            .filter((p) => p.isDefault ?? true)
            .sort((a, b) => a.sequentialId - b.sequentialId)
        );
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") {
          // Non-fatal — pills just stay hidden.
          console.warn("[PrimaryMapPills] Failed to load default parties:", err.message);
        }
      });
    return () => controller.abort();
  }, [shouldFallbackFetch, election.countryId]);

  if (tier === undefined) return null;

  const pillSource: { partyId: string; partyName: string }[] =
    activeParties.length > 0
      ? activeParties.map((g) => ({ partyId: g.partyId, partyName: g.partyName }))
      : defaultParties.map((p) => ({ partyId: String(p.sequentialId), partyName: p.name }));

  if (pillSource.length === 0) return null;

  return (
    <Card title="Primary maps" padding="sm" className="mb-6">
      <div className="flex flex-wrap gap-2">
        {pillSource.map((p) => (
          <Link
            key={p.partyId}
            href={tierPrimaryRoute(tier, p.partyId)}
            className="inline-flex items-center gap-1.5 rounded-full border border-card-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-card"
          >
            🗺 {p.partyName} {TIER_LABEL[tier]}
          </Link>
        ))}
      </div>
      {activeParties.length === 0 && (
        <div className="mt-2 text-[11px] italic text-muted/80">
          No candidates have filed yet. The per-party {TIER_LABEL[tier]} pages still show the seeded
          race calendar and state map.
        </div>
      )}
    </Card>
  );
}
