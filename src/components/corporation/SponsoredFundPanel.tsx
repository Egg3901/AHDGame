"use client";

import { useState, useEffect, type FormEvent } from "react";
import Link from "next/link";
import {
  CORPORATION_TYPES,
  CORPORATION_TYPE_LABELS,
  type CorporationType,
} from "@/lib/constants/corporations";
import { ALL_COUNTRY_IDS } from "@/lib/constants/countries";
import {
  FUND_CHARTER_FEE_ANCHOR,
  FUND_MIN_SEED_CAPITAL_ANCHOR,
  MAX_EXPENSE_RATIO_ANNUAL,
  MIN_EXPENSE_RATIO_ANNUAL,
} from "@/lib/indexFunds/sponsorship/constants";
import { useCountryDisplayName } from "@/contexts/RegisteredCountriesContext";

const fmt = (n: number) => "₳" + Math.round(n).toLocaleString("en-US");

type SponsoredFund = {
  id: string;
  slug: string;
  name: string;
  ticker: string;
  status: string;
  scope: string;
  kind: string;
  countryId: string | null;
};

const sponsoredFundHref = (f: SponsoredFund) =>
  `/stockmarket/${f.scope === "global" || !f.countryId ? "global" : f.countryId.toLowerCase()}/fund/${f.slug}`;

/**
 * Funds this corporation already sponsors. Before this, a chartered fund
 * vanished from the owner's view once the charter session ended (ticket 1088):
 * nothing listed a corp's own funds. `refreshKey` re-fetches after a new charter.
 */
