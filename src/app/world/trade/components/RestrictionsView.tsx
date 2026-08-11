"use client";

import { useEffect, useMemo, useState } from "react";
import type { CountryId } from "@/lib/constants/countries";
import type { CommodityType } from "@/lib/constants/commodities";
import { CORPORATION_TYPE_LABELS, type CorporationType } from "@/lib/constants/corporations";
import type { TariffScopeType } from "@/lib/db/types/tariff";
import type { WorldTradeLedger } from "@/lib/trade/queries/worldTradeLedger";
import { formatEmbargoProvisionLabel } from "@/lib/legislature/embargoProvisionLabel";

interface TariffItem {
  id: string;
  /** Country imposing the tariff (where the bill passed). */
  countryId: CountryId;
  scopeType: TariffScopeType;
  targetSectorType: CorporationType | null;
  targetOriginCountryId: CountryId | null;
  targetCorporationName: string | null;
  rate: number;
}

const TARIFF_SCOPE_LABELS: Record<TariffScopeType, string> = {
  economy_wide: "Economy-wide",
  sector: "Sector",
  origin_country: "Origin country",
  corporation: "Corporation",
};

interface EmbargoItem {
  id: string;
  sourceCountry: CountryId;
  targetCountry: CountryId;
  commodity: CommodityType | "all";
  direction: "export" | "import" | "both";
  mode: "block" | "cap";
  cap: number | null;
  origin: "minister" | "legislation";
  expiresTurn: number | null;
}

interface PendingItem {
  billId: string;
  billTitle: string;
  status: string;
  action: "embargo" | "end_embargo";
  sourceCountry: CountryId;
  targetCountry: CountryId;
  commodity: CommodityType | "all";
  direction: "export" | "import" | "both";
  mode: "block" | "cap" | null;
  cap: number | null;
}

