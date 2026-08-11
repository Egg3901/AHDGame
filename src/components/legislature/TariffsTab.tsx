"use client";

import { useState, useEffect } from "react";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";

type TariffEntry = {
  id: string;
  rate: number;
  scopeType: string;
  targetSectorType?: string;
  targetOriginCountryId?: string;
  targetCorporationId?: string;
  updatedAt: string;
};

const SCOPE_LABELS: Record<string, string> = {
  economy_wide: "Economy-wide",
  sector: "Sector",
  origin_country: "Origin Country",
  corporation: "Corporation",
};

export function TariffsTab({ countryId }: { countryId: string }) {
  const [tariffs, setTariffs] = useState<TariffEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/tariffs?countryId=${countryId}`)
      .then((r) => r.json())
      .then((data) => {
        setTariffs(data.tariffs ?? []);
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

  if (tariffs.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card/60 p-6 text-center text-sm text-muted-foreground">
        No active tariffs.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {tariffs.map((t) => (
        <div
          key={t.id}
          className={`flex items-center justify-between rounded-lg border border-border bg-card/60 px-4 py-3 ${t.rate === 0 ? "opacity-50" : ""}`}
        >
          <div className="space-y-0.5">
            <p className="text-sm font-medium">{SCOPE_LABELS[t.scopeType] ?? t.scopeType}</p>
            <p className="text-xs text-muted-foreground">
              {t.targetSectorType
                ? `Sector: ${CORPORATION_TYPE_LABELS[t.targetSectorType as CorporationType] ?? t.targetSectorType}`
                : t.targetOriginCountryId
                  ? `Origin: ${t.targetOriginCountryId}`
                  : t.targetCorporationId
                    ? `Corp ID: ${t.targetCorporationId}`
                    : "All foreign corps"}
            </p>
          </div>
          <div className="text-right">
            <p
              className={`text-sm font-semibold ${t.rate === 0 ? "text-muted-foreground" : "text-amber-400"}`}
            >
              {t.rate === 0 ? "Nullified" : `${t.rate}%`}
            </p>
            <p className="text-xs text-muted-foreground">
              {new Date(t.updatedAt).toLocaleDateString("en-US")}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