function SponsoredFundList({ corpId, refreshKey }: { corpId: string; refreshKey: string | null }) {
  const [funds, setFunds] = useState<SponsoredFund[] | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/corporations/${corpId}/funds`);
        const json = (await res.json().catch(() => ({}))) as { funds?: SponsoredFund[] };
        if (alive) setFunds(res.ok ? (json.funds ?? []) : []);
      } catch {
        if (alive) setFunds([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [corpId, refreshKey]);

  if (!funds || funds.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-card-border bg-background p-3">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        Funds this corporation sponsors
      </h4>
      <ul className="space-y-1.5">
        {funds.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-3 text-sm">
            <Link href={sponsoredFundHref(f)} className="font-medium text-primary hover:underline">
              {f.name} <span className="font-mono text-xs text-muted">{f.ticker}</span>
            </Link>
            <span className="font-mono text-[10px] uppercase tracking-wide text-muted">
              {f.status === "active" ? f.kind : f.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A5 charter surface: a finance corporation's CEO charters a sponsored index
 * fund from the same tab that hosts the index committee. The form mirrors the
 * refusals `POST /api/index-funds/charter` enforces, so a submission that
 * passes here should only fail on things the client cannot know (ticker
 * collisions, cash on hand).
 */
export default function SponsoredFundPanel({ corpId }: { corpId: string }) {
  const resolveCountryName = useCountryDisplayName();
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [scope, setScope] = useState<"country" | "global">("country");
  const [countryId, setCountryId] = useState("");
  const [kind, setKind] = useState<"broad" | "sector">("broad");
  const [sectorType, setSectorType] = useState("");
  const [expensePct, setExpensePct] = useState("0.50");
  const [seedCapital, setSeedCapital] = useState(String(FUND_MIN_SEED_CAPITAL_ANCHOR));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [chartered, setChartered] = useState<{ slug: string; ticker: string } | null>(null);

  const minPct = MIN_EXPENSE_RATIO_ANNUAL * 100;
  const maxPct = MAX_EXPENSE_RATIO_ANNUAL * 100;
  const seed = Number(seedCapital);
  const totalCost = FUND_CHARTER_FEE_ANCHOR + (Number.isFinite(seed) ? Math.max(0, seed) : 0);

  function validate(): string | null {
    const trimmed = name.trim();
    if (trimmed.length < 4 || trimmed.length > 60) return "Fund name must be 4 to 60 characters.";
    if (!/^[A-Z]{3,8}$/.test(ticker)) return "Ticker must be 3 to 8 uppercase letters.";
    if (scope === "country" && !countryId) return "Pick a country for a country-scoped fund.";
    if (kind === "sector" && !sectorType) return "Pick an industry for a sector fund.";
    const ratio = Number(expensePct) / 100;
    if (
      !Number.isFinite(ratio) ||
      ratio < MIN_EXPENSE_RATIO_ANNUAL ||
      ratio > MAX_EXPENSE_RATIO_ANNUAL
    )
      return `Expense ratio must be between ${minPct.toFixed(2)}% and ${maxPct.toFixed(2)}%.`;
    if (!Number.isFinite(seed) || seed < FUND_MIN_SEED_CAPITAL_ANCHOR)
      return `Seed capital must be at least ${fmt(FUND_MIN_SEED_CAPITAL_ANCHOR)}.`;
    return null;
  }

  async function charter(e: FormEvent) {
    e.preventDefault();
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/index-funds/charter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sponsorCorporationId: corpId,
          name: name.trim(),
          tickerSymbol: ticker,
          scope,
          ...(scope === "country" ? { countryId } : {}),
          kind,
          ...(kind === "sector" ? { sectorType } : {}),
          expenseRatioAnnual: Number(expensePct) / 100,
          seedCapitalAnchor: seed,
        }),
      });
      const body = (await res.json()) as { error?: string; slug?: string };
      if (!res.ok) setError(body.error || "Failed to charter the fund");
      else setChartered({ slug: body.slug ?? "", ticker });
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  const fundHref = chartered
    ? `/stockmarket/${scope === "global" ? "global" : countryId.toLowerCase()}/fund/${chartered.slug}`
    : "";

  return (
    <section className="rounded-lg border border-card-border bg-card p-4">
      <SponsoredFundList corpId={corpId} refreshKey={chartered?.slug ?? null} />
      <h3 className="mb-2 text-sm font-semibold text-foreground">Charter a sponsored fund</h3>
      <p className="mb-3 text-xs text-muted">
        Launch an index fund your corporation runs. You choose the scope and the fee; the index
        machinery picks and rebalances the constituents. Chartering costs a{" "}
        {fmt(FUND_CHARTER_FEE_ANCHOR)} fee paid to the treasury plus at least{" "}
        {fmt(FUND_MIN_SEED_CAPITAL_ANCHOR)} of seed capital that stays at risk until the fund winds
        up. Your return is the expense ratio ({minPct.toFixed(2)}% to {maxPct.toFixed(2)}% of assets
        per year), not a stake in the holdings.
      </p>

      {chartered ? (
        <p className="text-xs font-semibold text-foreground">
          {chartered.ticker} is chartered and trading.{" "}
          <Link href={fundHref} className="text-primary hover:underline">
            View the fund
          </Link>
        </p>
      ) : (
        <form onSubmit={charter} className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-56 flex-1 flex-col text-xs text-foreground">
              Fund name
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Meridian National Index"
                minLength={4}
                maxLength={60}
                className="mt-1 rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
                required
              />
            </label>
            <label className="flex flex-col text-xs text-foreground">
              Ticker (3 to 8 letters)
              <input
                type="text"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
                placeholder="MERX"
                maxLength={8}
                className="mt-1 w-28 rounded-lg border border-card-border bg-card px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
                required
              />
            </label>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-xs text-foreground">
              Scope
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as "country" | "global")}
                className="mt-1 rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                <option value="country">One country</option>
                <option value="global">Global</option>
              </select>
            </label>
            {scope === "country" && (
              <label className="flex flex-col text-xs text-foreground">
                Country
                <select
                  value={countryId}
                  onChange={(e) => setCountryId(e.target.value)}
                  className="mt-1 rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  required
                >
                  <option value="">Pick a country…</option>
                  {ALL_COUNTRY_IDS.map((id) => (
                    <option key={id} value={id}>
                      {resolveCountryName(id)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col text-xs text-foreground">
              Kind
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as "broad" | "sector")}
                className="mt-1 rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                <option value="broad">Broad market</option>
                <option value="sector">One industry</option>
              </select>
            </label>
            {kind === "sector" && (
              <label className="flex flex-col text-xs text-foreground">
                Industry
                <select
                  value={sectorType}
                  onChange={(e) => setSectorType(e.target.value)}
                  className="mt-1 rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  required
                >
                  <option value="">Pick an industry…</option>
                  {CORPORATION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {CORPORATION_TYPE_LABELS[t as CorporationType]}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-xs text-foreground">
              Expense ratio (% per year)
              <input
                type="number"
                value={expensePct}
                onChange={(e) => setExpensePct(e.target.value)}
                min={minPct}
                max={maxPct}
                step="0.01"
                className="mt-1 w-32 rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                required
              />
            </label>
            <label className="flex flex-col text-xs text-foreground">
              Seed capital (₳)
              <input
                type="number"
                value={seedCapital}
                onChange={(e) => setSeedCapital(e.target.value)}
                min={FUND_MIN_SEED_CAPITAL_ANCHOR}
                step="1000000"
                className="mt-1 w-44 rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                required
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? "Chartering…" : `Charter for ${fmt(totalCost)}`}
            </button>
          </div>
          <p className="text-[11px] text-muted">
            Paid from corporate cash: the {fmt(FUND_CHARTER_FEE_ANCHOR)} fee is never refunded; the
            seed capital comes back at wind-up only after every unit holder has been paid.
          </p>
        </form>
      )}
      {error && <p className="mt-2 text-xs text-error">{error}</p>}
    </section>
  );
}
