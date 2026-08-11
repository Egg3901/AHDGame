"use client";

import { Fragment, useEffect, useState } from "react";

interface ReadinessCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  severity: "required" | "recommended";
}

interface CountryReadiness {
  countryId: string;
  name: string;
  governmentType: string;
  enabledForPlayers: boolean;
  ready: boolean;
  checks: ReadinessCheck[];
}

/**
 * Per-country V1 autonomy seeded-readiness diagnostic. Tells an admin, before
 * flipping NPP autonomy to v1, whether each country has the seeded entities the
 * governing brain needs (states, NPPs, parties, lower-chamber seats, cabinet).
 */
export function NppV1ReadinessPanel() {
  const [countries, setCountries] = useState<CountryReadiness[] | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/npp-v1-readiness")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { countries: CountryReadiness[] }) => {
        if (!cancelled) setCountries(d.countries);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
      <div className="border-b border-card-border bg-background/50 px-4 py-3">
        <p className="text-sm font-semibold">V1 Autonomy Readiness</p>
        <p className="text-xs text-muted mt-0.5">
          Whether each country is seeded well enough for the V1 governing brain to produce a working
          government. Player-enabled countries are run by players (V1 does not act there).
        </p>
      </div>

      {error && <p className="px-4 py-3 text-sm text-error">{error}</p>}
      {!countries && !error && <p className="px-4 py-6 text-center text-sm text-muted">Loading…</p>}

      {countries && (
        <table className="w-full text-sm">
          <thead className="bg-background/30">
            <tr>
              {["Country", "Government", "V1 Ready", ""].map((h) => (
                <th
                  key={h}
                  className="px-4 py-2 text-left text-xs font-medium text-muted uppercase tracking-wider"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border">
            {countries.map((c) => {
              const failedRequired = c.checks.filter((k) => k.severity === "required" && !k.ok);
              const open = expanded === c.countryId;
              return (
                <Fragment key={c.countryId}>
                  <tr
                    className="hover:bg-background/40 transition-colors cursor-pointer"
                    onClick={() => setExpanded(open ? null : c.countryId)}
                  >
                    <td className="px-4 py-3 font-medium">
                      {c.countryId}
                      <span className="ml-2 text-xs text-muted">{c.name}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">{c.governmentType}</td>
                    <td className="px-4 py-3">
                      {c.enabledForPlayers ? (
                        <span className="rounded-full bg-muted/20 px-2 py-0.5 text-xs text-muted">
                          Player-run (N/A)
                        </span>
                      ) : c.ready ? (
                        <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">
                          ✓ Ready
                        </span>
                      ) : (
                        <span className="rounded-full bg-error/15 px-2 py-0.5 text-xs text-error">
                          ✗ {failedRequired.length} missing
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted text-right">{open ? "▲" : "▼"}</td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={4} className="bg-background/20 px-4 py-3">
                        <ul className="space-y-1.5">
                          {c.checks.map((k) => (
                            <li key={k.id} className="flex items-center gap-2 text-xs">
                              <span className={k.ok ? "text-success" : "text-error"}>
                                {k.ok ? "✓" : "✗"}
                              </span>
                              <span className="font-medium">{k.label}</span>
                              {k.severity === "recommended" && (
                                <span className="rounded bg-muted/20 px-1.5 py-0.5 text-[10px] text-muted">
                                  optional
                                </span>
                              )}
                              <span className="text-muted">— {k.detail}</span>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
