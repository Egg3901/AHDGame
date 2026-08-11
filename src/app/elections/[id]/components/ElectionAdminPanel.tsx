"use client";

import { useState } from "react";
import { getMessageStyle } from "@/lib/utils/formatters";

interface ElectionAdminPanelProps {
  electionId: string;
  inPrimary: boolean;
  isEnded: boolean;
  onSuccess: () => void;
}

export function ElectionAdminPanel({
  electionId,
  inPrimary,
  isEnded,
  onSuccess,
}: ElectionAdminPanelProps) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleResolveElection = async () => {
    if (
      !confirm(
        "Resolve this election now? This will determine the winner(s) and update officials. Cannot be undone."
      )
    )
      return;
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch(`/api/admin/elections/${electionId}/resolve`, {
        method: "POST",
      });
      const data = await res.json();
      setMessage(res.ok ? `✓ ${data.message}` : `✗ ${data.error}`);
      if (res.ok) onSuccess();
    } catch {
      setMessage("✗ Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm font-medium text-amber-400">Admin Controls</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {!isEnded && (
          <button
            onClick={handleResolveElection}
            disabled={loading || inPrimary}
            className="rounded-lg border border-amber-500/50 bg-amber-500/20 px-3 py-2 text-sm font-medium text-amber-400 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
            title={
              inPrimary
                ? "End primary first, then resolve"
                : "Resolve election now and determine winner(s)"
            }
          >
            {loading ? "…" : "Resolve Election"}
          </button>
        )}
      </div>
      {message && (
        <div className={`mt-3 rounded-lg p-2 text-sm ${getMessageStyle(message)}`}>{message}</div>
      )}
    </div>
  );
}