const STATUS_LABELS: Record<string, string> = {
  active: "Voting",
  floor_vote: "Floor vote",
  other_chamber: "Other chamber",
  presidential_review: "Awaiting signature",
  passed: "Passed",
  override_vote: "Override vote",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

/**
 * Trade Restrictions — a read-only roster of the trade barriers in force across
 * the world, grouped by the nation imposing them: active embargoes (with
 * embargo legislation still working through a legislature) and standing tariffs.
 */
export default function RestrictionsView({ ledger }: { ledger: WorldTradeLedger }) {
  const [items, setItems] = useState<EmbargoItem[]>([]);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [tariffs, setTariffs] = useState<TariffItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // Country code → display name + identity hue, from the ledger (seals-only hue).
  const countryMeta = useMemo(() => {
    const m = new Map<string, { name: string; hue: string }>();
    for (const n of ledger.nations) m.set(n.code, { name: n.name, hue: n.hue });
    return m;
  }, [ledger.nations]);

  useEffect(() => {
    let cancelled = false;
    // Embargoes and tariffs are independent endpoints — load both, and only
    // surface the full-panel error if BOTH fail (a partial load still shows
    // whatever resolved).
    let embargoFailed = false;
    let tariffFailed = false;
    Promise.all([
      fetch(`/api/world/trade/embargoes`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
        .then((d: { items?: EmbargoItem[]; pending?: PendingItem[] }) => ({
          items: d.items ?? [],
          pending: d.pending ?? [],
        }))
        .catch(() => {
          embargoFailed = true;
          return { items: [] as EmbargoItem[], pending: [] as PendingItem[] };
        }),
      fetch(`/api/world/trade/tariffs`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
        .then((d: { items?: TariffItem[] }) => d.items ?? [])
        .catch(() => {
          tariffFailed = true;
          return [] as TariffItem[];
        }),
    ])
      .then(([embargo, tariffItems]) => {
        if (cancelled) return;
        setItems(embargo.items);
        setPending(embargo.pending);
        setTariffs(tariffItems);
        setFailed(embargoFailed && tariffFailed);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Active embargoes grouped by imposing country (rows sorted by target/commodity).
  const groups = useMemo(() => {
    const bySource = new Map<string, EmbargoItem[]>();
    for (const e of items) {
      const list = bySource.get(e.sourceCountry) ?? [];
      list.push(e);
      bySource.set(e.sourceCountry, list);
    }
    return [...bySource.entries()]
      .map(([code, rows]) => ({
        code,
        rows: rows.sort(
          (a, b) =>
            a.targetCountry.localeCompare(b.targetCountry) ||
            String(a.commodity).localeCompare(String(b.commodity))
        ),
      }))
      .sort((a, b) => b.rows.length - a.rows.length || a.code.localeCompare(b.code));
  }, [items]);

  // Active tariffs grouped by imposing country, mirroring the embargo grouping
  // (most-restrictive nations first, then alphabetical).
  const tariffGroups = useMemo(() => {
    const bySource = new Map<string, TariffItem[]>();
    for (const t of tariffs) {
      const list = bySource.get(t.countryId) ?? [];
      list.push(t);
      bySource.set(t.countryId, list);
    }
    const scopeOrder: Record<TariffScopeType, number> = {
      economy_wide: 0,
      sector: 1,
      origin_country: 2,
      corporation: 3,
    };
    return [...bySource.entries()]
      .map(([code, rows]) => ({
        code,
        rows: rows.sort(
          (a, b) => scopeOrder[a.scopeType] - scopeOrder[b.scopeType] || b.rate - a.rate
        ),
      }))
      .sort((a, b) => b.rows.length - a.rows.length || a.code.localeCompare(b.code));
  }, [tariffs]);

  // Human-readable description of a tariff's scope/target (rate shown separately).
  function tariffSummary(t: TariffItem): string {
    switch (t.scopeType) {
      case "economy_wide":
        return "All imported goods";
      case "sector":
        return t.targetSectorType
          ? `${CORPORATION_TYPE_LABELS[t.targetSectorType] ?? t.targetSectorType} sector`
          : "Sector tariff";
      case "origin_country":
        return t.targetOriginCountryId
          ? `Goods from ${countryMeta.get(t.targetOriginCountryId)?.name ?? t.targetOriginCountryId}`
          : "Origin-country tariff";
      case "corporation":
        return t.targetCorporationName ?? "Specific corporation";
      default:
        return TARIFF_SCOPE_LABELS[t.scopeType] ?? t.scopeType;
    }
  }

  function chip(code: string) {
    const meta = countryMeta.get(code);
    const hue = meta?.hue ?? "var(--muted)";
    return (
      <span
        className="inline-flex h-6 w-9 flex-shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold"
        style={{ border: `1.5px solid ${hue}`, color: hue, background: `${hue}24` }}
        title={meta?.name ?? code}
      >
        {code}
      </span>
    );
  }

  const nothing = groups.length === 0 && pending.length === 0 && tariffGroups.length === 0;

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 sm:p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-foreground">
          Trade Restrictions{" "}
          <span className="font-normal text-muted">· embargoes &amp; tariffs</span>
        </h3>
        <span className="text-[10px] text-muted">
          {items.length + tariffs.length} active
          {pending.length > 0 ? ` · ${pending.length} pending` : ""}
        </span>
      </div>

      {loading ? (
        <p className="py-6 text-center text-sm text-muted">Loading restrictions…</p>
      ) : failed ? (
        <p className="py-6 text-center text-sm text-error">
          Couldn&apos;t load trade restrictions.
        </p>
      ) : nothing ? (
        <p className="py-6 text-center text-sm text-muted">
          No embargoes or tariffs are in force. Trade flows freely.
        </p>
      ) : (
        <div className="space-y-6">
          {/* ── Active embargoes ── */}
          {groups.length > 0 && (
            <div className="space-y-5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">
                Embargoes
              </h4>
              {groups.map((g) => (
                <div key={g.code}>
                  <div className="mb-2 flex items-center gap-2">
                    {chip(g.code)}
                    <span className="text-sm font-semibold text-foreground">
                      {countryMeta.get(g.code)?.name ?? g.code}
                    </span>
                    <span className="text-[11px] text-muted">
                      · {g.rows.length} restriction{g.rows.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <ul className="space-y-2">
                    {g.rows.map((e) => {
                      const summary = formatEmbargoProvisionLabel({
                        type: "embargo",
                        targetCountry: e.targetCountry,
                        commodity: e.commodity,
                        direction: e.direction,
                        mode: e.mode,
                        ...(e.cap != null ? { cap: e.cap } : {}),
                      }).summary;
                      return (
                        <li
                          key={e.id}
                          className="flex items-center gap-3 rounded-lg border border-card-border bg-card-elevated px-3 py-2"
                        >
                          {chip(e.targetCountry)}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-foreground">{summary}</p>
                            <p className="text-[11px] text-muted">
                              {e.origin === "legislation" ? "By law" : "Ministerial"}
                              {e.expiresTurn != null
                                ? ` · expires turn ${e.expiresTurn}`
                                : " · until repealed"}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                              e.mode === "block"
                                ? "border-error/40 text-error"
                                : "border-warning/40 text-warning"
                            }`}
                          >
                            {e.mode === "block" ? "Block" : "Cap"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {/* ── Tariffs ── */}
          {tariffGroups.length > 0 && (
            <div className="space-y-5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">Tariffs</h4>
              {tariffGroups.map((g) => (
                <div key={g.code}>
                  <div className="mb-2 flex items-center gap-2">
                    {chip(g.code)}
                    <span className="text-sm font-semibold text-foreground">
                      {countryMeta.get(g.code)?.name ?? g.code}
                    </span>
                    <span className="text-[11px] text-muted">
                      · {g.rows.length} tariff{g.rows.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <ul className="space-y-2">
                    {g.rows.map((t) => (
                      <li
                        key={t.id}
                        className="flex items-center gap-3 rounded-lg border border-card-border bg-card-elevated px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-foreground">{tariffSummary(t)}</p>
                          <p className="text-[11px] text-muted">
                            {TARIFF_SCOPE_LABELS[t.scopeType] ?? t.scopeType}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-md border border-warning/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
                          {t.rate}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {/* ── Pending legislation ── */}
          {pending.length > 0 && (
            <div>
              <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
                Pending in legislation
                <span className="rounded-md border border-primary/40 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-primary">
                  not yet in force
                </span>
              </h4>
              <ul className="space-y-2">
                {pending.map((p) => {
                  const summary = formatEmbargoProvisionLabel({
                    targetCountry: p.targetCountry,
                    commodity: p.commodity,
                    direction: p.direction,
                    ...(p.action === "end_embargo"
                      ? { type: "end_embargo" as const }
                      : {
                          type: "embargo" as const,
                          mode: p.mode ?? "block",
                          ...(p.cap != null ? { cap: p.cap } : {}),
                        }),
                  }).summary;
                  return (
                    <li
                      key={`${p.billId}-${p.targetCountry}-${p.commodity}-${p.direction}`}
                      className="flex items-center gap-3 rounded-lg border border-dashed border-card-border bg-card-elevated/60 px-3 py-2"
                    >
                      {chip(p.sourceCountry)}
                      <span className="text-muted">→</span>
                      {chip(p.targetCountry)}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-foreground">{summary}</p>
                        <p className="truncate text-[11px] text-muted">
                          {countryMeta.get(p.sourceCountry)?.name ?? p.sourceCountry} ·{" "}
                          {p.billTitle}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-md border border-card-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                        {statusLabel(p.status)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
