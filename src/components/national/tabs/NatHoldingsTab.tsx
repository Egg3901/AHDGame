import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import { formatCompactNumber } from "@/lib/utils/formatters";
import type {
  NationalCorporationViewModel,
  NatViewSector,
} from "@/lib/nationalization/nationalCorporationView";
import { natMoney as money } from "../natMoney";
import { SectorGlyph } from "../sectorIcons";

function pp(n: number): string {
  return `${n >= 0 ? "+" : ""}${(Math.round(n * 10) / 10).toFixed(1)}`;
}

/** Trigger badge tone, keyed on the human label the view-model produces. */
const TRIGGER_TONE: Record<string, string> = {
  "Financial distress": "border-warning/30 bg-warning/10 text-warning",
  "Strategic sector": "border-error/30 bg-error/10 text-error",
  "Monopoly / dominance": "border-secondary/30 bg-secondary/10 text-secondary",
  "Supermajority vote": "border-primary/30 bg-primary/10 text-primary",
  "Founding charter": "border-gold/30 bg-gold/10 text-gold",
};

/**
 * Holdings (read-only): one card per absorbed sector — acquisition provenance,
 * mandate postures, and the live revenue / profit / workers / market-share /
 * public-value / efficiency readout with a region metric bar. Expand a card for
 * the dynamic-efficiency formula and the SOE-vs-private comparison. Spec §11.3 / §17.
 */
export function NatHoldingsTab({ vm }: { vm: NationalCorporationViewModel }) {
  const holdings = vm.holdingsByRegion.flatMap((r) => r.sectors);
  if (holdings.length === 0) {
    return (
      <EmptyState
        title="No holdings"
        description="This National Corporation owns no sectors yet."
      />
    );
  }
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-card-border bg-card p-4">
        <h2 className="text-heading-sm font-semibold text-foreground">State holdings</h2>
        <p className="mt-1 text-body-xs text-muted">
          Every nationalized sector is absorbed into this single National Corporation — no
          proliferation of separate SOEs. Sectors merge by region; the original firms were
          dissolved.
        </p>
      </div>

      <div className="space-y-2.5">
        {holdings.map((s) => (
          <HoldingCard key={s.sectorId} s={s} currency={vm.currency} />
        ))}
      </div>
    </div>
  );
}

