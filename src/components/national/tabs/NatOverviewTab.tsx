import type { ReactNode } from "react";
import {
  Landmark,
  Banknote,
  HeartPulse,
  Users,
  FileText,
  Activity,
  ArrowRight,
} from "lucide-react";
import { SectionLabel } from "@/components/ui";
import type { NationalCorporationViewModel } from "@/lib/nationalization/nationalCorporationView";
import type { NatOfficialActions } from "../NationalCorporationView";
import { CeoControlPanel } from "../official/CeoControlPanel";
import { CeoDrawCapPanel } from "../official/CeoDrawCapPanel";
import { natMoney as money } from "../natMoney";

type Accent = "crimson" | "gold" | "info" | "success";
const ACCENT: Record<Accent, string> = {
  crimson: "bg-primary/15 text-primary",
  gold: "bg-gold/15 text-gold",
  info: "bg-info/15 text-info",
  success: "bg-success/15 text-success",
};

type Tone = "success" | "error" | "gold" | "foreground";
const TONE: Record<Tone, string> = {
  success: "text-success",
  error: "text-error",
  gold: "text-gold",
  foreground: "text-foreground",
};

function SectionCard({
  title,
  sub,
  icon,
  accent = "crimson",
  children,
}: {
  title: string;
  sub?: string;
  icon: ReactNode;
  accent?: Accent;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2.5">
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${ACCENT[accent]}`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="truncate text-body-sm font-semibold text-foreground">{title}</div>
          {sub && <div className="truncate text-body-xs text-muted">{sub}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

function StatRow({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-card-border py-2 last:border-0">
      <span className="text-body-sm text-muted">{label}</span>
      <span className={`text-body-sm font-semibold tabular-nums ${TONE[tone ?? "foreground"]}`}>
        {value}
      </span>
    </div>
  );
}

/** Confidence bar (0–100) with a baseline tick. */
function Meter({ value, baseline, tone }: { value: number; baseline: number; tone: Tone }) {
  const pct = Math.max(0, Math.min(100, value));
  const base = Math.max(0, Math.min(100, baseline));
  const fill = tone === "error" ? "bg-error" : tone === "success" ? "bg-success" : "bg-foreground";
  return (
    <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-card-muted">
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${pct}%` }} />
      <div className="absolute top-0 h-full w-px bg-foreground/50" style={{ left: `${base}%` }} />
    </div>
  );
}

