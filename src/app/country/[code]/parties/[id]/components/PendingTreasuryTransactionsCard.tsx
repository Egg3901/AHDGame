"use client";

import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui";

/**
 * "Pending Transactions" list above the Treasury Transaction Log.
 *
 * Shows in-flight two-person-approval rows for Send-to-Member and
 * Transfer-to-State-Party actions. The proposer's slot is pre-filled
 * (✅) at propose-time. The other slot shows an explicit Approve
 * button visible only to the eligible role-holder. Proposer also sees
 * a Cancel button while the row is open.
 *
 * Empty state: "No pending transactions."
 *
 * Refreshes on Approve/Cancel via the parent's `onActed` callback when
 * provided; otherwise re-fetches in place.
 */

interface PendingApprovalSlot {
  characterId: string;
  characterName: string;
  approvedAt: string;
}

interface PendingTransaction {
  id: string;
  type: "send" | "transfer" | "request";
  approvalMode: "single" | "double";
  amount: number;
  proposedBy: string;
  proposedByName: string;
  proposedAtTurn: number;
  proposedAt: string;
  expiresAtTurn: number;
  note: string | null;
  recipient:
    | { kind: "character"; id: string; name: string }
    | { kind: "state"; id: string; name: string }
    | null;
  treasurerApproval: PendingApprovalSlot | null;
  leadershipApproval: PendingApprovalSlot | null;
  canApprove: boolean;
  canCancel: boolean;
}

interface Response {
  items: PendingTransaction[];
}

interface Props {
  countryCode: string;
  partyId: string;
  /** Called after a successful approve / cancel so the parent can refresh treasury balance / transaction log. */
  onActed?: () => void;
}

const TYPE_LABEL: Record<PendingTransaction["type"], string> = {
  send: "Send to Member",
  transfer: "Transfer to State Party",
  request: "Request Funds",
};

export function PendingTreasuryTransactionsCard({ countryCode, partyId, onActed }: Props) {
  const [items, setItems] = useState<PendingTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchPending = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/country/${countryCode}/parties/${partyId}/treasury/pending`);
      if (!res.ok) {
        setError("Failed to load pending transactions");
        return;
      }
      const data = (await res.json()) as Response;
      setItems(data.items ?? []);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [countryCode, partyId]);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  const handleApprove = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(
        `/api/country/${countryCode}/parties/${partyId}/treasury/pending/${id}/approve`,
        { method: "POST" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Approve failed");
        return;
      }
      await fetchPending();
      onActed?.();
    } catch {
      setError("Network error");
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(
        `/api/country/${countryCode}/parties/${partyId}/treasury/pending/${id}/cancel`,
        { method: "POST" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Cancel failed");
        return;
      }
      await fetchPending();
      onActed?.();
    } catch {
      setError("Network error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="rounded-xl border border-card-border bg-card p-6 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Pending Transactions</h3>
        <button
          onClick={fetchPending}
          className="text-xs text-muted hover:text-foreground"
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {loading && items.length === 0 ? (
        <div className="min-h-[8rem] space-y-3">
          <div className="flex gap-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-3 flex-1" />
            ))}
          </div>
          {[1, 2].map((i) => (
            <div key={i} className="flex gap-3 border-t border-card-border pt-3">
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
              <Skeleton className="h-3.5 flex-1" />
              <Skeleton className="h-3.5 flex-1" />
              <Skeleton className="h-3.5 flex-1" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">No pending transactions.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted uppercase tracking-wider">
              <tr>
                <th className="text-left py-2 pr-3">Proposed By</th>
                <th className="text-left py-2 pr-3">Type</th>
                <th className="text-right py-2 pr-3">Amount</th>
                <th className="text-left py-2 pr-3">Recipient</th>
                <th className="text-left py-2 pr-3">Approver 1 (Treasurer)</th>
                <th className="text-left py-2 pr-3">Approver 2 (Chair/VC)</th>
                <th className="text-right py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const isBusy = busyId === row.id;
                return (
                  <tr key={row.id} className="border-t border-card-border align-top">
                    <td className="py-2 pr-3">
                      <div>{row.proposedByName}</div>
                      <div className="text-muted">Turn {row.proposedAtTurn}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <div>{TYPE_LABEL[row.type]}</div>
                      {row.type === "request" && row.approvalMode === "single" && (
                        <div className="text-muted text-[10px]">1-of-3 approval</div>
                      )}
                      {row.note && (
                        <div
                          className="text-muted text-[10px] italic truncate max-w-[12rem]"
                          title={row.note}
                        >
                          “{row.note}”
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">
                      ${row.amount.toLocaleString("en-US")}
                    </td>
                    <td className="py-2 pr-3">
                      {row.recipient ? row.recipient.name : "—"}
                      {row.recipient?.kind === "state" && (
                        <span className="text-muted"> (state party)</span>
                      )}
                      {row.type === "request" && <span className="text-muted"> (requester)</span>}
                    </td>
                    <td className="py-2 pr-3">
                      {row.treasurerApproval ? (
                        <span>
                          ✅ {row.treasurerApproval.characterName}
                          {row.treasurerApproval.characterId === row.proposedBy && (
                            <span className="text-muted"> (auto)</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted">⏳ Awaiting Treasurer</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {row.leadershipApproval ? (
                        <span>
                          ✅ {row.leadershipApproval.characterName}
                          {row.leadershipApproval.characterId === row.proposedBy && (
                            <span className="text-muted"> (auto)</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted">⏳ Awaiting Chair/VC</span>
                      )}
                    </td>
                    <td className="py-2 text-right space-x-2">
                      {row.canApprove && (
                        <button
                          onClick={() => handleApprove(row.id)}
                          disabled={isBusy}
                          className="px-3 py-1 rounded bg-green-600 text-white text-xs font-medium hover:bg-green-700 disabled:opacity-50"
                        >
                          Approve
                        </button>
                      )}
                      {row.canCancel && (
                        <button
                          onClick={() => handleCancel(row.id)}
                          disabled={isBusy}
                          className="px-3 py-1 rounded border border-card-border text-muted hover:text-foreground text-xs disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
