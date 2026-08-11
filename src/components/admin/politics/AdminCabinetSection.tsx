"use client";

import { useState, useEffect, useCallback } from "react";
import { EmptyState } from "@/components/ui";
import { Pagination } from "../Pagination";
import type { CountryId } from "@/lib/constants/countries";

interface CabinetNominationRow {
  id: string;
  positionId: string;
  positionName: string;
  nomineeCharacterId: string;
  nomineeCharacterName: string;
  nomineeParty: string | null;
  proposedByPresidentName: string;
  status: string;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  votingEndsAt: string | null;
  proposedAt: string;
}

const NOMINATION_STATUS_COLORS: Record<string, string> = {
  active: "bg-yellow-500/20 text-yellow-400",
  confirmed: "bg-emerald-500/20 text-emerald-400",
  rejected: "bg-red-500/20 text-red-400",
  withdrawn: "bg-muted/20 text-muted",
  proposed: "bg-blue-500/20 text-blue-400",
};

interface AdminCabinetSectionProps {
  countryId: CountryId;
}

const ITEMS_PER_PAGE = 10;

export function AdminCabinetSection({ countryId }: AdminCabinetSectionProps) {
  const [nominations, setNominations] = useState<CabinetNominationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchNominations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(ITEMS_PER_PAGE));
      const res = await fetch(
        `/api/admin/country/${countryId.toLowerCase()}/cabinet-nominations?${params}`
      );
      if (res.ok) {
        const data = await res.json();
        setNominations(data.nominations || []);
        setTotalPages(data.totalPages ?? 1);
      }
    } finally {
      setLoading(false);
    }
  }, [countryId, page]);

  useEffect(() => {
    fetchNominations();
  }, [fetchNominations]);

  useEffect(() => {
    setPage(1);
  }, [countryId]);

  const runAction = async (nominationId: string, action: string) => {
    setMessage("");
    const res = await fetch(`/api/admin/country/${countryId.toLowerCase()}/cabinet-nominations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nominationId, action }),
    });
    const d = await res.json();
    setMessage(res.ok ? d.message : `Error: ${d.error}`);
    if (res.ok) fetchNominations();
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Cabinet Nominations</h2>
      {message && (
        <div
          className={`rounded-lg border px-4 py-2 text-sm ${message.startsWith("Error") ? "border-red-500/30 bg-red-500/10 text-red-400" : "border-green-500/30 bg-green-500/10 text-green-400"}`}
        >
          {message}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-card-border bg-card p-6 text-center text-muted text-sm">
          Loading cabinet nominations…
        </div>
      ) : nominations.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-6">
          <EmptyState
            title="No cabinet nominations"
            description="Cabinet nominations will appear here when proposed."
          />
        </div>
      ) : (
        <div className="space-y-3">
          {nominations.map((nom) => (
            <div
              key={nom.id}
              className="rounded-xl border border-card-border bg-card p-4 space-y-3"
            >
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{nom.positionName}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${NOMINATION_STATUS_COLORS[nom.status] ?? "bg-muted/20 text-muted"}`}
                    >
                      {nom.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted mt-1">
                    Nominee: <span className="text-foreground">{nom.nomineeCharacterName}</span>
                    {nom.nomineeParty && ` (${nom.nomineeParty})`}
                  </p>
                  <p className="text-xs text-muted">
                    Proposed by {nom.proposedByPresidentName} ·{" "}
                    {new Date(nom.proposedAt).toLocaleString("en-US")}
                  </p>
                  <div className="text-xs text-muted mt-1 flex gap-4 flex-wrap">
                    <span>
                      Votes: ✓{nom.votesFor} ✗{nom.votesAgainst} –{nom.votesAbstain}
                    </span>
                    {nom.votingEndsAt && (
                      <span className="text-yellow-400">
                        Closes {new Date(nom.votingEndsAt).toLocaleString("en-US")}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 shrink-0">
                  {nom.status === "active" && (
                    <>
                      <button
                        onClick={() => runAction(nom.id, "force_confirm")}
                        className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                      >
                        Force Confirm
                      </button>
                      <button
                        onClick={() => runAction(nom.id, "force_reject")}
                        className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors"
                      >
                        Force Reject
                      </button>
                    </>
                  )}
                  {!["withdrawn"].includes(nom.status) && (
                    <button
                      onClick={() => runAction(nom.id, "withdraw")}
                      className="rounded-lg border border-card-border bg-muted/10 px-3 py-1.5 text-xs font-medium text-muted hover:bg-muted/20 transition-colors"
                    >
                      Withdraw
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
