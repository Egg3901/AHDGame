"use client";

import { apiErrorText } from "@/lib/errors/catalog";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import MergerReviewPanel from "@/components/corporation/MergerReviewPanel";
import IndexCommitteePanel from "@/components/corporation/IndexCommitteePanel";
import SponsoredFundPanel from "@/components/corporation/SponsoredFundPanel";
import { DenseSection, InlineStatus, SmallButton, Td, Th } from "./dense/DenseKit";

interface DealSummary {
  offerId: string;
  acquirerCorporationId: string;
  acquirerName: string;
  targetCorporationId: string;
  targetName: string;
  priceAnchor: number;
  targetValuationAnchor: number;
  status: string;
  expiresAtTurn: number;
}

interface DealsResponse {
  enabled: boolean;
  incoming: DealSummary[];
  outgoing: DealSummary[];
}

interface CorpSearchResult {
  id: string;
  name: string;
  ticker: string | null;
  countryId: string | null;
  nppRun?: boolean;
}

const fmt = (n: number) => "₳" + Math.round(n).toLocaleString("en-US");

export default function DealsTab({
  corpId,
  isCeo,
  canSponsorFund = false,
}: {
  corpId: string;
  isCeo: boolean;
  /** True when the corporation has a financial sector, the gate for chartering a fund. */
  canSponsorFund?: boolean;
}) {
  const [data, setData] = useState<DealsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Propose form — smart name lookup for the target instead of a raw id.
  const [targetQuery, setTargetQuery] = useState("");
  const [targetResults, setTargetResults] = useState<CorpSearchResult[]>([]);
  const [targetSearching, setTargetSearching] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<CorpSearchResult | null>(null);
  const [price, setPrice] = useState("");
  const [proposeBusy, setProposeBusy] = useState(false);
  const [proposeErr, setProposeErr] = useState("");
  const [proposeMsg, setProposeMsg] = useState("");

  const fetchDeals = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/deals`);
      const d = await res.json();
      if (!res.ok) {
        setErr(apiErrorText(d, "Failed to load deals"));
        setData(null);
      } else {
        setData(d);
      }
    } catch {
      setErr("Network error");
    } finally {
      setLoading(false);
    }
  }, [corpId]);

  useEffect(() => {
    void fetchDeals();
  }, [fetchDeals]);

  // Debounced corporation name search (reuses the player-run corp search;
  // excludes this corp). Skips while a target is already selected.
  useEffect(() => {
    if (selectedTarget || targetQuery.trim().length < 2) {
      setTargetResults([]);
      setTargetSearching(false);
      return;
    }
    setTargetSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/corporations/buyer-search?q=${encodeURIComponent(targetQuery.trim())}&exclude=${corpId}`
        );
        if (res.ok) {
          const d = (await res.json()) as { results: CorpSearchResult[] };
          setTargetResults((d.results ?? []).filter((r) => r.id !== corpId));
        }
      } catch {
        // ignore transient search errors
      } finally {
        setTargetSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [targetQuery, selectedTarget, corpId]);

  async function act(action: string, offerId: string) {
    setBusyId(offerId);
    setErr("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/deals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, offerId }),
      });
      const d = await res.json();
      if (!res.ok) setErr(apiErrorText(d, "Action failed"));
      else await fetchDeals();
    } catch {
      setErr("Network error");
    } finally {
      setBusyId(null);
    }
  }

  async function propose(e: FormEvent) {
    e.preventDefault();
    if (!selectedTarget) {
      setProposeErr("Pick a corporation to acquire first.");
      return;
    }
    setProposeBusy(true);
    setProposeErr("");
    setProposeMsg("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/deals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "propose",
          targetCorporationId: selectedTarget.id,
          priceAnchor: Number(price),
        }),
      });
      const d = await res.json();
      if (!res.ok) setProposeErr(apiErrorText(d, "Failed to send offer"));
      else if (d.autoAccepted) {
        setProposeMsg(`Acquired ${d.targetName ?? selectedTarget.name}.`);
        setSelectedTarget(null);
        setTargetQuery("");
        setPrice("");
        await fetchDeals();
      } else {
        setProposeMsg(`Offer sent to ${selectedTarget.name}.`);
        setSelectedTarget(null);
        setTargetQuery("");
        setPrice("");
        await fetchDeals();
      }
    } catch {
      setProposeErr("Network error");
    } finally {
      setProposeBusy(false);
    }
  }

  if (!isCeo) return <p className="text-xs text-muted">Only the CEO can manage acquisitions.</p>;
  if (loading) return <p className="text-xs text-muted">Loading deals.</p>;
  if (data && !data.enabled)
    return <p className="text-xs text-muted">Corporate acquisitions are not currently enabled.</p>;

  return (
    <div className="space-y-6">
      <InlineStatus message={err} tone="error" />

      <DenseSection title="Offers to acquire this corporation">
        {!data || data.incoming.length === 0 ? (
          <p className="py-2 text-xs text-muted">No incoming offers.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>Acquirer</Th>
                <Th align="right">Offer</Th>
                <Th align="right" title="This corporation's estimated value.">
                  Est. value
                </Th>
                <Th align="right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {data.incoming.map((o) => (
                <tr key={o.offerId}>
                  <Td className="text-foreground">{o.acquirerName}</Td>
                  <Td align="right">{fmt(o.priceAnchor)}</Td>
                  <Td align="right" className="text-muted">
                    {fmt(o.targetValuationAnchor)}
                  </Td>
                  <Td align="right" numeric={false}>
                    <span className="inline-flex gap-1.5">
                      <SmallButton
                        tone="primary"
                        onClick={() => {
                          if (
                            confirm(
                              `Accept ${o.acquirerName}'s offer of ${fmt(
                                o.priceAnchor
                              )}? Your corporation will be absorbed into theirs and shareholders paid out.`
                            )
                          )
                            void act("accept", o.offerId);
                        }}
                        disabled={busyId === o.offerId}
                      >
                        {busyId === o.offerId ? "Working" : "Accept"}
                      </SmallButton>
                      <SmallButton
                        onClick={() => void act("reject", o.offerId)}
                        disabled={busyId === o.offerId}
                      >
                        Reject
                      </SmallButton>
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DenseSection>

      <DenseSection title="Your outgoing offers">
        {!data || data.outgoing.length === 0 ? (
          <p className="py-2 text-xs text-muted">No outgoing offers.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>Target</Th>
                <Th align="right">Offer</Th>
                <Th align="right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {data.outgoing.map((o) => (
                <tr key={o.offerId}>
                  <Td className="text-foreground">{o.targetName}</Td>
                  <Td align="right">{fmt(o.priceAnchor)}</Td>
                  <Td align="right" numeric={false}>
                    <SmallButton
                      onClick={() => void act("withdraw", o.offerId)}
                      disabled={busyId === o.offerId}
                    >
                      {busyId === o.offerId ? "Working" : "Withdraw"}
                    </SmallButton>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DenseSection>

      <DenseSection title="Make an acquisition offer">
        <div className="space-y-2 py-1">
          <p className="text-xs text-muted">
            Buy another corporation outright. If a player CEO accepts, its sectors and cash fold
            into yours and its shareholders are paid the offer price. AI-run private companies
            accept automatically at or above their asking price (fair value plus 10%) and reject
            below it. State-owned firms cannot be acquired. The target must have no outstanding
            bonds and hold no shares in other corporations.
          </p>
          <form onSubmit={propose} className="flex flex-wrap items-center gap-1.5">
            {selectedTarget ? (
              <span className="inline-flex h-7 items-center gap-2 rounded-md border border-card-border px-2 text-[13px] text-foreground">
                {selectedTarget.name}
                {selectedTarget.ticker ? (
                  <span className="text-xs text-muted">{selectedTarget.ticker}</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => setSelectedTarget(null)}
                  className="text-xs text-muted underline underline-offset-2 hover:text-foreground"
                >
                  Change
                </button>
              </span>
            ) : (
              <span className="relative">
                <input
                  type="text"
                  value={targetQuery}
                  onChange={(e) => setTargetQuery(e.target.value)}
                  placeholder="Search corporations"
                  aria-label="Target corporation"
                  className="h-7 w-64 rounded-md border border-card-border bg-background px-2 text-[13px] text-foreground placeholder:text-muted focus:border-foreground focus:outline-none"
                />
                {targetResults.length > 0 && (
                  <ul className="absolute left-0 top-8 z-20 max-h-56 w-80 overflow-y-auto rounded-md border border-card-border bg-card shadow-lg">
                    {targetResults.map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTarget(r);
                            setTargetResults([]);
                          }}
                          className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-[13px] text-foreground hover:bg-card-elevated"
                        >
                          <span className="truncate">
                            {r.name}
                            {r.nppRun ? (
                              <span className="ml-1 text-xs text-muted">AI-run</span>
                            ) : null}
                          </span>
                          <span className="shrink-0 text-xs text-muted">
                            {[r.countryId, r.ticker].filter(Boolean).join(" ")}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </span>
            )}
            <label className="flex items-center gap-1.5 text-xs text-muted">
              Offer (₳)
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                type="number"
                min="1"
                aria-label="Offer price"
                className="h-7 w-36 rounded-md border border-card-border bg-background px-2 text-right font-mono text-[13px] text-foreground focus:border-foreground focus:outline-none"
                required
              />
            </label>
            <SmallButton tone="primary" type="submit" disabled={proposeBusy || !selectedTarget}>
              {proposeBusy ? "Sending" : "Send offer"}
            </SmallButton>
          </form>
          {!selectedTarget &&
            !targetSearching &&
            targetQuery.trim().length >= 2 &&
            targetResults.length === 0 && (
              <p className="text-xs text-muted">
                No eligible corporations found. Only player-run and AI-run private companies can be
                targets.
              </p>
            )}
          <InlineStatus message={proposeErr} tone="error" />
          <InlineStatus message={proposeMsg} tone="success" />
        </div>
      </DenseSection>
      <MergerReviewPanel />

      <IndexCommitteePanel corpId={corpId} />

      {canSponsorFund && <SponsoredFundPanel corpId={corpId} />}
    </div>
  );
}
