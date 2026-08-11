"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DistrictCardGrid } from "@/components/redistricting/DistrictCardGrid";
import type { DistrictSquareView } from "@/lib/redistricting/districtSquareResponse";
import type { RedistrictCaps } from "@/lib/redistricting/caps";
import { regionRedistrictUrl } from "@/lib/urls";

/**
 * Player-facing congressional-district panel on the State Politics tab.
 * Shows the live district map (leans, categories, current holders) to everyone
 * and a redraw call-to-action — with the blocking reason when ineligible — to
 * signed-in players. US-only; renders nothing while the feature flag is off.
 */
export function StateDistrictsSection({
  countryCode,
  stateId,
  isAdmin = false,
}: {
  countryCode: string;
  stateId: string;
  isAdmin?: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [districts, setDistricts] = useState<DistrictSquareView[]>([]);
  const [caps, setCaps] = useState<RedistrictCaps | undefined>(undefined);
  const [canRedraw, setCanRedraw] = useState(false);
  const [redrawReason, setRedrawReason] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/congressional-districts/${stateId.toUpperCase()}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          redistricting?: { enabled: boolean; districts: DistrictSquareView[] };
        };
        if (cancelled || !data.redistricting?.enabled) return;
        setEnabled(true);
        setDistricts(data.redistricting.districts);

        // Eligibility + caps (401 for signed-out viewers is fine — no CTA).
        const elig = await fetch(
          `/api/country/${countryCode.toLowerCase()}/region/${stateId.toLowerCase()}/redistrict`
        );
        if (cancelled || !elig.ok) return;
        const e = (await elig.json()) as {
          canRedraw: boolean;
          reason: string | null;
          caps: RedistrictCaps;
        };
        setCaps(e.caps);
        setCanRedraw(e.canRedraw);
        setRedrawReason(e.reason);
      } catch {
        // silent — section simply stays hidden
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [countryCode, stateId]);

  if (loading || !enabled) return null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">Congressional Districts</h3>
          <p className="text-xs text-muted">
            House seats here are decided district by district. The map can be redrawn in census
            years by a governor whose party also controls the state legislature.
          </p>
        </div>
        {canRedraw ? (
          <Link
            href={regionRedistrictUrl(countryCode, stateId)}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white"
          >
            Redraw this map →
          </Link>
        ) : redrawReason ? (
          <span className="text-xs text-muted">{redrawReason}</span>
        ) : null}
      </div>
      <DistrictCardGrid districts={districts} caps={caps} isAdmin={isAdmin} />
    </section>
  );
}
