"use client";

import { useState, type ReactNode } from "react";
import { EmptyState } from "@/components/ui";
import type { NationalCorporationViewModel } from "@/lib/nationalization/nationalCorporationView";
import type { RegisterRow } from "@/lib/nationalization/registerView";
import { TAKING_KIND_LABEL } from "@/lib/nationalization/labels";
import { getNationalIdentity } from "@/lib/constants/nationalIdentity";
import { concentrationStatus } from "@/lib/nationalization/concentrationStatus";
import { SOCI_DANGER_ZONE } from "@/lib/nationalization/constants";
import { natMoney as money } from "../natMoney";

const LABEL = "text-[10px] font-semibold uppercase tracking-wide text-muted";
const PER_PAGE = 10;
const TIER_TONE: Record<string, string> = {
  fair: "border-success/30 bg-success/10 text-success",
  discounted: "border-warning/30 bg-warning/10 text-warning",
  seizure: "border-error/30 bg-error/10 text-error",
};

function Pill({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${className}`}
    >
      {children}
    </span>
  );
}

/** A signed political-impact figure: green when it moves the country the "good" way. */
function Delta({ v, invert }: { v: number | null; invert?: boolean }) {
  if (v == null) return <span className="text-muted">N/A</span>;
  if (v === 0) return <span className="text-muted">0</span>;
  const good = invert ? v < 0 : v > 0;
  return (
    <span className={good ? "text-success" : "text-error"}>
      {v > 0 ? "+" : ""}
      {v}
    </span>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: "error" }) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-3.5">
      <div className={LABEL}>{label}</div>
      <div
        className={`mt-1 text-xl font-bold tabular-nums ${tone === "error" ? "text-error" : "text-foreground"}`}
      >
        {value}
      </div>
    </div>
  );
}

/** Page navigation for a long list — hidden when everything fits on one page. */
function Pager({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.ceil(total / PER_PAGE);
  if (pages <= 1) return null;
  const btn =
    "rounded-md border border-card-border px-2 py-1 text-muted transition-colors hover:bg-card-elevated disabled:cursor-default disabled:opacity-40";
  return (
    <div className="flex items-center justify-between gap-2 border-t border-card-border px-4 py-2.5 text-[12px]">
      <span className="text-muted tabular-nums">
        {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, total)} of {total}
      </span>
      <div className="flex items-center gap-2">
        <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Prev
        </button>
        <span className="text-muted tabular-nums">
          {page} / {pages}
        </span>
        <button
          type="button"
          className={btn}
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

/** Confidence meter — a 0–100 bar with the heal-target baseline marked. */
function Meter({ value, baseline }: { value: number; baseline: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-card-muted">
      <div className="h-full rounded-full bg-error/70" style={{ width: `${pct}%` }} />
      <div
        className="absolute top-0 h-full w-px bg-foreground/50"
        style={{ left: `${Math.max(0, Math.min(100, baseline))}%` }}
      />
    </div>
  );
}

export function NatRegisterTab({ vm }: { vm: NationalCorporationViewModel }) {
  const [open, setOpen] = useState<string | null>(null);
  // Each long list paginates independently (10/page); pagers hide under one page.
  const [regPage, setRegPage] = useState(1);
  const [bondPage, setBondPage] = useState(1);
  const [polPage, setPolPage] = useState(1);
  const { rows, totals, standing } = vm.register;
  const regRows = rows.slice((regPage - 1) * PER_PAGE, regPage * PER_PAGE);
  const polRows = rows.slice((polPage - 1) * PER_PAGE, polPage * PER_PAGE);
  const bondRows = vm.assumedBonds.slice((bondPage - 1) * PER_PAGE, bondPage * PER_PAGE);
  const conf = Math.round(vm.stats.investorConfidence);
  const baseline = vm.stats.confidenceBaseline;
  const trend = vm.stats.confidenceTrendPerTurn;
  const soci = Math.round(vm.stateOwnershipConcentration);
  const sociStatus = concentrationStatus(vm.stateOwnershipConcentration);
  const sociTone =
    sociStatus.tier === "high"
      ? "text-error"
      : sociStatus.tier === "elevated"
        ? "text-warning"
        : "text-foreground";
  const identity = getNationalIdentity(vm.countryId);
  const ccy = vm.currency;

  // Net political movement across every recorded taking (drives the standing tiles).
  const net = rows.reduce(
    (a, r) => ({
      approval: a.approval + (r.approvalDelta ?? 0),
      legitimacy: a.legitimacy + (r.legitimacyDelta ?? 0),
    }),
    { approval: 0, legitimacy: 0 }
  );

  return (
    <div className="space-y-4">
      {/* ── Summary stat strip ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Firms absorbed" value={String(totals.firmsAbsorbed)} />
        <StatTile label="Compensation paid" value={money(totals.compensationLocal, ccy)} />
        <StatTile label="Debt assumed" value={money(totals.debtLocal, ccy)} tone="error" />
        <StatTile
          label="Shareholders settled"
          value={totals.shareholdersSettled.toLocaleString("en-US")}
        />
      </div>

      {/* ── Acquisition / state-ownership register ───────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-card-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-card-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md border border-gold/40 bg-gold/10 text-body-sm font-bold text-gold">
              {identity.glyph}
            </span>
            <h2 className="text-sm font-semibold text-foreground">State ownership register</h2>
          </div>
          <span className="text-[11px] text-muted">{identity.registry}</span>
        </div>

        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No state-ownership actions"
              description="No nationalizations or privatizations have been recorded for this country."
            />
          </div>
        ) : (
          <>
            <div className="hidden grid-cols-12 gap-2 border-b border-card-border bg-card-muted px-4 py-2 lg:grid">
              <div className={`col-span-3 ${LABEL}`}>Firm</div>
              <div className={`col-span-2 ${LABEL}`}>Trigger</div>
              <div className={`col-span-2 ${LABEL}`}>Method</div>
              <div className={`col-span-2 text-right ${LABEL}`}>Compensation</div>
              <div className={`col-span-2 text-right ${LABEL}`}>Debt assumed</div>
              <div className="col-span-1" />
            </div>
            {regRows.map((r) => (
              <RegisterRowView
                key={r.id}
                r={r}
                ccy={ccy}
                isOpen={open === r.id}
                onToggle={() => setOpen(open === r.id ? null : r.id)}
              />
            ))}
            <Pager page={regPage} total={rows.length} onPage={setRegPage} />
          </>
        )}
      </div>

      {/* ── Assumed bonds ────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-card-border bg-card">
        <div className="flex items-center justify-between border-b border-card-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Assumed bonds</h2>
          <span className="text-[11px] text-muted">state services coupons · no default</span>
        </div>
        {vm.assumedBonds.length === 0 ? (
          <p className="px-4 py-3 text-body-sm text-muted">No bonds assumed.</p>
        ) : (
          <>
            <div className="hidden grid-cols-12 gap-2 border-b border-card-border bg-card-muted px-4 py-2 sm:grid">
              <div className={`col-span-4 ${LABEL}`}>Original issuer</div>
              <div className={`col-span-3 text-right ${LABEL}`}>Face value</div>
              <div className={`col-span-2 text-right ${LABEL}`}>Coupon</div>
              <div className={`col-span-2 text-right ${LABEL}`}>Matures</div>
              <div className={`col-span-1 text-right ${LABEL}`}>Status</div>
            </div>
            {bondRows.map((b) => (
              <div
                key={b.id}
                className="grid grid-cols-2 items-center gap-2 border-b border-card-border px-4 py-2.5 last:border-0 sm:grid-cols-12"
              >
                <div className="col-span-2 text-[13px] text-foreground sm:col-span-4">
                  {b.issuer ?? "State enterprise"}
                </div>
                <div className="text-right text-[13px] font-semibold tabular-nums text-foreground sm:col-span-3">
                  {money(b.principal, b.currencyCode)}
                </div>
                <div className="text-right text-[13px] tabular-nums text-muted sm:col-span-2">
                  {b.couponRate.toFixed(1)}%
                </div>
                <div className="hidden text-right text-[12px] tabular-nums text-muted sm:col-span-2 sm:block">
                  {b.maturityTurn != null ? `turn ${b.maturityTurn}` : "—"}
                </div>
                <div className="col-span-2 flex justify-end sm:col-span-1">
                  <Pill
                    className={
                      b.status === "Performing"
                        ? "border-success/30 bg-success/10 text-success"
                        : "border-warning/30 bg-warning/10 text-warning"
                    }
                  >
                    {b.status}
                  </Pill>
                </div>
              </div>
            ))}
            <Pager page={bondPage} total={vm.assumedBonds.length} onPage={setBondPage} />
          </>
        )}
      </div>

      {/* ── Political ledger ─────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-card-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-card-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Political ledger</h2>
          <span className="text-[11px] text-muted">
            every taking moves approval, legitimacy &amp; unrest
          </span>
        </div>

        {/* ideology gate */}
        <div className="flex flex-col gap-3 border-b border-card-border bg-card-muted p-4 sm:flex-row sm:items-center">
          <div>
            <div className={LABEL}>Governing ideology</div>
            <div className="text-sm font-semibold text-gold">{standing.ideologyStance} bloc</div>
          </div>
          <p className="flex-1 text-[12px] leading-snug text-muted">{standing.ideologyNote}</p>
          <div className="flex gap-2">
            <div className="rounded-lg border border-success/30 bg-success/5 px-3 py-1.5 text-center">
              <div className={`whitespace-nowrap ${LABEL}`}>Nationalize</div>
              <div className="text-[13px] font-bold text-success">
                {standing.nationalizeCapital}
              </div>
            </div>
            <div className="rounded-lg border border-error/30 bg-error/5 px-3 py-1.5 text-center">
              <div className={`whitespace-nowrap ${LABEL}`}>Privatize</div>
              <div className="text-[13px] font-bold text-error">{standing.privatizeCapital}</div>
            </div>
          </div>
        </div>

        {/* current standing */}
        <div className="grid grid-cols-3 divide-x divide-card-border border-b border-card-border">
          <StandTile label="Govt approval" value={standing.approval} delta={net.approval} />
          <StandTile label="Legitimacy" value={standing.legitimacy} delta={net.legitimacy} />
          <StandTile label="Unrest" value={null} delta={null} note="future system" />
        </div>

        {/* per-taking impact */}
        {rows.length > 0 && (
          <>
            <div className="hidden grid-cols-12 gap-2 bg-card-muted px-4 py-2 sm:grid">
              <div className={`col-span-4 ${LABEL}`}>Taking</div>
              <div className={`col-span-2 text-right ${LABEL}`}>Approval</div>
              <div className={`col-span-2 text-right ${LABEL}`}>Legitimacy</div>
              <div className={`col-span-2 text-right ${LABEL}`}>Unrest</div>
              <div className={`col-span-2 text-right ${LABEL}`}>Confidence</div>
            </div>
            {polRows.map((r) => (
              <div
                key={r.id}
                className="grid grid-cols-2 items-center gap-2 border-b border-card-border px-4 py-2.5 last:border-0 sm:grid-cols-12"
              >
                <div className="col-span-2 sm:col-span-4">
                  <div className="text-[13px] font-medium text-foreground">{r.firm}</div>
                  <div className="text-[11px] text-muted">
                    {r.tierLabel ? `${r.tierLabel} · ` : ""}
                    {r.triggerShort}
                  </div>
                </div>
                <div className="text-right text-[13px] font-semibold tabular-nums sm:col-span-2">
                  <Delta v={r.approvalDelta} />
                </div>
                <div className="text-right text-[13px] font-semibold tabular-nums sm:col-span-2">
                  <Delta v={r.legitimacyDelta} />
                </div>
                <div className="text-right text-[13px] font-semibold tabular-nums sm:col-span-2">
                  <Delta v={r.unrestDelta} invert />
                </div>
                <div className="text-right text-[13px] font-semibold tabular-nums sm:col-span-2">
                  <Delta v={r.confidenceDelta} />
                </div>
              </div>
            ))}
            <Pager page={polPage} total={rows.length} onPage={setPolPage} />
          </>
        )}
      </div>

      {/* ── State ownership concentration (SOCI) ─────────────────────────── */}
      <div className="rounded-xl border border-card-border bg-card p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
          <div className="lg:w-72 lg:shrink-0">
            <div className={LABEL}>State ownership concentration</div>
            <div className="mt-1 flex items-end gap-2">
              <span className={`text-5xl font-bold tabular-nums ${sociTone}`}>{soci}</span>
              <span className="mb-1.5 text-sm text-muted">%</span>
              <span className="mb-2 ml-1 text-xs text-muted">{sociStatus.label}</span>
            </div>
            <div className="mt-3">
              <Meter value={soci} baseline={SOCI_DANGER_ZONE} />
            </div>
            <div className="mt-1.5 flex justify-between text-[10px] text-muted">
              <span>0 · private</span>
              <span>danger zone {SOCI_DANGER_ZONE}</span>
              <span>100</span>
            </div>
          </div>

          <div className="hidden w-px self-stretch bg-card-border lg:block" />

          <div className="flex-1">
            <p className="text-[13px] leading-snug text-muted">{sociStatus.note}</p>
            <p className="mt-3 text-[11px] text-muted">
              Concentration is the state&apos;s share of national corporate revenue. It drives the
              escalating cost of each taking and falls only as the private economy grows or assets
              are privatized.
            </p>
          </div>
        </div>
      </div>

      {/* ── Investor confidence index ────────────────────────────────────── */}
      <div className="rounded-xl border border-card-border bg-card p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
          <div className="lg:w-72 lg:shrink-0">
            <div className={LABEL}>Investor confidence index</div>
            <div className="mt-1 flex items-end gap-2">
              <span className="text-5xl font-bold tabular-nums text-error">{conf}</span>
              <span className="mb-1.5 text-sm text-muted">/ 100</span>
              {trend > 0 && (
                <span className="mb-2 ml-1 text-xs text-success">+{trend.toFixed(1)}/turn</span>
              )}
            </div>
            <div className="mt-3">
              <Meter value={conf} baseline={baseline} />
            </div>
            <div className="mt-1.5 flex justify-between text-[10px] text-muted">
              <span>0 · expropriation fear</span>
              <span>baseline {baseline}</span>
              <span>100</span>
            </div>
          </div>

          <div className="hidden w-px self-stretch bg-card-border lg:block" />

          <div className="flex-1">
            <div className="mb-2 text-[13px] text-muted">
              One decaying signal feeds three live systems:
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {vm.confidenceFeeds.map((e) => (
                <div
                  key={e.label}
                  className="rounded-lg border border-card-border bg-card-muted p-3"
                >
                  <div className="text-lg font-bold tabular-nums text-error">{e.value}</div>
                  <div className="mt-0.5 text-[12px] font-semibold text-foreground">{e.label}</div>
                  <div className="mt-1 text-[11px] leading-snug text-muted">{e.desc}</div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-muted">
              Confidence heals toward baseline each turn. Fair-value buyouts barely move it;
              outright seizures cut deep. That is the systemic deterrent against overusing
              nationalization.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One expandable acquisition-register row. */
function RegisterRowView({
  r,
  ccy,
  isOpen,
  onToggle,
}: {
  r: RegisterRow;
  ccy: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-card-border last:border-0">
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full grid-cols-2 items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-card-elevated lg:grid-cols-12"
      >
        <div className="col-span-2 lg:col-span-3">
          <div className="text-[13px] font-semibold text-foreground">{r.firm}</div>
          <div className="text-[11px] text-muted">
            {TAKING_KIND_LABEL[r.kind]} · {r.sectorLabel} · turn {r.turn}
          </div>
        </div>
        <div className="lg:col-span-2">
          <Pill className="border-card-border bg-card-muted text-muted">{r.triggerShort}</Pill>
        </div>
        <div className="flex items-center gap-1.5 lg:col-span-2">
          {r.tierKey && <Pill className={TIER_TONE[r.tierKey]}>{r.tierLabel}</Pill>}
          {r.pathLabel && (
            <span className="hidden text-[10px] text-muted sm:inline">{r.pathLabel}</span>
          )}
        </div>
        <div className="text-right text-[13px] font-bold tabular-nums text-foreground lg:col-span-2">
          {r.compensationLocal == null ? "—" : money(r.compensationLocal, ccy)}
        </div>
        <div className="hidden text-right text-[13px] font-bold tabular-nums text-error lg:col-span-2 lg:block">
          {r.debtLocal == null ? "—" : money(r.debtLocal, ccy)}
        </div>
        <div className="hidden justify-end lg:col-span-1 lg:flex">
          <svg
            className={`h-4 w-4 text-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      </button>
      {isOpen && (
        <div className="grid gap-3 bg-card-muted px-4 py-3 sm:grid-cols-3">
          <DetailCell label="Trigger detail" value={r.triggerDetail} />
          <DetailCell
            label="Authority path"
            value={[r.pathLabel, r.tierLabel].filter(Boolean).join(" · ") || "—"}
          />
          <DetailCell
            label="Shareholders settled"
            value={
              r.shareholdersSettled == null
                ? "Not recorded"
                : `${r.shareholdersSettled.toLocaleString("en-US")} · pro-rata, own currency`
            }
          />
          {r.foreignOwnerCountryId && (
            <DetailCell label="Foreign owner" value={r.foreignOwnerCountryId} />
          )}
        </div>
      )}
    </div>
  );
}

function StandTile({
  label,
  value,
  delta,
  note,
}: {
  label: string;
  value: number | null;
  delta: number | null;
  note?: string;
}) {
  const good = (delta ?? 0) > 0;
  return (
    <div className="p-3.5">
      <div className={LABEL}>{label}</div>
      <div className="mt-1 flex items-end gap-2">
        <span className="text-2xl font-bold tabular-nums text-foreground">
          {value == null ? "N/A" : value}
        </span>
        {delta != null && delta !== 0 && (
          <span className={`mb-1 text-[11px] tabular-nums ${good ? "text-success" : "text-error"}`}>
            net {delta > 0 ? "+" : ""}
            {Math.round(delta)} from takings
          </span>
        )}
        {note && <span className="mb-1 text-[11px] text-muted">{note}</span>}
      </div>
    </div>
  );
}

function DetailCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className={LABEL}>{label}</div>
      <div className="mt-0.5 text-[12px] text-foreground">{value}</div>
    </div>
  );
}
