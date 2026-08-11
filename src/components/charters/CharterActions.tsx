"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

/**
 * Phase 6 D6 — sign / reject buttons for a charter detail page.
 *
 * Caller renders this only when the viewer is one of the charter's
 * founders AND the charter is in `pending-signatures` state. Both buttons
 * round-trip the API and refresh the page on success so the new
 * signature row + ratification status are reflected.
 */
interface CharterActionsProps {
  charterId: string;
  alreadySigned: boolean;
  alreadyRejected: boolean;
}

export function CharterActions({ charterId, alreadySigned, alreadyRejected }: CharterActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState<"sign" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const sign = async () => {
    setError(null);
    setPending("sign");
    try {
      const res = await fetch(`/api/charters/${charterId}/sign`, { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Failed to sign");
        setPending(null);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setPending(null);
    }
  };

  const reject = async () => {
    setError(null);
    setPending("reject");
    try {
      const res = await fetch(`/api/charters/${charterId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rejectReason ? { reason: rejectReason } : {}),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Failed to reject");
        setPending(null);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setPending(null);
    }
  };

  if (alreadySigned) {
    return (
      <div className="rounded-md border border-success/40 bg-success/10 p-3 text-sm text-success">
        You have signed this charter.
      </div>
    );
  }

  if (alreadyRejected) {
    return (
      <div className="rounded-md border border-error/40 bg-error/10 p-3 text-sm text-error">
        You have rejected this charter. The proposer can replace your slot via the
        founder-replacement flow.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={sign} disabled={pending !== null} className="flex-1">
          {pending === "sign" ? "Signing…" : "Sign Charter"}
        </Button>
        <Button
          onClick={() => setShowRejectInput((v) => !v)}
          disabled={pending !== null}
          variant="secondary"
          className="flex-1"
        >
          {showRejectInput ? "Cancel reject" : "Reject Charter"}
        </Button>
      </div>
      {showRejectInput && (
        <div className="space-y-2">
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Optional reason (max 500 chars)"
            maxLength={500}
            rows={2}
            className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
          />
          <Button
            onClick={reject}
            disabled={pending !== null}
            variant="destructive"
            className="w-full"
          >
            {pending === "reject" ? "Rejecting…" : "Confirm rejection"}
          </Button>
        </div>
      )}
      {error && (
        <div className="rounded-md border border-error/40 bg-error/10 p-3 text-sm text-error">
          {error}
        </div>
      )}
    </div>
  );
}
