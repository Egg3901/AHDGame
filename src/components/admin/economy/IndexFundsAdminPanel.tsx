"use client";

import { useCallback, useEffect, useState } from "react";
import { ResponsiveTable, type ResponsiveTableColumn } from "@/components/ui/ResponsiveTable";
import { fetchJson } from "@/lib/observability/fetchJson";

interface AdminFundRow {
  id: string;
  slug: string;
  name: string;
  tickerSymbol: string;
  scope: string;
  kind: string;
  countryId: string | null;
  status: string;
  quotedNav: number;
  unitSupply: number;
  cashAnchor: number;
  backingRatio: number | null;
  holdingsCount: number;
}

function fmt(n: number) {
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

const COLUMNS: ResponsiveTableColumn<AdminFundRow>[] = [
  {
    key: "tickerSymbol",
    header: "Ticker",
    render: (r) => <span className="font-mono font-bold text-primary">{r.tickerSymbol}</span>,
  },
  {
    key: "name",
    header: "Fund",
    render: (r) => (
      <div>
        <span className="font-medium">{r.name}</span>
        <span className="block text-xs text-muted">{r.slug}</span>
      </div>
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (r) => (
      <span
        className={`text-xs font-semibold uppercase ${
          r.status === "active"
            ? "text-success"
            : r.status === "paused"
              ? "text-warning"
              : "text-error"
        }`}
      >
        {r.status}
      </span>
    ),
  },
  {
    key: "quotedNav",
    header: "NAV",
    render: (r) => <span className="tabular-nums">{fmt(r.quotedNav)}</span>,
  },
  {
    key: "backingRatio",
    header: "Backing",
    render: (r) => (
      <span className="tabular-nums">
        {r.backingRatio != null ? `${(r.backingRatio * 100).toFixed(0)}%` : "—"}
      </span>
    ),
  },
  {
    key: "cashAnchor",
    header: "Cash",
    hideOnMobile: true,
    render: (r) => <span className="tabular-nums">{fmt(r.cashAnchor)}</span>,
  },
  {
    key: "unitSupply",
    header: "Units",
    hideOnMobile: true,
    render: (r) => <span className="tabular-nums">{r.unitSupply.toLocaleString("en-US")}</span>,
  },
];

export function IndexFundsAdminPanel() {
  const [funds, setFunds] = useState<AdminFundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [injectAmount, setInjectAmount] = useState("");
  const [injectLoading, setInjectLoading] = useState(false);
  const [injectMessage, setInjectMessage] = useState("");
  const [injectAllLoading, setInjectAllLoading] = useState(false);
  const [injectAllMessage, setInjectAllMessage] = useState("");
  const [deployAmount, setDeployAmount] = useState("");
  const [deployAllLoading, setDeployAllLoading] = useState(false);
  const [deployAllMessage, setDeployAllMessage] = useState("");

  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/investment-funds");
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error || "Failed to load funds");
        return;
      }
      const data = (await res.json()) as { funds: AdminFundRow[] };
      setFunds(data.funds ?? []);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setMessage("");
    try {
      const [fundRes, holdersJson] = await Promise.all([
        fetch(`/api/admin/investment-funds/${id}`),
        fetchJson<unknown>(`/api/investment-funds/${id}/holders`, {
          feature: "admin-index-fund-holders",
        }).catch(() => null),
      ]);
      if (!fundRes.ok) {
        const body = (await fundRes.json().catch(() => ({}))) as { error?: string };
        setMessage(body.error || `Failed to load fund (HTTP ${fundRes.status})`);
        return;
      }
      const fundJson = (await fundRes.json()) as { fund: Record<string, unknown> };
      setDetail(fundJson.fund);
      if (holdersJson) {
        setDetail((prev) => ({ ...(prev ?? {}), _holders: holdersJson }));
      }
    } catch {
      setMessage("Network error loading fund detail");
    }
  }, []);

  const injectCapitalAll = async () => {
    if (
      !confirm(
        "Top every fund up to 100% backing? This injects anchor-currency cash into each underbacked fund without minting units."
      )
    ) {
      return;
    }
    setInjectAllLoading(true);
    setInjectAllMessage("");
    try {
      const res = await fetch("/api/admin/investment-funds/inject-capital-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetBackingRatio: 1.0 }),
      });
      const body = (await res.json()) as {
        error?: string;
        fundsInjected?: number;
        fundsProcessed?: number;
        totalsByCurrency?: Record<string, number>;
      };
      if (!res.ok) {
        setInjectAllMessage(body.error || "Bulk injection failed");
        return;
      }
      const totals = body.totalsByCurrency
        ? Object.entries(body.totalsByCurrency)
            .map(([code, amt]) => `${Math.round(amt).toLocaleString("en-US")} ${code}`)
            .join(", ")
        : "—";
      setInjectAllMessage(
        `Topped up ${body.fundsInjected ?? 0}/${body.fundsProcessed ?? 0} funds to 100% backing. Injected: ${totals || "nothing needed"}.`
      );
      await loadList();
      if (selectedId) await loadDetail(selectedId);
    } catch {
      setInjectAllMessage("Network error");
    } finally {
      setInjectAllLoading(false);
    }
  };

  const deployCashAll = async () => {
    const amount = Number(deployAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setDeployAllMessage("Enter a positive amount.");
      return;
    }
    if (!confirm(`Inject ${fmt(amount)} deployable cash into every active fund as buying power?`)) {
      return;
    }
    setDeployAllLoading(true);
    setDeployAllMessage("");
    try {
      const res = await fetch("/api/admin/investment-funds/deploy-cash-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountAnchor: amount }),
      });
      const body = (await res.json()) as {
        error?: string;
        fundsInjected?: number;
        fundsProcessed?: number;
        totalsByCurrency?: Record<string, number>;
      };
      if (!res.ok) {
        setDeployAllMessage(body.error || "Bulk deploy failed");
        return;
      }
      const totals = body.totalsByCurrency
        ? Object.entries(body.totalsByCurrency)
            .map(([code, amt]) => `${Math.round(amt).toLocaleString("en-US")} ${code}`)
            .join(", ")
        : "—";
      setDeployAllMessage(
        `Deployed cash to ${body.fundsInjected ?? 0}/${body.fundsProcessed ?? 0} active funds. Total: ${totals || "none"}.`
      );
      setDeployAmount("");
      await loadList();
      if (selectedId) await loadDetail(selectedId);
    } catch {
      setDeployAllMessage("Network error");
    } finally {
      setDeployAllLoading(false);
    }
  };

  const setStatus = async (status: "active" | "paused" | "delisted") => {
    if (!selectedId) return;
    setActionLoading(true);
    setMessage("");
    try {
      const res = await fetch(`/api/admin/investment-funds/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, pauseReason: status === "paused" ? "manual" : undefined }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMessage(body.error || "Update failed");
        return;
      }
      setMessage(`Fund set to ${status}.`);
      await loadList();
      await loadDetail(selectedId);
    } catch {
      setMessage("Network error");
    } finally {
      setActionLoading(false);
    }
  };

  const injectCapital = async () => {
    if (!selectedId) return;
    const amount = Number(injectAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setInjectMessage("Enter a positive amount.");
      return;
    }
    setInjectLoading(true);
    setInjectMessage("");
    try {
      const res = await fetch(`/api/admin/investment-funds/${selectedId}/inject-capital`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const body = (await res.json()) as {
        error?: string;
        quotedNav?: number;
        backingRatio?: number;
      };
      if (!res.ok) {
        setInjectMessage(body.error || "Injection failed");
        return;
      }
      setInjectAmount("");
      setInjectMessage(
        `Injected ${fmt(amount)}. NAV ${body.quotedNav?.toFixed(4) ?? "—"}, backing ${body.backingRatio != null ? `${(body.backingRatio * 100).toFixed(1)}%` : "—"}.`
      );
      await loadList();
      await loadDetail(selectedId);
    } catch {
      setInjectMessage("Network error");
    } finally {
      setInjectLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        Manage index fund definitions, backing health, and pause state. Player subscribe/redeem uses
        fund cash only — queued redemptions pay when cash is available on the hourly cron.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={injectAllLoading || loading}
          onClick={() => void injectCapitalAll()}
          className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-40"
        >
          {injectAllLoading ? "Recapitalizing…" : "Inject Capital — All Funds to 100%"}
        </button>
        {injectAllMessage && (
          <span
            className={`text-xs ${injectAllMessage.startsWith("Topped up") ? "text-success" : "text-error"}`}
            role="status"
          >
            {injectAllMessage}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="number"
          min={1}
          value={deployAmount}
          onChange={(e) => setDeployAmount(e.target.value)}
          placeholder="Amount (anchor)"
          className="rounded-lg border border-card-border bg-card px-3 py-2 text-xs w-40 focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="button"
          disabled={deployAllLoading || loading}
          onClick={() => void deployCashAll()}
          className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-40"
        >
          {deployAllLoading ? "Deploying…" : "Deploy Cash to All Funds"}
        </button>
        {deployAllMessage && (
          <span
            className={`text-xs ${deployAllMessage.startsWith("Deployed") ? "text-success" : "text-error"}`}
            role="status"
          >
            {deployAllMessage}
          </span>
        )}
      </div>

      {error && (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading funds…</p>
      ) : (
        <ResponsiveTable
          columns={COLUMNS}
          data={funds}
          keyExtractor={(row) => row.id}
          emptyMessage="No index funds seeded."
          renderActions={(row) => (
            <button
              type="button"
              onClick={() => void loadDetail(row.id)}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Manage
            </button>
          )}
        />
      )}

      {selectedId && detail && (
        <div className="rounded-xl border border-card-border bg-card p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold">{String(detail.name ?? "")}</h3>
              <p className="text-sm text-muted font-mono">{String(detail.tickerSymbol ?? "")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={actionLoading || detail.status === "active"}
                onClick={() => void setStatus("active")}
                className="rounded-lg border border-card-border px-3 py-1.5 text-xs font-semibold hover:bg-card-elevated disabled:opacity-40"
              >
                Resume
              </button>
              <button
                type="button"
                disabled={actionLoading || detail.status === "paused"}
                onClick={() => void setStatus("paused")}
                className="rounded-lg border border-warning/40 px-3 py-1.5 text-xs font-semibold text-warning hover:bg-warning/10 disabled:opacity-40"
              >
                Pause
              </button>
              <button
                type="button"
                disabled={actionLoading || detail.status === "delisted"}
                onClick={() => void setStatus("delisted")}
                className="rounded-lg border border-error/40 px-3 py-1.5 text-xs font-semibold text-error hover:bg-error/10 disabled:opacity-40"
              >
                Delist
              </button>
            </div>
          </div>

          {message && (
            <p className="text-xs text-success" role="status">
              {message}
            </p>
          )}

          <div className="rounded-lg border border-card-border bg-card-elevated p-4 space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Inject Capital
            </h4>
            <p className="text-xs text-muted">
              Adds anchor-currency cash to the fund without minting units. Raises NAV and improves
              backing ratio.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[12rem]">
                <label htmlFor="inject-amount" className="sr-only">
                  Amount
                </label>
                <input
                  id="inject-amount"
                  type="number"
                  min="0.01"
                  step="any"
                  value={injectAmount}
                  onChange={(e) => setInjectAmount(e.target.value)}
                  placeholder="Amount (anchor)"
                  className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </div>
              <button
                type="button"
                disabled={injectLoading}
                onClick={() => void injectCapital()}
                className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-40"
              >
                {injectLoading ? "Injecting…" : "Inject Capital"}
              </button>
            </div>
            {injectMessage && (
              <p
                className={`text-xs ${injectMessage.startsWith("Injected") ? "text-success" : "text-error"}`}
                role="status"
              >
                {injectMessage}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Stat label="NAV" value={fmt(Number(detail.quotedNav ?? 0))} />
            <Stat
              label="Backing"
              value={
                detail.backingRatio != null
                  ? `${(Number(detail.backingRatio) * 100).toFixed(1)}%`
                  : "—"
              }
            />
            <Stat label="Cash" value={fmt(Number(detail.cashAnchor ?? 0))} />
            <Stat label="Units" value={Number(detail.unitSupply ?? 0).toLocaleString("en-US")} />
            <Stat label="Holdings" value={String((detail.holdings as unknown[])?.length ?? 0)} />
            <Stat
              label="Targets"
              value={String((detail.targetConstituents as unknown[])?.length ?? 0)}
            />
          </div>

          {detail._holders != null && (
            <pre className="text-[10px] text-muted overflow-auto max-h-40 rounded-lg bg-card-elevated p-3">
              {JSON.stringify(
                (detail._holders as { queuedRedemptions?: unknown[] }).queuedRedemptions?.length ??
                  0,
                null,
                0
              )}{" "}
              queued redemptions — open fund page for full holder list
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-card-border bg-card-elevated px-3 py-2">
      <p className="text-[10px] uppercase tracking-widest text-muted">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
    </div>
  );
}