function BudgetFlowStrip({
  stats,
  currency,
  debtService,
  retentionPercent,
}: {
  stats: NationalCorporationViewModel["stats"];
  currency: string;
  debtService: number;
  retentionPercent: number;
}) {
  // The real cash chain from operating profit to the budget. Two legs the old
  // strip skipped — the retention split and the on-hand-cash cap — are why a
  // player saw sector profit but "0" reaching the budget. `remittedPerTurn` is
  // the same cash-capped figure the turn remits (view-model `cappedRemittanceLocal`),
  // so this reconciles with the budget page's State-Enterprise line. Mandate
  // subsidy is a notional attribution already baked into operating profit, not a
  // second cash deduction, so it is NOT in the flow (it stays an info row below).
  const netToTreasury = Math.max(0, stats.remittedPerTurn - debtService);
  const nodes: Array<{ title: string; value: number; tone?: Tone; sub: string }> = [
    { title: "Operating profit", value: stats.operatingProfitPerTurn, sub: "across held sectors" },
    {
      title: "− Retained in corp",
      value: -stats.retainedPerTurn,
      tone: "error",
      sub: `kept as working capital (${retentionPercent}%)`,
    },
    {
      title: "Remitted",
      value: stats.remittedPerTurn,
      tone: "success",
      sub: stats.remittanceCashCapped ? "capped by cash on hand" : "the remitted share",
    },
    {
      title: "− Assumed-debt service",
      value: -debtService,
      tone: "error",
      sub: "coupons on absorbed bonds",
    },
    {
      title: "Net to treasury",
      value: netToTreasury,
      tone: "success",
      sub: "into the people's budget",
    },
  ];

  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-success/15 text-success">
          <Banknote className="h-4 w-4" />
        </div>
        <div className="text-body-sm font-semibold text-foreground">
          Budget flow{" "}
          <span className="text-body-xs font-normal text-muted">
            · per turn, into the people&apos;s budget
          </span>
        </div>
      </div>
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        {nodes.map((n, i) => (
          <div key={n.title} className="flex flex-1 items-center gap-2">
            <div className="flex-1 rounded-lg border border-card-border bg-card-muted px-3 py-2.5 text-center">
              <div className="text-body-xs uppercase tracking-wide text-muted">{n.title}</div>
              <div
                className={`mt-0.5 text-body-lg font-bold tabular-nums ${TONE[n.tone ?? "foreground"]}`}
              >
                {money(n.value, currency)}/t
              </div>
              <div className="text-body-xs text-muted">{n.sub}</div>
            </div>
            {i < nodes.length - 1 && (
              <ArrowRight className="hidden h-4 w-4 shrink-0 text-muted sm:block" aria-hidden />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Overview (read-only): charter banner, budget-flow strip, and a card grid —
 * treasury & budget, public-mandate scorecard, employment & mandates, assumed
 * debt, investor confidence, acquisition summary. Mirrors the prototype's
 * Overview (tabs-core.jsx). Spec §17. Tokens only.
 */
export function NatOverviewTab({
  vm,
  official,
}: {
  vm: NationalCorporationViewModel;
  official?: NatOfficialActions | null;
}) {
  const { stats, currency } = vm;
  const debtService = vm.assumedBonds.reduce(
    (acc, b) => acc + Math.round((b.principal * b.couponRate) / 100),
    0
  );
  const totalAssumedFace = vm.assumedBonds.reduce((acc, b) => acc + b.principal, 0);
  const confTone: Tone = stats.investorConfidence < stats.confidenceBaseline ? "error" : "success";
  const effTone: Tone =
    stats.sectorCount === 0 ? "foreground" : stats.soeEfficiencyPenalty > -12 ? "success" : "error";

  return (
    <div className="space-y-4">
      {official?.hasTreasuryAuthority && (
        <>
          <CeoControlPanel ceo={vm.ceo} official={official} />
          <CeoDrawCapPanel
            currentCap={vm.finance.treasuryDrawCap}
            currency={vm.currency}
            official={official}
          />
        </>
      )}

      {/* Charter purpose */}
      <div className="rounded-xl border border-gold/20 bg-card p-4 sm:p-5">
        <SectionLabel>Charter purpose</SectionLabel>
        <p className="mt-1 max-w-3xl text-body-sm leading-relaxed text-foreground/90">
          The National Corporation is held as an{" "}
          <span className="font-semibold text-gold">instrument of the state</span> — its success is
          measured by the public value it delivers to the economy and the citizenry, not by a share
          price or returns to private investors. Profits are remitted to the people&apos;s budget;
          losses on mandated services are absorbed by the treasury.
        </p>
      </div>

      <BudgetFlowStrip
        stats={stats}
        currency={currency}
        debtService={debtService}
        retentionPercent={vm.finance.profitRetentionPercent}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* Treasury & budget */}
        <SectionCard
          title="Treasury & budget"
          sub="Profit remitted to the people's budget"
          accent="success"
          icon={<Landmark className="h-4 w-4" />}
        >
          <StatRow
            label="Operating profit / turn"
            value={`${money(stats.operatingProfitPerTurn, currency)}/turn`}
            tone={stats.operatingProfitPerTurn >= 0 ? "success" : "error"}
          />
          <StatRow
            label="Retained in corp / turn"
            value={`${money(stats.retainedPerTurn, currency)}/turn`}
          />
          <StatRow
            label={stats.remittanceCashCapped ? "Remitted / turn (cash-capped)" : "Remitted / turn"}
            value={`${money(stats.remittedPerTurn, currency)}/turn`}
            tone="success"
          />
          <StatRow
            label="Net to budget / turn"
            value={`${money(Math.max(0, stats.remittedPerTurn - debtService), currency)}/turn`}
            tone="success"
          />
          <StatRow
            label="Mandate subsidy / turn"
            value={`−${money(stats.mandateSubsidyPerTurn, currency)}/turn`}
            tone="error"
          />
          <StatRow
            label="Gross revenue / turn"
            value={`${money(stats.grossRevenuePerTurn, currency)}/turn`}
          />
          <p className="mt-2.5 rounded-lg bg-card-muted px-3 py-2 text-body-xs text-muted">
            Treasury-backed: the National Corporation cannot go bankrupt. Negative balances are
            covered by the national budget, not a default.
          </p>
        </SectionCard>

        {/* Public mandate scorecard */}
        <SectionCard
          title="Public mandate scorecard"
          sub="State metrics this corp uplifts"
          accent="gold"
          icon={<HeartPulse className="h-4 w-4" />}
        >
          {vm.mandateMetrics.length === 0 ? (
            <p className="py-2 text-body-sm text-muted">No public mandates delivered yet.</p>
          ) : (
            vm.mandateMetrics.map((m) => (
              <StatRow
                key={m.label}
                label={m.label}
                value={`${m.sectorCount} sector${m.sectorCount === 1 ? "" : "s"}`}
                tone="gold"
              />
            ))
          )}
          <div className="mt-2 text-right text-body-xs text-muted">
            Composite public-value index{" "}
            <span className="font-semibold text-gold">{stats.publicValueIndex}</span>
          </div>
        </SectionCard>

        {/* Employment & mandates */}
        <SectionCard
          title="Employment & mandates"
          sub="The state as employer of last resort"
          accent="crimson"
          icon={<Users className="h-4 w-4" />}
        >
          <StatRow label="Workers employed" value={stats.citizensServed.toLocaleString()} />
          <StatRow
            label="Jobs guaranteed (floor)"
            value={stats.jobsGuaranteed.toLocaleString()}
            tone="gold"
          />
          <StatRow
            label="Price-controlled sectors"
            value={`${stats.priceControlledSectorCount} of ${stats.sectorCount}`}
          />
          <StatRow
            label="Avg. SOE efficiency"
            value={`${stats.soeEfficiencyPenalty}%`}
            tone={effTone}
          />
        </SectionCard>

        {/* Assumed sovereign debt */}
        <SectionCard
          title="Assumed sovereign debt"
          sub="Bonds of dissolved firms, now state-serviced"
          accent="info"
          icon={<FileText className="h-4 w-4" />}
        >
          <StatRow label="Total assumed face" value={money(totalAssumedFace, currency)} />
          <StatRow
            label="Debt service / turn"
            value={`${money(debtService, currency)}/turn`}
            tone="error"
          />
          <StatRow label="Bond series" value={`${vm.assumedBonds.length} series`} />
        </SectionCard>

        {/* Investor confidence */}
        <SectionCard
          title="Investor confidence"
          sub={`National signal · baseline ${stats.confidenceBaseline}`}
          accent="crimson"
          icon={<Activity className="h-4 w-4" />}
        >
          <div className="flex items-end justify-between">
            <div className={`text-heading-lg font-bold tabular-nums ${TONE[confTone]}`}>
              {Math.round(stats.investorConfidence)}
              <span className="text-body-lg text-muted">/100</span>
            </div>
            {stats.confidenceTrendPerTurn > 0 && (
              <span className="mb-1 text-body-xs text-success">
                +{stats.confidenceTrendPerTurn}/turn
              </span>
            )}
          </div>
          <div className="mt-2">
            <Meter
              value={stats.investorConfidence}
              baseline={stats.confidenceBaseline}
              tone={confTone}
            />
          </div>
          <p className="mt-2.5 text-body-xs text-muted">
            A decaying national signal: it feeds expropriation-risk margins, the sovereign borrowing
            premium, and new-corp founding costs. Fair-value buyouts barely move it; seizures cut
            deep.
          </p>
        </SectionCard>

        {/* How holdings were acquired */}
        <SectionCard
          title="How holdings were acquired"
          sub="Every taking is logged in the register"
          accent="gold"
          icon={<Landmark className="h-4 w-4" />}
        >
          {vm.acquisitions.length === 0 ? (
            <p className="py-2 text-body-sm text-muted">No holdings acquired yet.</p>
          ) : (
            vm.acquisitions.map((a) => (
              <StatRow
                key={a.trigger}
                label={a.label}
                value={`${a.sectorCount} sector${a.sectorCount === 1 ? "" : "s"}`}
              />
            ))
          )}
          <div className="mt-2 text-right text-body-xs text-muted">
            See full register → <span className="text-gold">Register tab</span>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
