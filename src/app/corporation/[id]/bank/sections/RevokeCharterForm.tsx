"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";
import type { ShowToast } from "../types";

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
      showToast("Charter revoked", "success");
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-error/30 bg-error/5 p-5 space-y-3 max-w-xl">
      <h3 className="text-base font-semibold text-error">Revoke charter</h3>
      <p className="text-sm text-muted">
        Central bank chair of this currency, or an admin. The CEO cannot self-revoke.
      </p>
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason"
        maxLength={500}
        aria-label="Revocation reason"
      />
      <Button type="button" variant="destructive" onClick={() => void revoke()} disabled={busy}>
        {busy ? "Revoking..." : "Revoke charter"}
      </Button>
    </section>
  );
}