function HoldingCard({ s, currency }: { s: NatViewSector; currency: string }) {
  const [open, setOpen] = useState(false);
  const triggerTone = s.acquisitionTrigger
    ? (TRIGGER_TONE[s.acquisitionTrigger] ?? "border-card-border bg-card-muted text-muted")
    : null;
  const noMandate = !s.priceControlled && !s.employmentGuaranteed;

  return (
    <div className="overflow-hidden rounded-xl border border-card-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full p-4 text-left transition-colors hover:border-gold/30"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          {/* Identity + provenance */}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <SectorGlyph type={s.sectorType} className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body-sm font-semibold text-foreground">
                  {CORPORATION_TYPE_LABELS[s.sectorType]}
                </span>
                <Pill className="border-card-border bg-card-muted text-muted">{s.stateName}</Pill>
                {triggerTone && <Pill className={triggerTone}>{s.acquisitionTrigger}</Pill>}
              </div>
              <div className="mt-1 text-[11px] text-muted">
                {s.acquisitionFrom ? (
                  <>
                    absorbed from <span className="text-foreground/80">{s.acquisitionFrom}</span>
                  </>
                ) : (
                  "founding holding"
                )}
                {s.acquisitionTurn != null && s.acquisitionFrom && (
                  <span> · turn {s.acquisitionTurn}</span>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {s.priceControlled && (
                  <Pill className="border-gold/30 bg-gold/10 text-gold">Price-controlled</Pill>
                )}
                {s.employmentGuaranteed && (
                  <Pill className="border-success/30 bg-success/10 text-success">
                    Employment guaranteed
                  </Pill>
                )}
                {noMandate && (
                  <Pill className="border-card-border bg-card-muted text-muted">
                    No active mandate
                  </Pill>
                )}
              </div>
            </div>
          </div>

          {/* Readout grid + region metric bar */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4 lg:w-[440px] lg:shrink-0">
            <Cell label="Revenue/turn" value={money(s.revenue, currency)} />
            <Cell
              label="Profit/turn"
              value={money(s.operatingProfit, currency)}
              tone={s.operatingProfit >= 0 ? "success" : "error"}
            />
            <Cell label="Workers" value={formatCompactNumber(s.workers)} />
            <Cell label="Mkt share" value={`${Math.round(s.marketSharePercent)}%`} />
            <Cell
              label="Public value"
              value={`+${s.publicValuePerTurn.toFixed(2)}/t`}
              tone="gold"
            />
            <Cell
              label="Efficiency"
              value={`${pp(s.efficiency.total)}%`}
              tone={s.efficiency.total >= -12 ? "muted" : "error"}
            />
            {s.mappedMetricLabels.length > 0 && (
              <div className="col-span-2 flex flex-col justify-end">
                <div className="text-[9px] uppercase tracking-wide text-muted">
                  {s.mappedMetricLabels[0]} (region)
                </div>
                <div className="mt-1">
                  <Meter value={s.sectorMetricLevel ?? 0} />
                </div>
              </div>
            )}
          </div>

          <ChevronDown
            className={`hidden h-4 w-4 shrink-0 text-muted transition-transform lg:block ${
              open ? "rotate-180" : ""
            }`}
          />
        </div>
      </button>

      {open && <HoldingDetail s={s} currency={currency} />}
    </div>
  );
}

/** Drill-down: dynamic-efficiency formula + SOE-vs-private comparison. */
function HoldingDetail({ s, currency }: { s: NatViewSector; currency: string }) {
  const e = s.efficiency;
  const privateMarginPct = s.profitMargin; // unconstrained private operator: no SOE penalty
  const privateProfit = Math.round(s.revenue * (privateMarginPct / 100));
  const profitGap = privateProfit - s.operatingProfit;
  const terms = [
    { label: "Base SOE", val: e.base, note: "structural" },
    { label: "Corruption", val: e.corruption, note: "governance" },
    { label: "Governance", val: e.governance, note: "capacity" },
    { label: "Mandate", val: e.mandate, note: s.priceControlled ? "price control" : "none" },
  ];

  return (
    <div className="border-t border-card-border bg-card-muted p-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Efficiency formula */}
        <div className="rounded-lg border border-card-border bg-card p-3.5">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gold">
              Dynamic efficiency
            </span>
            <span className="text-[10px] text-muted">replaces the flat −15%</span>
          </div>
          <div className="flex flex-wrap items-stretch gap-1.5">
            {terms.map((t, i) => (
              <div key={t.label} className="flex items-stretch gap-1.5">
                <div className="flex-1 rounded-md bg-card-muted px-2 py-1.5 text-center">
                  <div className="text-[8px] uppercase tracking-wide text-muted">{t.label}</div>
                  <div
                    className={`text-body-sm font-bold tabular-nums ${
                      t.val < 0 ? "text-error" : t.val > 0 ? "text-success" : "text-muted"
                    }`}
                  >
                    {pp(t.val)}
                  </div>
                  <div className="text-[8px] text-muted">{t.note}</div>
                </div>
                <span className="self-center text-muted">{i < terms.length - 1 ? "+" : "="}</span>
              </div>
            ))}
            <div className="flex-1 rounded-md border border-gold/40 bg-gold/10 px-2 py-1.5 text-center">
              <div className="text-[8px] uppercase tracking-wide text-gold/80">Effective</div>
              <div className="text-body font-bold tabular-nums text-gold">{pp(e.total)}%</div>
            </div>
          </div>
          <p className="mt-2.5 text-[11px] leading-snug text-muted">
            A low-corruption, high-capacity region runs an SOE close to −5%; corruption and
            price-control mandates widen the drag. Governance quality{" "}
            <span className="text-foreground">matters</span> — there is no one-size-fits-all
            penalty.
          </p>
        </div>

        {/* SOE vs private */}
        <div className="rounded-lg border border-card-border bg-card p-3.5">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gold">
            State enterprise vs. private operator
          </div>
          <div className="grid grid-cols-2 gap-2 text-center text-[11px]">
            <div className="rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5 font-semibold text-primary">
              As state enterprise
            </div>
            <div className="rounded-md border border-card-border bg-card-muted px-2 py-1.5 font-semibold text-muted">
              If run privately
            </div>
          </div>
          <CompareRow
            label="Effective margin"
            a={`${pp(s.profitMargin + e.total)}%`}
            b={`+${privateMarginPct.toFixed(1)}%`}
            bBetter
          />
          <CompareRow
            label="Public value"
            a={`+${s.publicValuePerTurn.toFixed(2)}/t`}
            b="0"
            aBetter
          />
          <CompareRow
            label="Profit / turn"
            a={`${money(s.operatingProfit, currency)} → budget`}
            b={`${money(privateProfit, currency)} → owners`}
          />
          <CompareRow label="Consumer prices" a="Regulated · low" b="Market · higher" aBetter />
          <CompareRow
            label="Employment"
            a={s.employmentGuaranteed ? "Floor guaranteed" : "Market"}
            b="At-will"
          />
          <div className="mt-2.5 rounded-md border border-gold/30 bg-gold/5 px-3 py-2 text-[11px] leading-snug text-foreground/85">
            The state trades{" "}
            <span className="font-semibold text-error">{money(profitGap, currency)}/turn</span> of
            forgone profit for{" "}
            <span className="font-semibold text-success">
              +{s.publicValuePerTurn.toFixed(2)}/turn
            </span>{" "}
            of public value and regulated prices. That trade is the whole point of holding it.
          </div>
        </div>
      </div>
    </div>
  );
}

function Pill({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${className}`}
    >
      {children}
    </span>
  );
}

function Cell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "error" | "gold" | "muted";
}) {
  const t =
    tone === "success"
      ? "text-success"
      : tone === "error"
        ? "text-error"
        : tone === "gold"
          ? "text-gold"
          : tone === "muted"
            ? "text-muted"
            : "text-foreground";
  return (
    <div>
      <div className="whitespace-nowrap text-[9px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-0.5 text-[13px] font-bold tabular-nums ${t}`}>{value}</div>
    </div>
  );
}

function Meter({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-card-border">
      <div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
    </div>
  );
}

function CompareRow({
  label,
  a,
  b,
  aBetter,
  bBetter,
}: {
  label: string;
  a: string;
  b: string;
  aBetter?: boolean;
  bBetter?: boolean;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-card-border py-1.5 last:border-0">
      <span
        className={`text-right text-[12px] tabular-nums ${
          aBetter ? "font-semibold text-success" : "text-foreground"
        }`}
      >
        {a}
      </span>
      <span className="px-1 text-center text-[8px] uppercase tracking-wide text-muted">
        {label}
      </span>
      <span
        className={`text-[12px] tabular-nums ${bBetter ? "font-semibold text-success" : "text-foreground"}`}
      >
        {b}
      </span>
    </div>
  );
}
