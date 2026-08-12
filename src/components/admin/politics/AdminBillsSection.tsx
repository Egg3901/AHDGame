"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/ui";
import { Pagination } from "../Pagination";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";

interface AdminBillRow {
  id: string;
  title: string;
  status: string;
  originChamber: string;
  currentChamber: string;
  sponsorName: string;
  legislationTypeId: string | null;
  legislationTypeName: string | null;
  effectDirection: number | null;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  otherChamberVotesFor: number;
  otherChamberVotesAgainst: number;
  proposedAt: string;
  votingEndsAt: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  proposed: "bg-blue-500/20 text-blue-400",
  active: "bg-yellow-500/20 text-yellow-400",
  passed_origin: "bg-cyan-500/20 text-cyan-400",
  active_other: "bg-yellow-500/20 text-yellow-400",
  active_both: "bg-yellow-500/20 text-yellow-400",
  enrolled: "bg-purple-500/20 text-purple-400",
  signed: "bg-emerald-500/20 text-emerald-400",
  vetoed: "bg-red-500/20 text-red-400",
  failed: "bg-red-500/20 text-red-400",
  withdrawn: "bg-muted/20 text-muted",
  cabinet_review: "bg-blue-500/20 text-blue-400",
  override_shugiin: "bg-amber-500/20 text-amber-400",
};

const STATUS_LABELS: Record<string, string> = {
  proposed: "Proposed",
  active: "Voting Open",
  passed_origin: "Passed Chamber",
  active_other: "2nd Chamber",
  active_both: "Both Chambers",
  enrolled: "Awaiting President",
  signed: "Signed",
  vetoed: "Vetoed",
  failed: "Failed",
  withdrawn: "Withdrawn",
  cabinet_review: "Cabinet Review",
  override_shugiin: "Shūgiin Override",
};

interface AdminBillsSectionProps {
  countryId: CountryId;
}

const ITEMS_PER_PAGE = 10;

export function AdminBillsSection({ countryId }: AdminBillsSectionProps) {
  const [bills, setBills] = useState<AdminBillRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchBills = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(ITEMS_PER_PAGE));
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/admin/country/${countryId.toLowerCase()}/bills?${params}`);
      if (res.ok) {
        const data = await res.json();
        setBills(data.bills);
        setTotalPages(data.totalPages ?? 1);
      }
    } finally {
      setLoading(false);
    }
  }, [countryId, statusFilter, page]);

  useEffect(() => {
    fetchBills();
  }, [fetchBills]);

  // Reset page when filter or country changes
  useEffect(() => {
    setPage(1);
  }, [statusFilter, countryId]);

  const runAction = async (billId: string, action: string) => {
    setMessage("");
    const res = await fetch(`/api/admin/country/${countryId.toLowerCase()}/bills`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ billId, action }),
    });
    const d = await res.json();
    setMessage(res.ok ? d.message : `Error: ${d.error}`);
    if (res.ok) fetchBills();
  };

  const config = getCountryConfig(countryId);
  const proposeBillHref = config.legislature.path ?? "/congress?tab=bills";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={proposeBillHref}
          className="inline-flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20 transition-colors"
        >
          Propose bill (Admin override)
        </Link>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-semibold">Legislation Management</h2>
        <div className="flex gap-1 rounded-lg border border-card-border overflow-hidden text-sm">
          {["all", "active", "active_other", "enrolled", "signed", "failed", "vetoed"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 font-medium transition-colors capitalize ${
                statusFilter === s
                  ? "bg-primary/20 text-primary"
                  : "bg-card text-muted hover:text-foreground"
              }`}
            >
              {STATUS_LABELS[s] ?? s}
            </button>
          ))}
        </div>
      </div>

      {message && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${message.startsWith("Error") ? "border-red-500/30 bg-red-500/10 text-red-400" : "border-green-500/30 bg-green-500/10 text-green-400"}`}
        >
          {message}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-card-border bg-card p-8 text-center text-muted text-sm">
          Loading…
        </div>
      ) : bills.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-8">
          <EmptyState
            title="No bills found"
            description="Legislation will appear here once bills are proposed."
          />
        </div>
      ) : (
        <div className="space-y-3">
          {bills.map((bill) => (
            <div
              key={bill.id}
              className="rounded-xl border border-card-border bg-card p-4 space-y-3"
            >
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <a
                      href={`/congress/bills/${bill.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-sm hover:text-primary transition-colors"
                    >
                      {bill.title}
                    </a>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[bill.status] ?? "bg-muted/20 text-muted"}`}
                    >
                      {STATUS_LABELS[bill.status] ?? bill.status}
                    </span>
                    <span className="text-[10px] text-muted capitalize">
                      {bill.originChamber} bill
                    </span>
                    {bill.legislationTypeName && (
                      <span className="text-[10px] text-cyan-400/90">
                        {bill.legislationTypeName}
                        {bill.effectDirection != null && bill.effectDirection !== 0 && (
                          <span className="ml-0.5 text-muted">
                            ({bill.effectDirection > 0 ? "+" : ""}
                            {bill.effectDirection})
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted mt-1">
                    Sponsor: {bill.sponsorName} · Proposed{" "}
                    {new Date(bill.proposedAt).toLocaleString("en-US")}
                  </p>
                  <div className="text-xs text-muted mt-1 flex gap-4 flex-wrap">
                    <span>
                      Origin: ✓{bill.votesFor} ✗{bill.votesAgainst} –{bill.votesAbstain}
                    </span>
                    {bill.otherChamberVotesFor + bill.otherChamberVotesAgainst > 0 && (
                      <span>
                        Other: ✓{bill.otherChamberVotesFor} ✗{bill.otherChamberVotesAgainst}
                      </span>
                    )}
                    {bill.votingEndsAt && (
                      <span className="text-yellow-400">
                        Closes {new Date(bill.votingEndsAt).toLocaleString("en-US")}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 shrink-0">
                  {["active", "active_other"].includes(bill.status) && (
                    <button
                      onClick={() => runAction(bill.id, "force_advance_chamber")}
                      className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-400 hover:bg-cyan-500/20 transition-colors"
                    >
                      Advance Chamber
                    </button>
                  )}
                  {["active", "active_other"].includes(bill.status) && (
                    <button
                      onClick={() => runAction(bill.id, "force_enroll")}
                      className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-xs font-medium text-purple-400 hover:bg-purple-500/20 transition-colors"
                    >
                      Send to President
                    </button>
                  )}
                  {bill.status === "enrolled" && (
                    <>
                      <button
                        onClick={() => runAction(bill.id, "force_sign")}
                        className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                      >
                        Force Sign
                      </button>
                      <button
                        onClick={() => runAction(bill.id, "force_veto")}
                        className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors"
                      >
                        Force Veto
                      </button>
                    </>
                  )}
                  {!["signed", "withdrawn"].includes(bill.status) && (
                    <button
                      onClick={() => runAction(bill.id, "force_fail")}
                      className="rounded-lg border border-card-border bg-muted/10 px-3 py-1.5 text-xs font-medium text-muted hover:bg-muted/20 transition-colors"
                    >
                      Fail
                    </button>
                  )}
                  <button
                    onClick={() => runAction(bill.id, "reset")}
                    className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground transition-colors"
                  >
                    Reset
                  </button>
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
