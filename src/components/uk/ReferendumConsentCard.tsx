"use client";

import { useState } from "react";
import Link from "next/link";
import type { CountryId } from "@/lib/constants/countries";
import { referendumDetailUrl } from "@/lib/urls";

export interface ConsentReferendum {
  id: string;
  regionId: string;
  kind: "independence" | "reunification";
  status: "requested" | "granted" | "campaigning" | "actuating";
  campaignCloseTurn: number | null;
  conversionDeadlineTurn: number | null;
  yesShare: number;
  /** Current independence/reunification desire in the region (0–100), or null. */
  desire: number | null;
}

interface Props {
  countryId: CountryId;
  currentTurn: number;
  referendums: ConsentReferendum[];
  isPM: boolean;
  isAdmin: boolean;
  /** Called after a successful action so the caller can refetch. */
  onChanged: () => void;
}

const REGION_NAMES: Record<string, string> = {
  SCO: "Scotland",
  WAL: "Wales",
  NIR: "Northern Ireland",
};

function regionName(regionId: string): string {
  return REGION_NAMES[regionId.toUpperCase()] ?? regionId;
}

function desireLabel(kind: "independence" | "reunification"): string {
  return kind === "reunification" ? "Reunification desire" : "Independence desire";
}

/** Plain-language explanation of the PM's grant/decline decision. */
function requestBlurb(kind: "independence" | "reunification", region: string): string {
  if (kind === "reunification") {
    return (
      `${region}'s devolved government has petitioned for a referendum on leaving the United ` +
      `Kingdom to reunify with the Republic of Ireland. Granting it opens a public campaign and a ` +
      `ballot of ${region}'s electorate — and even if that carries, the transfer proceeds only if ` +
      `both the Commons and the Dáil consent. Declining rejects the petition for now.`
    );
  }
  return (
    `${region}'s devolved government has petitioned for a referendum on independence from the ` +
    `United Kingdom. Granting it opens a public campaign and a ballot of ${region}'s electorate; a ` +
    `Yes vote begins ${region}'s path to becoming a sovereign country. Declining rejects the ` +
    `petition for now.`
  );
}

/** Compact readout of the region's current independence/reunification desire. */
function DesireReadout({ kind, value }: { kind: "independence" | "reunification"; value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="mt-2 space-y-1">
      <div className="flex justify-between text-xs text-muted">
        <span>{desireLabel(kind)}</span>
        <span className="tabular-nums">{Math.round(pct)}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-background/60">
        <div className="h-full bg-amber-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ReferendumConsentCard({
  countryId,
  currentTurn,
  referendums,
  isPM,
  isAdmin,
  onChanged,
}: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (referendums.length === 0) return null;

  async function post(url: string, body: Record<string, unknown>, id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Action failed.");
        setBusyId(null);
        return;
      }
      setBusyId(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
      setBusyId(null);
    }
  }

  const base = `/api/country/${countryId.toLowerCase()}/referendum`;

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-amber-600">
        Referendums
      </h2>
      {error && (
        <div className="mt-3 rounded-md border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-500">
          {error}
        </div>
      )}
      <ul className="mt-3 space-y-3">
        {referendums.map((r) => {
          const noun = r.kind === "reunification" ? "reunification" : "independence";
          const busy = busyId === r.id;
          return (
            <li key={r.id} className="rounded-lg border border-card-border bg-card p-4">
              <div className="text-sm font-medium">
                {regionName(r.regionId)} {noun} referendum
              </div>

              {(r.status === "requested" || r.status === "granted") && r.desire != null && (
                <DesireReadout kind={r.kind} value={r.desire} />
              )}

              {r.status === "requested" && (
                <div className="mt-2 space-y-2">
                  <p className="text-sm text-muted">
                    {requestBlurb(r.kind, regionName(r.regionId))}
                  </p>
                  {isPM ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => post(`${base}/${r.id}/submit`, { action: "grant" }, r.id)}
                        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                      >
                        {busy ? "Granting…" : "Grant the referendum"}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => post(`${base}/${r.id}/submit`, { action: "decline" }, r.id)}
                        className="rounded-md border border-rose-500/50 px-4 py-2 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-500/10 disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted">
                      Awaiting the Prime Minister&apos;s decision to grant the referendum.
                    </p>
                  )}
                </div>
              )}

              {r.status === "granted" && (
                <p className="mt-2 text-sm text-muted">Granted — the campaign is opening.</p>
              )}

              {r.status === "campaigning" && (
                <div className="mt-2 space-y-2">
                  <div className="flex justify-between text-xs text-muted">
                    <span>Yes {Math.round(r.yesShare)}%</span>
                    <span>No {Math.round(100 - r.yesShare)}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-background/60">
                    <div className="h-full bg-primary" style={{ width: `${r.yesShare}%` }} />
                  </div>
                  <p className="text-xs text-muted">
                    Campaign under way.
                    {r.campaignCloseTurn != null &&
                      ` The vote is held on turn ${r.campaignCloseTurn}${
                        r.campaignCloseTurn > currentTurn
                          ? ` (in ${r.campaignCloseTurn - currentTurn} turns)`
                          : ""
                      }.`}
                  </p>
                  {/* Campaigning (PS spend) lives on the dedicated campaign
                      page; the executive card shows progress read-only. */}
                  <Link
                    href={referendumDetailUrl(countryId, r.regionId)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 hover:text-amber-500"
                  >
                    View Campaign →
                  </Link>
                </div>
              )}

              {r.status === "actuating" && (
                <div className="mt-2 space-y-2">
                  <p className="text-sm text-muted">
                    {r.kind === "reunification"
                      ? "Carried at the ballot box — now before BOTH the Commons and the Dáil. The region transfers only if both bills pass."
                      : "Carried at the ballot box — conversion under way."}
                    {r.conversionDeadlineTurn != null &&
                      (r.conversionDeadlineTurn > currentTurn
                        ? r.kind === "reunification"
                          ? ` The bills' votes close in ${r.conversionDeadlineTurn - currentTurn} turns.`
                          : ` Converts automatically in ${r.conversionDeadlineTurn - currentTurn} turns unless blocked.`
                        : " Resolving…")}
                  </p>
                  {isAdmin && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          post(`/api/admin/referendum/${r.id}/actuate`, { action: "resolve" }, r.id)
                        }
                        className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-600/90 disabled:opacity-50"
                      >
                        {busy
                          ? "Converting…"
                          : r.kind === "reunification"
                            ? `Convert now: ${regionName(r.regionId)} rejoins Ireland`
                            : `Convert now: ${regionName(r.regionId)} independence`}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          post(`/api/admin/referendum/${r.id}/actuate`, { action: "block" }, r.id)
                        }
                        className="rounded-md border border-rose-500/50 px-4 py-2 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-500/10 disabled:opacity-50"
                      >
                        Block
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
