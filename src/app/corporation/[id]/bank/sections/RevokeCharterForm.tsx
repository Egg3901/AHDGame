"use client";

import { useState } from "react";
import type { ShowToast } from "../types";
import { SmallButton } from "@/components/corporation/dense/DenseKit";
import { BankPanel } from "../components/BankSection";

export function RevokeCharterForm({
  corporationId,
  onChanged,
  showToast,
}: {
  corporationId: string;
  onChanged: () => Promise<void>;
  showToast: ShowToast;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const revoke = async () => {
    if (!reason.trim()) {
      showToast("Reason is required", "error");
      return;
    }
    if (!confirm("Revoke this bank charter? This cannot be undone by the CEO.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/charter`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(json.error ?? "Could not revoke charter", "error");
        return;
      }
      showToast(
        "Charter revoked: the book winds up in an orderly way, depositors are paid out, and remaining capital returns to the owner.",
        "success"
      );
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <BankPanel kind="supervision" title="Revoke charter" className="max-w-2xl">
      <div className="space-y-2 py-1.5">
        <p className="text-xs text-muted">
          Central bank chair of this currency, or an admin. The CEO cannot self-revoke.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason"
            maxLength={500}
            aria-label="Revocation reason"
            className="h-8 min-w-0 flex-1 rounded-md border border-card-border bg-background px-2 text-[13px] text-foreground placeholder:text-muted focus:border-foreground focus:outline-none"
          />
          <SmallButton tone="danger" onClick={() => void revoke()} disabled={busy}>
            {busy ? "Revoking..." : "Revoke charter"}
          </SmallButton>
        </div>
      </div>
    </BankPanel>
  );
}
