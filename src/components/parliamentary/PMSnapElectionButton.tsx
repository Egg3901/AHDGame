"use client";

import { useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import type { CountryId } from "@/lib/constants/countries";

interface Props {
  countryId: CountryId;
  snapElectionsUsed: number;
  snapElectionsRemaining: number;
  cooldownTurnsRemaining: number;
  onTriggered: () => void;
}

export function PMSnapElectionButton({
  countryId,
  snapElectionsUsed,
  snapElectionsRemaining,
  cooldownTurnsRemaining,
  onTriggered,
}: Props) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const disabled = snapElectionsRemaining === 0 || cooldownTurnsRemaining > 0;
  const total = snapElectionsUsed + snapElectionsRemaining;

  async function trigger() {
    setBusy(true);
    setConfirming(false);
    try {
      const res = await fetch(`/api/country/${countryId.toLowerCase()}/pm/snap-election`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message ?? "Snap election triggered.", "success");
        onTriggered();
      } else {
        showToast(data.error ?? "Failed to trigger snap election.", "error");
      }
    } catch {
      showToast("Network error.", "error");
    } finally {
      setBusy(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-warning">
          Dissolve the lower chamber and call a snap election? All active legislation will fail.
        </span>
        <button
          onClick={trigger}
          disabled={busy}
          className="rounded-lg bg-warning px-3 py-1.5 text-xs font-semibold text-black hover:bg-warning/90 disabled:opacity-50 transition-colors"
        >
          {busy ? "Triggering…" : "Confirm"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="rounded-lg border border-card-border px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => setConfirming(true)}
        disabled={disabled}
        className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs font-semibold text-warning hover:bg-warning/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Call Snap Election
      </button>
      <span className="text-xs text-muted">
        {snapElectionsUsed} / {total} used
        {cooldownTurnsRemaining > 0 && ` • cooldown: ${cooldownTurnsRemaining} turns`}
      </span>
    </div>
  );
}
