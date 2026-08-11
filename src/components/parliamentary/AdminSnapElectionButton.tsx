"use client";

import { useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import type { CountryId } from "@/lib/constants/countries";

interface Props {
  countryId: CountryId;
  onDone: () => void;
}

export function AdminSnapElectionButton({ countryId, onDone }: Props) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function trigger() {
    setBusy(true);
    setConfirming(false);
    try {
      const res = await fetch(`/api/admin/elections/snap/${countryId}`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message ?? "Snap election triggered.", "success");
        onDone();
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
      <div className="flex items-center gap-2">
        <span className="text-xs text-warning">
          Cancel all active races and open primaries now?
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
    <button
      onClick={() => setConfirming(true)}
      className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs font-semibold text-warning hover:bg-warning/20 transition-colors"
    >
      Trigger Snap Election
    </button>
  );
}
