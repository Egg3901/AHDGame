"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { CORPORATION_TYPES, type CorporationType } from "@/lib/constants/corporations";
import { MAX_STRATEGIC_SECTOR_DESIGNATIONS } from "@/lib/nationalization/constants";
import type { NatOfficialActions } from "../NationalCorporationView";

/**
 * Head-of-government strategic-sector designation: arms/disarms the strategic
 * nationalization trigger for a sector type. Calls POST/DELETE …/strategic-sector.
 * Spec §6.3/§8.
 */
export function StrategicSectorPanel({
  designated,
  official,
}: {
  designated: CorporationType[];
  official: NatOfficialActions;
}) {
  const code = official.countryId.toLowerCase();
  const [addType, setAddType] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null
  );

  const undesignated = CORPORATION_TYPES.filter((t) => !designated.includes(t));
  const atCap = designated.length >= MAX_STRATEGIC_SECTOR_DESIGNATIONS;

  async function mutate(httpMethod: "POST" | "DELETE", sectorType: string, ok: string) {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/country/${code}/strategic-sector`, {
        method: httpMethod,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectorType }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFeedback({ type: "error", message: json.error ?? "Action failed." });
      } else {
        setFeedback({ type: "success", message: ok });
        setAddType("");
        official.onRefresh();
      }
    } catch {
      setFeedback({ type: "error", message: "Network error." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-gold/30 bg-gold/5 p-5">
      <h3 className="text-body-sm font-semibold uppercase tracking-wide text-gold">
        Strategic sectors
      </h3>
      <p className="mt-1 text-body-xs text-muted">
        Designating a sector type arms the strategic nationalization trigger for corporations in it.{" "}
        <span className="text-gold/80">
          {designated.length} of {MAX_STRATEGIC_SECTOR_DESIGNATIONS} designated.
        </span>
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {designated.length === 0 ? (
          <span className="text-body-sm text-muted">None designated.</span>
        ) : (
          designated.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-body-xs capitalize text-gold"
            >
              {t}
              <button
                type="button"
                onClick={() => mutate("DELETE", t, `${t} removed.`)}
                disabled={busy}
                className="text-gold/70 hover:text-gold"
                aria-label={`Remove ${t}`}
              >
                ✕
              </button>
            </span>
          ))
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={addType}
          onChange={(e) => setAddType(e.target.value)}
          disabled={busy || undesignated.length === 0 || atCap}
          className="rounded border border-card-border bg-card-elevated px-2 py-1 text-body-sm"
        >
          <option value="">Select a sector type…</option>
          {undesignated.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <Button
          onClick={() => mutate("POST", addType, `${addType} designated.`)}
          disabled={busy || !addType || atCap}
        >
          Designate
        </Button>
      </div>

      {atCap && (
        <p className="mt-2 text-body-xs text-muted">
          Maximum of {MAX_STRATEGIC_SECTOR_DESIGNATIONS} strategic sectors reached — remove one to
          add another.
        </p>
      )}

      {feedback && (
        <p
          className={`mt-3 text-body-sm ${feedback.type === "success" ? "text-success" : "text-error"}`}
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}
