"use client";

import { useState, useEffect } from "react";
import { getCountryConfig } from "@/lib/constants/countries";
import type { CountryId } from "@/lib/constants/countries";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";

type SubsidyEntry = {
  id: string;
  scope: string;
  stateId?: string;
  scopeType: string;
  targetSectorType?: string;
  targetStrategyId?: string;
  domesticOnly?: boolean;
  updatedAt: string;
};

export function SubsidiesTab({ countryId }: { countryId: CountryId }) {
  const regionLabel = getCountryConfig(countryId).regionLabel;
  const [subsidies, setSubsidies] = useState<SubsidyEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/subsidies?countryId=${countryId}`)
      .then((r) => r.json())
      .then((data) => {
        setSubsidies(data.subsidies ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [countryId]);

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-12 rounded-lg bg-card/60 animate-pulse" />
        ))}
      </div>
    );
  }

  if (subsidies.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card/60 p-6 text-center text-sm text-muted-foreground">
        No active sector subsidies.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {subsidies.map((s) => (
        <div
          key={s.id}
          className="flex items-center justify-between rounded-lg border border-border bg-card/60 px-4 py-3"
        >
          <div className="space-y-0.5">
            <p className="text-sm font-medium">
              {s.scope === "state" ? `${regionLabel} — ${s.stateId}` : "National"}
              {" · "}
              {s.scopeType === "economy_wide"
                ? "Economy-wide"
                : `Sector: ${CORPORATION_TYPE_LABELS[s.targetSectorType as CorporationType] ?? s.targetSectorType}`}
              {s.targetStrategyId ? ` (${s.targetStrategyId})` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              {s.domesticOnly ? "Domestic corps only" : "All corps"}
              {" · "}updated {new Date(s.updatedAt).toLocaleDateString("en-US")}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-emerald-400">+7.5% margin</p>
          </div>
        </div>
      ))}
    </div>
  );
}
