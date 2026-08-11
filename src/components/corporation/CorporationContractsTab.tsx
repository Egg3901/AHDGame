"use client";

import { useCallback, useEffect, useState } from "react";
import { COMMODITY_LABELS } from "@/lib/constants/commodities";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/contexts/ToastContext";
import { useGameTurnStatus } from "@/hooks/useGameEvents";
import { Button } from "@/components/ui";
import { ContractStatusBadge } from "@/components/extraction/ContractStatusBadge";
import { effectiveContractStatus, type ExtractionContractRow } from "@/components/extraction/types";
import { CONTRACT_DEFAULT_MISSED_PAYMENTS } from "@/lib/constants/prospecting";

interface CorporationContractsTabProps {
  corpId: string;
  isCeo: boolean;
}

/**
 * Extraction-contract offers + active contracts held by this corporation.
 * CEO can accept/decline offers and see royalty/term detail on active
 * contracts. Rendered only for extraction corps when contractIssuanceEnabled.
 */
export default function CorporationContractsTab({ corpId, isCeo }: CorporationContractsTabProps) {
  const { formatAmount } = useCurrency();
  const { showToast } = useToast();
  const gameTurn = useGameTurnStatus();
  const currentTurn = gameTurn?.currentTurn ?? 0;

  const [contracts, setContracts] = useState<ExtractionContractRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/contracts/extraction?corporationId=${corpId}&status=all`);
      if (res.ok) {
        const data = (await res.json()) as { contracts?: ExtractionContractRow[] };
        setContracts(data.contracts ?? []);
      }
    } catch {
      setContracts([]);
    } finally {
      setLoading(false);
    }
  }, [corpId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function respond(id: string, action: "accept" | "decline") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/contracts/extraction/${id}/${action}`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(json.error ?? `Failed to ${action} the offer.`, "error");
        return;
      }
      showToast(action === "accept" ? "Contract accepted." : "Offer declined.", "success");
      setRefreshKey((k) => k + 1);
    } catch {
      showToast("Network error.", "error");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="py-8 text-center text-sm text-muted animate-pulse">Loading contracts…</div>
    );
  }

  const offers = contracts.filter((c) => effectiveContractStatus(c) === "offered");
  const active = contracts.filter((c) => effectiveContractStatus(c) === "active");
  const past = contracts.filter((c) => {
    const s = effectiveContractStatus(c);
    return s === "declined" || s === "expired" || s === "defaulted";
  });

  if (contracts.length === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-8 text-center text-sm text-muted">
        No extraction contracts yet.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {offers.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-widest text-muted">
            Pending offers
          </h3>
          <div className="space-y-3">
            {offers.map((c) => (
              <div key={c._id} className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">
                        {COMMODITY_LABELS[c.resource] ?? c.resource}
                      </span>
                      <span className="text-xs text-muted">in {c.stateId}</span>
                      <ContractStatusBadge status="offered" />
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                      <span>Share: {(c.share * 100).toFixed(1)}%</span>
                      <span>
                        Signing fee:{" "}
                        {c.signingFeeAnchor != null ? formatAmount(c.signingFeeAnchor) : "n/a"}
                      </span>
                      <span>
                        Royalty:{" "}
                        {c.royaltyRatePerTurn != null
                          ? `${(c.royaltyRatePerTurn * 100).toFixed(2)}% of contracted value / turn`
                          : "n/a"}
                      </span>
                      <span>Term: {c.termTurns ? `${c.termTurns} turns` : "Perpetual"}</span>
                      {c.offerExpiresTurn != null && (
                        <span>
                          Offer expires in {Math.max(0, c.offerExpiresTurn - currentTurn)} turns
                        </span>
                      )}
                    </div>
                  </div>
                  {isCeo && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => respond(c._id, "accept")}
                        disabled={busyId === c._id}
                      >
                        {busyId === c._id ? "Working…" : "Accept"}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => respond(c._id, "decline")}
                        disabled={busyId === c._id}
                      >
                        Decline
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {active.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-widest text-muted">
            Active contracts
          </h3>
          <div className="overflow-x-auto rounded-lg border border-card-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-card-border bg-card-elevated">
                  <th className="px-4 py-3 text-left font-medium text-muted">State</th>
                  <th className="px-4 py-3 text-left font-medium text-muted">Resource</th>
                  <th className="px-4 py-3 text-right font-medium text-muted">Share</th>
                  <th className="px-4 py-3 text-right font-medium text-muted">Royalty / turn</th>
                  <th className="px-4 py-3 text-right font-medium text-muted">Expires</th>
                  <th className="px-4 py-3 text-right font-medium text-muted">Status</th>
                </tr>
              </thead>
              <tbody>
                {active.map((c) => {
                  const missed = c.missedPayments ?? 0;
                  return (
                    <tr key={c._id} className="border-b border-card-border last:border-0">
                      <td className="px-4 py-3 font-medium">{c.stateId}</td>
                      <td className="px-4 py-3">{COMMODITY_LABELS[c.resource] ?? c.resource}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {(c.share * 100).toFixed(1)}%
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {c.royaltyRatePerTurn != null
                          ? `${(c.royaltyRatePerTurn * 100).toFixed(2)}%`
                          : "n/a"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted">
                        {c.expiresTurn != null ? `Turn ${c.expiresTurn}` : "Perpetual"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {missed > 0 ? (
                          <span
                            className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning"
                            title={`${missed} of ${CONTRACT_DEFAULT_MISSED_PAYMENTS} missed royalty payments before default`}
                          >
                            {missed} missed payment{missed === 1 ? "" : "s"}
                          </span>
                        ) : (
                          <ContractStatusBadge status="active" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-widest text-muted">
            History
          </h3>
          <div className="space-y-2">
            {past.map((c) => (
              <div
                key={c._id}
                className="flex items-center justify-between rounded-lg border border-card-border px-4 py-2 text-sm"
              >
                <span>
                  {COMMODITY_LABELS[c.resource] ?? c.resource} in {c.stateId},{" "}
                  {(c.share * 100).toFixed(1)}% share
                </span>
                <ContractStatusBadge status={effectiveContractStatus(c)} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
