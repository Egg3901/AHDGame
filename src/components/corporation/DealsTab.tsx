"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

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
}

const fmt = (n: number) => "₳" + Math.round(n).toLocaleString("en-US");

export default function DealsTab({ corpId, isCeo }: { corpId: string; isCeo: boolean }) {
  const [data, setData] = useState<DealsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Propose form — smart name lookup for the target instead of a raw id.
  const [targetQuery, setTargetQuery] = useState("");
  const [targetResults, setTargetResults] = useState<CorpSearchResult[]>([]);
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
        setErr(d.error || "Failed to load deals");
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
      return;
    }
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
      if (!res.ok) setErr(d.error || "Action failed");
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
      if (!res.ok) setProposeErr(d.error || "Failed to send offer");
      else {
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

  if (!isCeo) return <p className="text-sm text-muted">Only the CEO can manage acquisitions.</p>;
  if (loading) return <p className="text-sm text-muted">Loading deals…</p>;
  if (data && !data.enabled)
    return <p className="text-sm text-muted">Corporate acquisitions are not currently enabled.</p>;

  return (
    <div className="space-y-6">
      {err && <p className="text-xs text-error">{err}</p>}

      <section className="rounded-lg border border-card-border bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold text-foreground">
          Offer to acquire a corporation
        </h3>
        <p className="mb-3 text-xs text-muted">
          Buy another corporation outright. If its CEO accepts, its sectors and cash fold into yours
          and its shareholders are paid the offer price. (Currently the target must have no
          outstanding bonds and hold no shares in other corporations.)
        </p>

        <form onSubmit={propose} className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-foreground">Target corporation</label>
            {selectedTarget ? (
              <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-card-border bg-card-elevated px-3 py-2">
                <span className="text-sm text-foreground">
                  {selectedTarget.name}
                  {selectedTarget.ticker ? (
                    <span className="ml-1 text-xs text-muted">{selectedTarget.ticker}</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedTarget(null)}
                  className="shrink-0 text-xs font-semibold text-primary hover:underline"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={targetQuery}
                  onChange={(e) => setTargetQuery(e.target.value)}
                  placeholder="Search corporations by name…"
                  className="mt-1 w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
                />
                {targetResults.length > 0 && (
                  <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-card-border bg-card">
                    {targetResults.map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTarget(r);
                            setTargetResults([]);
                          }}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-card-elevated"
                        >
                          <span className="truncate">{r.name}</span>
                          <span className="shrink-0 text-xs text-muted">
                            {[r.countryId, r.ticker].filter(Boolean).join(" · ")}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-xs text-foreground">
              Offer price (₳)
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                type="number"
                min="1"
                className="mt-1 rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                required
              />
            </label>
            <button
              type="submit"
              disabled={proposeBusy || !selectedTarget}
              className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {proposeBusy ? "Sending…" : "Send offer"}
            </button>
          </div>
        </form>
        {proposeErr && <p className="mt-2 text-xs text-error">{proposeErr}</p>}
        {proposeMsg && <p className="mt-2 text-xs font-semibold text-foreground">{proposeMsg}</p>}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">
          Offers to acquire this corporation
        </h3>
        {!data || data.incoming.length === 0 ? (
          <p className="text-xs text-muted">No incoming offers.</p>
        ) : (
          <ul className="space-y-2">
            {data.incoming.map((o) => (
              <li
                key={o.offerId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-card-border bg-card p-3"
              >
                <div className="text-sm text-foreground">
                  <span className="font-semibold">{o.acquirerName}</span> offers{" "}
                  {fmt(o.priceAnchor)}{" "}
                  <span className="text-xs text-muted">
                    (est. value {fmt(o.targetValuationAnchor)})
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
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
                    className="rounded bg-primary px-2.5 py-1 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
                  >
                    {busyId === o.offerId ? "…" : "Accept"}
                  </button>
                  <button
                    onClick={() => void act("reject", o.offerId)}
                    disabled={busyId === o.offerId}
                    className="rounded border border-card-border px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-card-elevated disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Your outgoing offers</h3>
        {!data || data.outgoing.length === 0 ? (
          <p className="text-xs text-muted">No outgoing offers.</p>
        ) : (
          <ul className="space-y-2">
            {data.outgoing.map((o) => (
              <li
                key={o.offerId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-card-border bg-card p-3"
              >
                <div className="text-sm text-foreground">
                  Offer to buy <span className="font-semibold">{o.targetName}</span> for{" "}
                  {fmt(o.priceAnchor)}
                </div>
                <button
                  onClick={() => void act("withdraw", o.offerId)}
                  disabled={busyId === o.offerId}
                  className="rounded border border-card-border px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-card-elevated disabled:opacity-50"
                >
                  {busyId === o.offerId ? "…" : "Withdraw"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
