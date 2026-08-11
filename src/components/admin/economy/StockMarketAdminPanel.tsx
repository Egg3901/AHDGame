"use client";

import { useState, useEffect, useCallback } from "react";
import { ResponsiveTable, type ResponsiveTableColumn } from "@/components/ui/ResponsiveTable";

const COUNTRY_PILLS = [
  { id: "", label: "World" },
  { id: "US", label: "US" },
  { id: "UK", label: "UK" },
  { id: "JP", label: "JP" },
  { id: "DE", label: "DE" },
];

interface CorpRow {
  id: string;
  name: string;
  countryId: string;
  type: string;
  marketCap: number;
  sharePrice: number;
  revenue: number;
  ceoVacant: boolean;
  suspended: boolean;
  bondDefaultActive: boolean;
  liquidCapital: number;
}

interface Summary {
  total: number;
  totalMarketCap: number;
  totalRevenue: number;
  ceoVacancies: number;
  suspended: number;
}

function fmt(n: number) {
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

const COLUMNS: ResponsiveTableColumn<CorpRow>[] = [
  {
    key: "name",
    header: "Corporation",
    render: (r) => <span className="font-medium">{r.name}</span>,
  },
  {
    key: "countryId",
    header: "Country",
    hideOnMobile: true,
    render: (r) => <span className="text-muted">{r.countryId}</span>,
  },
  {
    key: "type",
    header: "Sector",
    hideOnMobile: true,
    render: (r) => (
      <span className="text-muted">
        {r.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
      </span>
    ),
  },
  {
    key: "marketCap",
    header: "Market Cap",
    render: (r) => <span>{fmt(r.marketCap)}</span>,
  },
  {
    key: "sharePrice",
    header: "Share Price",
    hideOnMobile: true,
    render: (r) => <span>{fmt(r.sharePrice)}</span>,
  },
  {
    key: "revenue",
    header: "Daily Revenue",
    render: (r) => <span>{fmt(r.revenue)}</span>,
  },
  {
    key: "status",
    header: "Status",
    render: (r) => {
      const flags: string[] = [];
      if (r.ceoVacant) flags.push("CEO Vacant");
      if (r.suspended) flags.push("Suspended");
      if (r.bondDefaultActive) flags.push("Bond Default");
      if (flags.length === 0) return <span className="text-muted text-xs">OK</span>;
      return <span className="text-xs font-medium text-error">{flags.join(" · ")}</span>;
    },
  },
];

export function StockMarketAdminPanel() {
  const [countryFilter, setCountryFilter] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [corps, setCorps] = useState<CorpRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = countryFilter ? `?countryId=${countryFilter}` : "";
      const res = await fetch(`/api/admin/economy/stock-market${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setSummary(json.summary);
      setCorps(json.corporations);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [countryFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">Stock Market</h2>
        {/* Country filter pills */}
        <div className="flex flex-wrap gap-2">
          {COUNTRY_PILLS.map((pill) => (
            <button
              key={pill.id}
              onClick={() => setCountryFilter(pill.id)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                countryFilter === pill.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-card border border-card-border text-muted hover:text-foreground"
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary stat cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Market Cap", value: fmt(summary.totalMarketCap) },
            {
              label: "Listed Corps",
              value: String(summary.total),
              sub: (() => {
                const flaggedCount = corps.filter(
                  (c) => c.ceoVacant || c.liquidCapital <= 0 || c.suspended || c.bondDefaultActive
                ).length;
                return flaggedCount > 0 ? `${flaggedCount} flagged` : undefined;
              })(),
              subHighlight: true,
            },
            { label: "Daily Revenue", value: fmt(summary.totalRevenue) },
            {
              label: "CEO Vacancies",
              value: String(summary.ceoVacancies),
              highlight: summary.ceoVacancies > 0,
            },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-card-border bg-card p-4 space-y-1"
            >
              <p className="text-xs text-muted uppercase tracking-wider">{card.label}</p>
              <p
                className={`text-xl font-semibold ${card.highlight ? "text-error" : "text-foreground"}`}
              >
                {card.value}
              </p>
              {card.sub && (
                <p className={`text-xs ${card.subHighlight ? "text-warning" : "text-muted"}`}>
                  {card.sub}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-error bg-error/10 rounded-lg px-4 py-3">{error}</p>}

      {/* Flagged corporations */}
      {!loading &&
        (() => {
          const flagged = corps
            .map((c) => {
              const badges: { label: string; color: "error" | "warning" }[] = [];
              if (c.ceoVacant) badges.push({ label: "CEO Vacant", color: "error" });
              if (c.liquidCapital <= 0) badges.push({ label: "Insolvent", color: "error" });
              if (c.suspended) badges.push({ label: "Suspended", color: "warning" });
              if (c.bondDefaultActive) badges.push({ label: "Bond Default", color: "warning" });
              return badges.length > 0 ? { corp: c, badges } : null;
            })
            .filter(Boolean) as {
            corp: CorpRow;
            badges: { label: string; color: "error" | "warning" }[];
          }[];

          if (flagged.length === 0) return null;

          return (
            <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
              <div className="px-5 py-3 border-b border-card-border">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  <span className="text-warning">&#9650;</span> Flagged Corporations
                </h3>
              </div>
              <div className="divide-y divide-card-border">
                {flagged.map(({ corp, badges }) => {
                  const borderColor = badges.some((b) => b.color === "error")
                    ? "border-l-error"
                    : "border-l-warning";
                  return (
                    <div
                      key={corp.id}
                      className={`flex items-center justify-between px-5 py-3 border-l-2 ${borderColor}`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-medium text-sm">{corp.name}</span>
                        <span className="text-xs text-muted">
                          {[
                            corp.ceoVacant && "No CEO",
                            corp.liquidCapital <= 0 && `Liquid capital ${fmt(corp.liquidCapital)}`,
                            corp.suspended && "Trading suspended",
                            corp.bondDefaultActive && "In default",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        {badges.map((b) => (
                          <span
                            key={b.label}
                            className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${
                              b.color === "error"
                                ? "bg-error/15 text-error"
                                : "bg-warning/15 text-warning"
                            }`}
                          >
                            {b.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

      {loading ? (
        <div className="text-muted text-sm py-8 text-center">Loading…</div>
      ) : (
        <>
          <div className="flex items-center gap-2 px-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
              All Listed Corporations
            </h3>
          </div>
          <ResponsiveTable
            columns={COLUMNS}
            data={corps}
            keyExtractor={(r) => r.id}
            emptyMessage="No corporations found."
          />
        </>
      )}
    </div>
  );
}
