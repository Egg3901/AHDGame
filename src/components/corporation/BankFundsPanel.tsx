"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  FUND_CHARTER_FEE_ANCHOR,
  FUND_MIN_SEED_CAPITAL_ANCHOR,
} from "@/lib/indexFunds/sponsorship/constants";

type Payload = {
  canCreate: boolean;
  countryId: string | null;
  stockChoices: { id: string; name: string; ticker?: string }[];
  funds: { id: string; slug: string; name: string; status: string; countryId: string | null }[];
};

export function BankFundsPanel({ corporationId }: { corporationId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [fee, setFee] = useState("0.50");
  const [seed, setSeed] = useState(String(FUND_MIN_SEED_CAPITAL_ANCHOR));
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const response = await fetch(`/api/corporations/${corporationId}/funds`, { cache: "no-store" });
    if (response.ok) {
      const result = await response.json();
      if (Array.isArray(result.funds) && Array.isArray(result.stockChoices))
        return result as Payload;
    }
  }, [corporationId]);
  useEffect(() => {
    let active = true;
    void load()
      .then((result) => {
        if (active && result) setData(result);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [load]);
  if (!data || (!data.canCreate && !data.funds.length)) return null;

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/index-funds/charter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sponsorCorporationId: corporationId,
          name,
          tickerSymbol: ticker,
          scope: "country",
          countryId: data!.countryId,
          kind: "broad",
          expenseRatioAnnual: Number(fee) / 100,
          seedCapitalAnchor: Number(seed),
          pickedStocks: Object.entries(weights).map(([corporationId, weight]) => ({
            corporationId,
            weightBps: Math.round(Number(weight) * 100),
          })),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "Could not create this fund.");
        return;
      }
      setWeights({});
      setName("");
      setTicker("");
      const refreshed = await load();
      if (refreshed) setData(refreshed);
    } catch {
      setError("Could not create this fund. Retry with the same name and ticker.");
    } finally {
      setBusy(false);
    }
  }

  const picked = Object.keys(weights);
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + Number(weight || 0), 0);
  return (
    <section className="space-y-3 border-t border-card-border pt-4">
      <h3 className="text-sm font-semibold">Funds</h3>
      {data.funds.length > 0 && (
        <ul className="space-y-2">
          {data.funds.map((f) => (
            <li key={f.id}>
              <Link
                className="text-sm underline"
                href={`/stockmarket/${(f.countryId ?? "global").toLowerCase()}/fund/${encodeURIComponent(f.slug)}`}
              >
                {f.name}
              </Link>
              <span className="ml-2 text-xs text-muted">{f.status}</span>
            </li>
          ))}
        </ul>
      )}
      {data.canCreate && data.stockChoices.length > 0 && (
        <form onSubmit={(event) => void create(event)} className="space-y-3">
          <p className="text-sm">
            Pick up to 10 companies. At least a quarter stays in cash. Each company can hold at most
            15% of the fund value.
          </p>
          <p className="text-xs text-muted">
            Investors own fund units. Their money stays separate from bank deposits, reserves and
            investments.
          </p>
          <div className="flex flex-wrap gap-3">
            <label className="text-xs">
              Fund name
              <input
                aria-label="Fund name"
                required
                minLength={4}
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="block border border-card-border bg-background p-2"
              />
            </label>
            <label className="text-xs">
              Ticker
              <input
                aria-label="Ticker"
                required
                pattern="[A-Z]{3,8}"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                className="block border border-card-border bg-background p-2"
              />
            </label>
          </div>
          <div className="space-y-2">
            {data.stockChoices
              .filter((c) => picked.includes(c.id) || picked.length < 10)
              .map((c) => (
                <div className="flex items-center gap-3" key={c.id}>
                  <label className="text-sm">
                    <input
                      type="checkbox"
                      checked={picked.includes(c.id)}
                      onChange={(e) =>
                        setWeights((previous) => {
                          const next = { ...previous };
                          if (e.target.checked)
                            next[c.id] = String(Math.max(1, Math.min(15, 75 - totalWeight)));
                          else delete next[c.id];
                          return next;
                        })
                      }
                    />{" "}
                    {c.name}
                    {c.ticker ? ` (${c.ticker})` : ""}
                  </label>
                  {picked.includes(c.id) && (
                    <label className="text-xs">
                      Weight (%)
                      <input
                        aria-label={`${c.name} weight (%)`}
                        type="number"
                        required
                        min="0.01"
                        max="15"
                        step="0.01"
                        value={weights[c.id]}
                        onChange={(e) =>
                          setWeights((previous) => ({ ...previous, [c.id]: e.target.value }))
                        }
                        className="ml-2 w-20 border border-card-border bg-background p-1"
                      />
                    </label>
                  )}
                </div>
              ))}
          </div>
          <p className="text-xs">
            Companies: {totalWeight.toFixed(2)}%. Cash: {(100 - totalWeight).toFixed(2)}%.
          </p>
          <div className="flex flex-wrap gap-3">
            <label className="text-xs">
              Bank fee (% per game year)
              <input
                aria-label="Bank fee (% per game year)"
                type="number"
                required
                min="0.1"
                max="2"
                step="0.01"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                className="block w-28 border border-card-border bg-background p-2"
              />
            </label>
            <label className="text-xs">
              Bank seed investment (₳)
              <input
                aria-label="Bank's seed investment"
                type="number"
                required
                min={FUND_MIN_SEED_CAPITAL_ANCHOR}
                step="any"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                className="block border border-card-border bg-background p-2"
              />
            </label>
          </div>
          <p className="text-xs text-muted">
            Creation costs ₳{FUND_CHARTER_FEE_ANCHOR.toLocaleString("en-US")} plus your seed
            investment, paid from corporate cash. The seed buys ordinary units that stay invested
            while other investors or withdrawals remain. The fee and company choices are fixed for
            this fund.
          </p>
          <button
            type="submit"
            disabled={busy || !picked.length || totalWeight > 75}
            className="rounded bg-primary px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {busy ? "Creating fund..." : "Create fund"}
          </button>
          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
