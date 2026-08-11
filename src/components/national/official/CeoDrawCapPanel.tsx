"use client";

import { useState } from "react";
import { Button, SectionLabel } from "@/components/ui";
import type { NatOfficialActions } from "../NationalCorporationView";
import { natMoney } from "../natMoney";

/**
 * Finance-minister control over the CEO's per-turn treasury-draw cap (spec P6g
 * §5.2) — throttle a National Corporation CEO's access to the people's budget.
 * Treasury-gated server-side (POST …/draw-cap). Tokens only.
 */
export function CeoDrawCapPanel({
  currentCap,
  currency,
  official,
}: {
  currentCap: number;
  currency: string;
  official: NatOfficialActions;
}) {
  const code = official.countryId.toLowerCase();
  const [cap, setCap] = useState(String(currentCap));
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null
  );

  async function save() {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/country/${code}/national-corporation/${official.corpId}/draw-cap`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cap: Math.max(0, Number(cap) || 0) }),
        }
      );
      const json = await res.json();
      if (!res.ok) setFeedback({ type: "error", message: json.error ?? "Action failed." });
      else {
        setFeedback({ type: "success", message: "Draw cap updated." });
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
      <SectionLabel>CEO treasury-draw cap</SectionLabel>
      <p className="mt-1 text-body-xs text-muted">
        The most the CEO may draw from the people&apos;s budget per turn. Set to 0 to freeze draws.
        Current: {natMoney(currentCap, currency)}.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <input
          type="number"
          min={0}
          value={cap}
          onChange={(e) => setCap(e.target.value)}
          disabled={busy}
          className="w-40 rounded border border-card-border bg-card-elevated px-2 py-1 text-body-sm"
        />
        <Button onClick={save} disabled={busy}>
          Set cap
        </Button>
      </div>
      {feedback && (
        <p
          className={`mt-2 text-body-sm ${feedback.type === "success" ? "text-success" : "text-error"}`}
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}
