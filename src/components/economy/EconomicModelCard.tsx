"use client";

import { useEffect, useState } from "react";
import type { EconomicModelView } from "@/lib/economicModels/present";

interface EconomicModelCardProps {
  countryId: string;
  /** When set, shows the region's identity instead of the national one. */
  regionId?: string;
  /** Heading label (e.g. "National" or a region name). Defaults to "National". */
  scopeLabel?: string;
}

const BAND_TONE: Record<string, string> = {
  Mixed: "text-muted",
  Emerging: "text-warning",
  Established: "text-primary",
  Dominant: "text-success",
};

function DriverBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[11px] text-muted">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-card-muted">
        <div className="h-full rounded-full bg-primary/60" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-muted">{pct}%</span>
    </div>
  );
}

/** "National Economic Model" identity card (P7a — descriptive only; effects in P7b). */
export function EconomicModelCard({ countryId, regionId, scopeLabel }: EconomicModelCardProps) {
  const [model, setModel] = useState<EconomicModelView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty">("loading");

  useEffect(() => {
    let cancelled = false;
    const url = `/api/country/${countryId}/economic-model${regionId ? `?regionId=${encodeURIComponent(regionId)}` : ""}`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: EconomicModelView) => {
        if (cancelled) return;
        // Guard against a non-model payload (error body, unexpected shape) — hide the
        // card rather than crash on missing fields.
        if (
          !data ||
          typeof data.currentName !== "string" ||
          !Array.isArray(data.signatureSectors)
        ) {
          setState("empty");
          return;
        }
        setModel(data);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("empty");
      });
    return () => {
      cancelled = true;
    };
  }, [countryId, regionId]);

  if (state === "empty") return null; // nothing classified yet — hide the card
  const heading = `${scopeLabel ?? "National"} Economic Model`;

  if (state === "loading" || !model) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-4">
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
          {heading}
        </div>
        <div className="mt-2 h-5 w-40 animate-pulse rounded bg-card-muted" />
      </div>
    );
  }

  const tone = BAND_TONE[model.band] ?? "text-foreground";

  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">{heading}</div>

      <div className="mt-1 flex items-baseline justify-between gap-3">
        <h3 className="text-lg font-bold text-foreground">{model.currentName}</h3>
        <span className={`text-[12px] font-semibold ${tone}`}>{model.band}</span>
      </div>

      {/* intensity meter */}
      <div className="mt-2">
        <div className="flex justify-between text-[11px] text-muted">
          <span>Intensity</span>
          <span className="tabular-nums">{model.intensity}/100</span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-card-muted">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${model.intensity}%` }}
          />
        </div>
      </div>

      {model.signatureSectors.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {model.signatureSectors.map((s, i) => (
            <span
              key={s}
              className={`rounded px-2 py-0.5 text-[11px] ${
                i === 0 ? "bg-primary/15 font-semibold text-primary" : "bg-card-muted text-muted"
              }`}
            >
              {s}
            </span>
          ))}
        </div>
      )}

      {model.drivers && (
        <div className="mt-3 space-y-1 border-t border-card-border pt-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
            What&apos;s driving this
          </div>
          <DriverBar label="Sectors" value={model.drivers.sector} />
          <DriverBar label="Spending" value={model.drivers.spend} />
          <DriverBar label="Laws" value={model.drivers.law} />
        </div>
      )}

      {model.challenger && (
        <div className="mt-3 rounded-lg bg-card-muted px-3 py-2 text-[12px]">
          <span className="text-muted">Challenger: </span>
          <span className="font-semibold text-foreground">{model.challenger.name}</span>
          <span className="text-muted">
            {" "}
            · {model.challenger.turnsLeading}/{model.challenger.switchTurns} turns
          </span>
        </div>
      )}
    </div>
  );
}

export default EconomicModelCard;
