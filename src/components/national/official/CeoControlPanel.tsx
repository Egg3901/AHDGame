"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { PlayerSelector } from "@/components/PlayerSelector";
import type { NationalCorporationViewModel } from "@/lib/nationalization/nationalCorporationView";
import type { NatOfficialActions } from "../NationalCorporationView";

/**
 * State-official CEO control for a National Corporation: nominate (offer) a CEO
 * via the existing appoint-ceo flow, or remove the seated CEO. Rendered on the
 * Overview tab only when the viewer holds treasury authority. Spec §24.3.
 */
export function CeoControlPanel({
  ceo,
  official,
}: {
  ceo: NationalCorporationViewModel["ceo"];
  official: NatOfficialActions;
}) {
  const code = official.countryId.toLowerCase();
  const [nomineeId, setNomineeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null
  );

  async function appoint() {
    if (!nomineeId || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/country/${code}/national-corporation/${official.corpId}/appoint-ceo`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nomineeCharacterId: nomineeId }),
        }
      );
      const json = await res.json();
      if (!res.ok) {
        setFeedback({ type: "error", message: json.error ?? "Appointment failed." });
      } else {
        setFeedback({ type: "success", message: "Nomination sent — awaiting acceptance." });
        setNomineeId(null);
        official.onRefresh();
      }
    } catch {
      setFeedback({ type: "error", message: "Network error." });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/country/${code}/national-corporation/${official.corpId}/remove-ceo`,
        { method: "POST" }
      );
      const json = await res.json();
      if (!res.ok) {
        setFeedback({ type: "error", message: json.error ?? "Removal failed." });
      } else {
        setFeedback({ type: "success", message: "CEO removed; seat vacated." });
        official.onRefresh();
      }
    } catch {
      setFeedback({ type: "error", message: "Network error." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-gold/30 bg-gold/5 p-5 lg:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-body-sm font-semibold uppercase tracking-wide text-gold">
          Chief executive
        </h3>
        <span className="text-body-xs text-muted">
          {ceo.vacant
            ? ceo.pendingName
              ? `Offer pending: ${ceo.pendingName}`
              : "Vacant"
            : `Seated: ${ceo.name ?? "—"}`}
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
        <div>
          <PlayerSelector
            countryId={official.countryId}
            placeholder="Search for a CEO nominee…"
            onSelect={(c) => setNomineeId(c.id)}
          />
          <p className="mt-1 text-body-xs text-muted">
            The nominee must accept before taking the seat.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={appoint} disabled={!nomineeId || busy}>
            {busy ? "Working…" : "Nominate"}
          </Button>
          {!ceo.vacant && (
            <Button variant="destructive" onClick={remove} disabled={busy}>
              Remove
            </Button>
          )}
        </div>
      </div>

      {feedback && (
        <p
          className={`mt-3 text-body-sm ${
            feedback.type === "success" ? "text-success" : "text-error"
          }`}
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}
