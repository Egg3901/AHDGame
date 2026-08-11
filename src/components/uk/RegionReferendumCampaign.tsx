"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { CountryId } from "@/lib/constants/countries";
import { referendumDetailUrl } from "@/lib/urls";

/** Campaign-relevant slice of a referendum from `/api/country/[code]/referendum`. */
interface CampaignReferendum {
  id: string;
  regionId: string;
  kind: "independence" | "reunification";
  status: "requested" | "granted" | "campaigning" | "actuating";
  campaignCloseTurn: number | null;
  yesShare: number;
}

interface ReferendumResponse {
  referendums: CampaignReferendum[];
  currentTurn: number;
}

/**
 * Region-page banner for a live referendum campaign: a read-only Yes/No support
 * bar + a link to the dedicated campaign page, where the spend actions live.
 * Scoped to one region and the `campaigning` phase.
 */
export function RegionReferendumCampaign({
  countryId,
  regionId,
}: {
  countryId: CountryId;
  regionId: string;
}) {
  const [data, setData] = useState<ReferendumResponse | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/country/${countryId.toLowerCase()}/referendum`);
      if (!res.ok) return;
      setData((await res.json()) as ReferendumResponse);
    } catch {
      // Non-critical surface — stay silent on transient fetch failures.
    }
  }, [countryId]);

  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect -- initial data fetch
  }, [load]);

  if (countryId !== "UK" || !data) return null;
  const ref = data.referendums.find(
    (r) => r.regionId.toUpperCase() === regionId.toUpperCase() && r.status === "campaigning"
  );
  if (!ref) return null;

  const noun = ref.kind === "reunification" ? "Reunification" : "Independence";
  const yes = Math.round(ref.yesShare);
  const turnsLeft = ref.campaignCloseTurn != null ? ref.campaignCloseTurn - data.currentTurn : null;

  return (
    <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/5 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-amber-600">
        {noun} Referendum — Public Campaign
      </h2>
      <div className="mt-3 space-y-2">
        <div className="flex justify-between text-xs text-muted">
          <span>Yes {yes}%</span>
          <span>No {100 - yes}%</span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-background/60"
          role="progressbar"
          aria-valuenow={yes}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${noun} support`}
        >
          <div className="h-full bg-primary" style={{ width: `${ref.yesShare}%` }} />
        </div>
        <p className="text-xs text-muted">
          Campaign under way.
          {ref.campaignCloseTurn != null &&
            ` The vote is held on turn ${ref.campaignCloseTurn}${
              turnsLeft != null && turnsLeft > 0
                ? ` (in ${turnsLeft} ${turnsLeft === 1 ? "turn" : "turns"})`
                : ""
            }.`}
        </p>
        <Link
          href={referendumDetailUrl(countryId, regionId)}
          className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-600/90"
        >
          View Campaign →
        </Link>
      </div>
    </div>
  );
}
