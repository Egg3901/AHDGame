"use client";

import { useCallback, useEffect, useState } from "react";
import { LocalTime } from "@/components/time/LocalTime";

interface SupporterRequestRow {
  _id: string;
  kind: "wall-name" | "npp-rename";
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  decidedAt: string | null;
  rejectionReason: string | null;
  proposedName: string | null;
  nppSequentialId: number | null;
  currentNppName: string | null;
  proposedNppName: string | null;
  requesterName: string;
  requesterUsername: string | null;
  requesterTier: string | null;
}

function tierLabel(tier: string | null): string {
  if (tier === "supporter-plus-plus") return "Supporter++";
  if (tier === "supporter-plus") return "Supporter+";
  if (tier === "supporter") return "Supporter";
  return "None";
}

function requestSummary(r: SupporterRequestRow): string {
  if (r.kind === "wall-name") return `Wall name: "${r.proposedName ?? ""}"`;
  return `Rename "${r.currentNppName ?? ""}" to "${r.proposedNppName ?? ""}"`;
}

export function SupporterRequestsTab() {
  const [pending, setPending] = useState<SupporterRequestRow[]>([]);
  const [decided, setDecided] = useState<SupporterRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/moderator/supporter-requests");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load supporter requests");
        return;
      }
      setPending(data.pending ?? []);
      setDecided(data.decided ?? []);
    } catch {
      setError("Failed to load supporter requests");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(id: string, decision: "approve" | "reject", reason?: string) {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/moderator/supporter-requests/${id}/${decision}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reason ? { reason } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Failed to ${decision} request`);
        return;
      }
      setRejectingId(null);
      setRejectReason("");
      await load();
    } catch {
      setError(`Failed to ${decision} request`);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <div className="text-muted">Loading supporter requests...</div>;
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-500">
          {error}
        </div>
      )}

      <div>
        <h2 className="text-xl font-bold text-foreground mb-3">
          Pending Supporter Requests ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-muted text-sm py-6 text-center">No pending supporter requests</p>
        ) : (
          <div className="bg-card border border-card-border rounded-lg divide-y divide-card-border">
            {pending.map((r) => (
              <div key={r._id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">{requestSummary(r)}</p>
                    <p className="text-sm text-muted mt-1">
                      By {r.requesterName}
                      {r.requesterUsername ? ` (@${r.requesterUsername})` : ""} | Tier:{" "}
                      {tierLabel(r.requesterTier)} |{" "}
                      <LocalTime value={r.createdAt} options={{ dateStyle: "medium" }} />
                    </p>
                    {r.kind === "npp-rename" && r.nppSequentialId != null && (
                      <p className="text-xs text-muted mt-1">Politician #{r.nppSequentialId}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => decide(r._id, "approve")}
                      disabled={busyId === r._id}
                      className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => {
                        setRejectingId(rejectingId === r._id ? null : r._id);
                        setRejectReason("");
                      }}
                      disabled={busyId === r._id}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                </div>
                {rejectingId === r._id && (
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      type="text"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Rejection reason (optional)"
                      maxLength={500}
                      className="flex-1 rounded-lg border border-card-border bg-background px-3 py-1.5 text-sm text-foreground"
                    />
                    <button
                      onClick={() => decide(r._id, "reject", rejectReason.trim() || undefined)}
                      disabled={busyId === r._id}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      Confirm Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-lg font-semibold text-foreground mb-3">Recently Decided</h3>
        {decided.length === 0 ? (
          <p className="text-muted text-sm">No decided requests yet</p>
        ) : (
          <div className="bg-card border border-card-border rounded-lg divide-y divide-card-border">
            {decided.map((r) => (
              <div key={r._id} className="p-3 text-sm">
                <span
                  className={`mr-2 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                    r.status === "approved"
                      ? "bg-green-500/15 text-green-500"
                      : "bg-red-500/15 text-red-500"
                  }`}
                >
                  {r.status}
                </span>
                <span className="text-foreground">{requestSummary(r)}</span>
                <span className="text-muted"> by {r.requesterName}</span>
                {r.rejectionReason && (
                  <span className="text-muted"> (Reason: {r.rejectionReason})</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
