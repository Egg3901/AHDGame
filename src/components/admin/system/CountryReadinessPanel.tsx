"use client";

import { useState } from "react";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { useRegisteredCountries } from "@/contexts/RegisteredCountriesContext";

interface ReadinessCheck {
  name: string;
  status: "ok" | "missing" | "warning";
  count?: number;
  detail?: string;
}

interface ReadinessReport {
  ready: boolean;
  summary: { ok: number; warning: number; missing: number };
  checks: ReadinessCheck[];
}

function statusColor(status: ReadinessCheck["status"]): string {
  if (status === "ok") return "text-green-400";
  if (status === "warning") return "text-amber-400";
  return "text-red-400";
}

export function CountryReadinessPanel() {
  const registered = useRegisteredCountries();
  const [countryId, setCountryId] = useState<CountryId>("US");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDiagnose() {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch(`/api/admin/country/${countryId.toLowerCase()}/readiness`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to diagnose");
      } else {
        setReport(data as ReadinessReport);
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 space-y-3">
      <h3 className="text-sm font-semibold text-white">Country Readiness Diagnostic</h3>
      <p className="text-xs text-muted">
        Run the seed/collection readiness checks for a country. Reads only — never writes. Lists
        per-check status (regions, parties, statePartyOrg, seats, NPPs, elected officials,
        demographics, state metrics, legislation types, plus country-specific extras).
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted" htmlFor="country-readiness-select">
          Country
        </label>
        <select
          id="country-readiness-select"
          value={countryId}
          onChange={(e) => setCountryId(e.target.value as CountryId)}
          disabled={loading}
          className="text-sm px-2 py-1 rounded border border-card-border bg-card-elevated text-white disabled:opacity-40"
        >
          {registered.map((id) => (
            <option key={id} value={id}>
              {COUNTRY_CONFIGS[id].name} ({id})
            </option>
          ))}
        </select>
        <button
          onClick={handleDiagnose}
          disabled={loading}
          className="text-sm px-3 py-1.5 rounded border border-white/20 text-white hover:bg-white/10 disabled:opacity-40 transition-colors"
        >
          {loading ? "Checking…" : "Diagnose"}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {report && (
        <div className="text-xs space-y-2">
          <p>
            <span className={`font-medium ${report.ready ? "text-green-400" : "text-amber-400"}`}>
              {report.ready ? "Ready" : "Not ready"}
            </span>
            <span className="text-muted">
              {" "}
              — <span className="text-green-400">{report.summary.ok} ok</span>,{" "}
              <span className="text-amber-400">{report.summary.warning} warning</span>,{" "}
              <span className="text-red-400">{report.summary.missing} missing</span>
            </span>
          </p>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {report.checks.map((c) => (
              <div
                key={c.name}
                className="rounded border border-card-border/50 bg-card-elevated p-2"
              >
                <p>
                  <span className={statusColor(c.status)}>[{c.status}]</span>{" "}
                  <span className="font-medium text-foreground">{c.name}</span>
                  {typeof c.count === "number" && <span className="text-muted"> · {c.count}</span>}
                </p>
                {c.detail && <p className="text-muted">{c.detail}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
