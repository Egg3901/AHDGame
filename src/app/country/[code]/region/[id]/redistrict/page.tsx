"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { canonicalRegionId } from "@/lib/constants/countries";
import { DistrictMapEditor } from "@/components/redistricting/DistrictMapEditor";
import { DistrictCompositionSummary } from "@/components/redistricting/DistrictCompositionSummary";
import { RedistrictingGuide } from "@/components/redistricting/RedistrictingGuide";
import type { DistrictSquares } from "@/lib/db/types/congressionalDistrict";
import type { RedistrictCaps } from "@/lib/redistricting/caps";

interface EditorData {
  canRedraw: boolean;
  reason: string | null;
  districts: { index: number; squares: DistrictSquares }[];
  budget: DistrictSquares;
  caps: RedistrictCaps;
  isAdminOverride?: boolean;
}

export default function RedistrictPage({
  params,
}: {
  params: Promise<{ code: string; id: string }>;
}) {
  const { code, id: rawRegionParam } = use(params);
  const id = canonicalRegionId(code.toUpperCase(), rawRegionParam);
  const [data, setData] = useState<EditorData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/country/${code.toLowerCase()}/region/${id.toLowerCase()}/redistrict`)
      .then((r) => (r.ok ? r.json() : r.json().then((d) => Promise.reject(d.error ?? "Failed"))))
      .then(setData)
      .catch((e) => setError(typeof e === "string" ? e : "Failed to load"));
  }, [code, id]);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div>
          <Link
            href={`/country/${code.toLowerCase()}/region/${id.toLowerCase()}`}
            className="text-sm text-primary hover:underline"
          >
            ← Back to {id.toUpperCase()}
          </Link>
          <h1 className="text-3xl font-bold mt-2">Redistrict {id.toUpperCase()}</h1>
        </div>
        <RedistrictingGuide />
        {error && <p className="text-error">{error}</p>}
        {data?.isAdminOverride ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            Admin override — normal redistricting gates are bypassed for this session.
          </div>
        ) : null}
        {data && !data.canRedraw && (
          <>
            <div className="rounded-lg border border-card-border bg-card px-4 py-3 text-sm text-muted">
              {data.reason ?? "You cannot redraw this map right now."}
            </div>
            {data.districts.length > 0 && (
              <DistrictCompositionSummary
                districts={data.districts.map((d) => d.squares)}
                caps={data.caps}
                title="Current map"
              />
            )}
          </>
        )}
        {data && data.canRedraw && (
          <DistrictMapEditor
            countryId={code}
            stateId={id}
            districts={data.districts}
            budget={data.budget}
            caps={data.caps}
          />
        )}
      </div>
    </div>
  );
}
