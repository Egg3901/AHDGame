"use client";

import { useState } from "react";
import type { CorporationType } from "@/lib/constants/corporations";
import { facilityPlural } from "@/lib/constants/facilityVocabulary";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import { Button, SectionLabel, Slider } from "@/components/ui";
import type {
  NationalCorporationViewModel,
  NatViewSector,
} from "@/lib/nationalization/nationalCorporationView";
import {
  MIN_PROFIT_REMITTANCE_PERCENT,
  MAX_PROFIT_RETENTION_PERCENT,
  NATCORP_RD_FULL_FUND_REVENUE_FRACTION,
} from "@/lib/nationalization/constants";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import {
  MIN_GROWTH_RATE,
  MAX_GROWTH_RATE,
  RD_INNOVATION_INTERVAL,
  RD_INNOVATION_SCORE_THRESHOLD,
  RD_REGULAR_BOOST_MIN,
  RD_REGULAR_BOOST_MAX,
} from "@/lib/constants/corporations";
import { getPolicyEffectInfo } from "@/lib/utils/productionPolicy";
import { natMoney } from "../natMoney";
import Link from "next/link";
import {
  BuildQueueBadge,
  CAPACITY_UNIT_LABEL,
  FillChip,
  MothballedPill,
  formatUnits,
  sectorBuildUrl,
} from "@/components/corporation/plantsPresentation";

type Feedback = { type: "success" | "error"; message: string } | null;
type PostFn = (url: string, body: Record<string, unknown>, ok: string) => Promise<boolean>;

const GROWTH_STEP = 0.5;
const PRODUCTION_MIN = -25;
const PRODUCTION_MAX = 25;

/**
 * CEO operations (spec P6g): run the enterprise within the ministry's policy —
 * set the profit-retention split, draw from the treasury (≤ the minister's cap),
 * fund corp-wide modernization, and tune each sector's capacity / production.
 * Every control shows its current setting and what it does. Tokens only.
 */
export function CeoOperationsPanel({
  vm,
  corpId,
  onRefresh,
}: {
  vm: NationalCorporationViewModel;
  corpId: string;
  onRefresh: () => void;
}) {
  const code = vm.countryId.toLowerCase();
  const currency = vm.currency;
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [retention, setRetention] = useState(String(vm.finance.profitRetentionPercent));
  const [drawAmount, setDrawAmount] = useState("");
  const [rd, setRd] = useState(
    vm.finance.rdBudgetPerTurn ? String(vm.finance.rdBudgetPerTurn) : ""
  );
  const [confirmResign, setConfirmResign] = useState(false);

  async function post(url: string, body: Record<string, unknown>, ok: string) {
    if (busy) return false;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setFeedback({ type: "error", message: json.error ?? "Action failed." });
        return false;
      }
      setFeedback({ type: "success", message: ok });
      onRefresh();
      return true;
    } catch {
      setFeedback({ type: "error", message: "Network error." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const sectors = vm.holdingsByRegion.flatMap((r) => r.sectors);
  const plantsMode = vm.plantsMode === true;

  // Holding counts per sector type, for the bulk-by-type section.
  const sectorTypeCounts = sectors.reduce<Record<string, number>>((acc, s) => {
    acc[s.sectorType] = (acc[s.sectorType] ?? 0) + 1;
    return acc;
  }, {});

  // Preview the projected per-turn growth cost of a bulk growth target without
  // persisting (does not refresh, unlike post()).
  async function previewBulkGrowth(sectorType: string | null, target: number) {
    const res = await fetch(`/api/corporations/${corpId}/sectors/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        countryId: vm.countryId,
        ...(sectorType ? { sectorType } : {}),
        targetGrowthRate: target,
        preview: true,
      }),
    });
    return res.ok ? res.json() : null;
  }

  // R&D benefit readout: rdScore drives the innovation chance each cycle.
  const rdInnovationChance = Math.min(
    100,
    Math.round((vm.finance.rdScore / RD_INNOVATION_SCORE_THRESHOLD) * 100)
  );

  return (
    <div className="space-y-6">
      {/* Financing */}
      <div className="rounded-xl border border-gold/30 bg-gold/5 p-5">
        <SectionLabel>Financing</SectionLabel>
        <p className="mt-1 text-body-xs text-muted">
          Working capital on hand:{" "}
          <span className="font-semibold text-foreground">
            {natMoney(vm.finance.liquidCapital, currency)}
          </span>
          . This is the ceiling on what the CEO can invest below.
        </p>

        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          {/* Profit split — slider caps retention at the policy maximum so the
              minimum remittance can never be undercut from the UI. */}
          <div>
            <div className="text-body-sm font-medium text-foreground">Profit retained / turn</div>
            <p className="text-body-xs text-muted">
              Share of operating profit kept in the corporation each turn; the rest remits to the
              national budget. At least {MIN_PROFIT_REMITTANCE_PERCENT}% always remits.
            </p>
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between text-body-xs">
                <span className="font-semibold text-foreground">Retain {Number(retention)}%</span>
                <span className="text-muted">Remit {100 - Number(retention)}%</span>
              </div>
              <Slider
                variant="primary"
                min={0}
                max={MAX_PROFIT_RETENTION_PERCENT}
                step={1}
                value={Number(retention)}
                onChange={(e) => setRetention(e.target.value)}
                disabled={busy}
                aria-label="Profit retained per turn"
                className="w-full"
              />
              <Button
                onClick={() =>
                  post(
                    `/api/country/${code}/national-corporation/${corpId}/profit-split`,
                    { retentionPercent: Number(retention) || 0 },
                    "Profit split updated."
                  )
                }
                disabled={busy}
              >
                Set
              </Button>
            </div>
          </div>

          {/* Treasury draw */}
          <div>
            <div className="text-body-sm font-medium text-foreground">Draw from the treasury</div>
            <p className="text-body-xs text-muted">
              Pull working capital from the national budget into the corporation, up to the treasury
              minister&apos;s per-turn cap. A draw may run the reserve into debt.
            </p>
            <p className="mt-1 text-body-xs text-muted">
              Per-turn cap:{" "}
              <span className="font-semibold text-foreground">
                {natMoney(vm.finance.treasuryDrawCap, currency)}
              </span>
              .
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={drawAmount}
                placeholder="amount"
                onChange={(e) => setDrawAmount(e.target.value)}
                disabled={busy}
                className="w-32 rounded border border-card-border bg-card-elevated px-2 py-1 text-body-sm"
              />
              <Button
                onClick={async () => {
                  const ok = await post(
                    `/api/country/${code}/national-corporation/${corpId}/treasury-draw`,
                    { amount: Number(drawAmount) || 0 },
                    "Capital drawn from the treasury."
                  );
                  if (ok) setDrawAmount("");
                }}
                disabled={busy || !(Number(drawAmount) > 0)}
              >
                Draw
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Modernization — corp-wide R&D, funded per turn */}
      <div className="rounded-xl border border-card-border bg-card p-5">
        <SectionLabel>Modernization</SectionLabel>
        <p className="mt-1 text-body-xs text-muted">
          Modernization is a momentum the corporation must keep funding. Each turn it spends up to
          this budget, capped at its full-funding cost, and its score climbs toward what the funding
          sustains, then bleeds to zero over {TURNS_PER_YEAR} turns if you stop. What matters is
          your spend relative to the corporation&apos;s size, not the raw amount. Set 0 to stop.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-body-xs text-muted">
          <div>
            R&amp;D budget:{" "}
            <span className="font-semibold text-foreground">
              {natMoney(vm.finance.rdBudgetPerTurn, currency)}/turn
            </span>
          </div>
          <div>
            Modernization:{" "}
            <span className="font-semibold text-foreground">
              {vm.finance.rdScore.toLocaleString("en-US")}/
              {RD_INNOVATION_SCORE_THRESHOLD.toLocaleString("en-US")}
            </span>{" "}
            → <span className="font-semibold text-foreground">{rdInnovationChance}%</span>{" "}
            breakthrough
          </div>
        </div>
        <div className="mt-2 space-y-1 rounded-lg border border-card-border bg-card-muted/40 px-3 py-2 text-body-xs text-muted">
          <p>
            <span className="font-semibold text-foreground">What it does:</span> every{" "}
            {RD_INNOVATION_INTERVAL} turns, a{" "}
            <span className="font-semibold text-foreground">{rdInnovationChance}%</span> chance of a
            permanent{" "}
            <span className="font-semibold text-foreground">
              +{Math.round(RD_REGULAR_BOOST_MIN * 100)}-{Math.round(RD_REGULAR_BOOST_MAX * 100)}%
            </span>{" "}
            revenue boost to one of its sectors.
          </p>
          <p>
            <span className="font-semibold text-foreground">Sustaining it:</span> your current
            budget settles around{" "}
            <span className="font-semibold text-foreground">
              {vm.finance.rdSustainChancePercent}%
            </span>
            . Full modernization needs{" "}
            <span className="font-semibold text-foreground">
              {natMoney(vm.finance.rdFullFundBudget, currency)}/turn
            </span>{" "}
            ({Math.round(NATCORP_RD_FULL_FUND_REVENUE_FRACTION * 100)}% of the corporation&apos;s{" "}
            <span className="font-semibold text-foreground">
              {natMoney(vm.stats.grossRevenuePerTurn, currency)}/turn
            </span>{" "}
            gross revenue, not the remittance above).
          </p>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={rd}
            placeholder="budget / turn"
            onChange={(e) => setRd(e.target.value)}
            disabled={busy}
            className="w-36 rounded border border-card-border bg-card-elevated px-2 py-1 text-body-sm"
          />
          <Button
            onClick={() =>
              post(
                `/api/country/${code}/national-corporation/${corpId}/invest`,
                { kind: "rd", amount: Number(rd) || 0 },
                "R&D budget updated."
              )
            }
            disabled={busy || rd.trim() === "" || Number.isNaN(Number(rd)) || Number(rd) < 0}
          >
            Set
          </Button>
        </div>
      </div>

      {/* Per-sector operations */}
      <div className="rounded-xl border border-card-border bg-card p-5">
        <SectionLabel>Sector operations</SectionLabel>
        <p className="mt-1 text-body-xs text-muted">
          {plantsMode
            ? "Tune each sector's production level, funded from the corporation's capital. Capacity is bought site by site here, not set as a growth target."
            : "Tune each sector's growth target and production level, funded from the corporation's capital."}
        </p>
        {sectors.length === 0 ? (
          <p className="mt-3 text-body-sm text-muted">No sectors held yet.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {/* Bulk by type — set many holdings of a sector type (or all) at once. */}
            <div className="space-y-3 rounded-lg border border-gold/30 bg-gold/5 p-3">
              <div className="text-body-sm font-semibold text-foreground">Bulk by type</div>
              <p className="text-body-xs text-muted">
                {plantsMode
                  ? "Set output policy and pricing across a sector type at once."
                  : "Set growth, output policy, and/or pricing across a sector type at once. Growth shows its projected per-turn cost before you confirm."}
              </p>
              {Object.entries(sectorTypeCounts).map(([type, count]) => (
                <NatBulkGroupCard
                  key={type}
                  corpId={corpId}
                  countryId={vm.countryId}
                  currency={currency}
                  sectorType={type}
                  label={type}
                  sectorCount={count}
                  disabled={busy}
                  post={post}
                  previewGrowth={previewBulkGrowth}
                  plantsMode={plantsMode}
                />
              ))}
              <NatBulkGroupCard
                corpId={corpId}
                countryId={vm.countryId}
                currency={currency}
                sectorType={null}
                label="Corporate-Wide"
                sectorCount={sectors.length}
                disabled={busy}
                post={post}
                previewGrowth={previewBulkGrowth}
                plantsMode={plantsMode}
              />
            </div>

            {sectors.map((s) => (
              <SectorOpsRow
                key={s.sectorId}
                sector={s}
                corpId={corpId}
                currency={currency}
                disabled={busy}
                onPost={post}
                plantsMode={plantsMode}
              />
            ))}
          </div>
        )}
      </div>

      {/* Resign — the seated CEO can vacate the seat themselves, mirroring the
          treasury's remove-ceo. The State appoints a replacement afterward. */}
      <div className="rounded-xl border border-error/30 bg-error/5 p-5">
        <SectionLabel>Step down</SectionLabel>
        <p className="mt-1 text-body-xs text-muted">
          Resign as CEO of {vm.name}. The seat is vacated immediately and the State appoints a
          replacement. You cannot undo this yourself.
        </p>
        <div className="mt-3">
          {confirmResign ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-body-sm text-foreground">Resign for good?</span>
              <Button
                variant="destructive"
                onClick={async () => {
                  const ok = await post(
                    `/api/country/${code}/national-corporation/${corpId}/resign-ceo`,
                    {},
                    "You have resigned as CEO."
                  );
                  if (ok) setConfirmResign(false);
                }}
                disabled={busy}
              >
                {busy ? "Working…" : "Confirm resignation"}
              </Button>
              <button
                type="button"
                onClick={() => setConfirmResign(false)}
                disabled={busy}
                className="rounded border border-card-border px-3 py-1 text-body-xs text-muted hover:text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          ) : (
            <Button variant="destructive" onClick={() => setConfirmResign(true)} disabled={busy}>
              Resign as CEO
            </Button>
          )}
        </div>
      </div>

      {feedback && (
        <p
          className={`text-body-sm ${feedback.type === "success" ? "text-success" : "text-error"}`}
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}

const POSTURE_STEPS = [-0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2] as const;

function postureLabel(p: number): string {
  if (p === 0) return "Market";
  return `${p > 0 ? "+" : ""}${Math.round(p * 100)}%`;
}

/**
 * Bulk growth + output policy + pricing for one group (or Corporate-Wide).
 * Output policy and pricing apply directly; growth previews then confirms.
 */
function NatBulkGroupCard({
  corpId,
  countryId,
  currency,
  sectorType,
  label,
  sectorCount,
  disabled,
  post,
  previewGrowth,
  plantsMode = false,
}: {
  corpId: string;
  countryId: string;
  currency: string;
  sectorType: string | null;
  label: string;
  sectorCount: number;
  disabled: boolean;
  post: PostFn;
  plantsMode?: boolean;
  previewGrowth: (
    sectorType: string | null,
    target: number
  ) => Promise<{
    matchedCount?: number;
    growth?: {
      projectedTotalCostPerTurn: number;
      currentTotalCostPerTurn: number;
      costDeltaPerTurn: number;
    };
  } | null>;
}) {
  const [growth, setGrowth] = useState(0);
  const [production, setProduction] = useState(0);
  const [preview, setPreview] = useState<null | {
    target: number;
    matchedCount: number;
    projected: number;
    current: number;
    delta: number;
  }>(null);

  async function startPreview() {
    const data = await previewGrowth(sectorType, growth);
    if (data?.growth) {
      setPreview({
        target: growth,
        matchedCount: data.matchedCount ?? 0,
        projected: data.growth.projectedTotalCostPerTurn,
        current: data.growth.currentTotalCostPerTurn,
        delta: data.growth.costDeltaPerTurn,
      });
    }
  }

  async function confirm() {
    if (!preview) return;
    const ok = await post(
      `/api/corporations/${corpId}/sectors/bulk`,
      { countryId, ...(sectorType ? { sectorType } : {}), targetGrowthRate: preview.target },
      "Growth set across holdings."
    );
    if (ok) setPreview(null);
  }

  return (
    <div className="space-y-3 rounded-lg border border-card-border bg-card-elevated/40 p-3">
      <div className="flex items-center gap-2 text-body-sm font-semibold capitalize text-foreground">
        {label}
        <span className="text-body-xs font-normal text-muted">
          {sectorCount} sector{sectorCount === 1 ? "" : "s"}
        </span>
      </div>

      {/* Growth (preview + confirm).
          Hidden under plants for the same reason as the corporate CEO panel: a
          bulk growth target no longer builds capacity, so offering the control
          would be offering a lever wired to nothing. */}
      <div className={plantsMode ? "hidden" : undefined}>
        <div className="text-body-xs font-medium text-foreground">Growth target</div>
        <div className="mt-1 flex items-center gap-3">
          <Slider
            variant="success"
            min={MIN_GROWTH_RATE}
            max={MAX_GROWTH_RATE}
            step={0.5}
            value={growth}
            onChange={(e) => setGrowth(Number(e.target.value))}
            disabled={disabled || preview !== null}
            aria-label={`Bulk growth target ${label}`}
            className="flex-1"
          />
          <span className="w-14 text-right text-body-sm font-semibold tabular-nums text-foreground">
            {growth.toFixed(1)}%
          </span>
          <Button onClick={startPreview} disabled={disabled || preview !== null}>
            Set growth
          </Button>
        </div>
        {preview && (
          <div className="mt-2 rounded-lg border border-gold/40 bg-gold/10 p-2 text-body-xs">
            <p className="text-foreground">
              Set growth to {preview.target}% across {preview.matchedCount} holdings. Projected cost
              ~{natMoney(preview.projected, currency)}/day (currently ~
              {natMoney(preview.current, currency)}/day, {preview.delta >= 0 ? "+" : ""}
              {natMoney(preview.delta, currency)}). Projected once ramped.
            </p>
            <div className="mt-2 flex gap-2">
              <Button onClick={confirm} disabled={disabled}>
                Confirm
              </Button>
              <button
                onClick={() => setPreview(null)}
                className="rounded border border-card-border px-3 py-1 text-body-xs text-muted hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Production (direct apply) */}
      <div>
        <div className="text-body-xs font-medium text-foreground">Production policy</div>
        <div className="mt-1 flex items-center gap-3">
          <Slider
            variant={production >= 0 ? "success" : "error"}
            min={PRODUCTION_MIN}
            max={PRODUCTION_MAX}
            step={1}
            value={production}
            onChange={(e) => setProduction(Number(e.target.value))}
            disabled={disabled}
            aria-label={`Bulk production ${label}`}
            className="flex-1"
          />
          <span className="w-12 text-right text-body-sm font-semibold tabular-nums text-foreground">
            {production >= 0 ? "+" : ""}
            {production}%
          </span>
          <Button
            onClick={() =>
              post(
                `/api/corporations/${corpId}/sectors/bulk`,
                { countryId, ...(sectorType ? { sectorType } : {}), productionPolicy: production },
                "Production set across holdings."
              )
            }
            disabled={disabled}
          >
            Set production
          </Button>
        </div>
      </div>

      {/* Pricing posture (direct apply; requires market clearing) */}
      <div>
        <div className="text-body-xs font-medium text-foreground">Pricing posture</div>
        <p className="mt-1 text-body-xs text-muted">
          Posted price vs market for every holding in this group.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {POSTURE_STEPS.map((p) => (
            <button
              key={p}
              type="button"
              disabled={disabled}
              onClick={() =>
                void post(
                  `/api/corporations/${corpId}/sectors/bulk`,
                  {
                    countryId,
                    ...(sectorType ? { sectorType } : {}),
                    pricingPosture: p,
                  },
                  `Pricing set to ${postureLabel(p)} across holdings.`
                )
              }
              className="rounded-lg border border-card-border bg-background px-3 py-1.5 text-body-xs font-medium tabular-nums text-foreground transition-colors hover:bg-card disabled:opacity-50"
            >
              {postureLabel(p)}
            </button>
          ))}
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              void post(
                `/api/corporations/${corpId}/sectors/bulk`,
                {
                  countryId,
                  ...(sectorType ? { sectorType } : {}),
                  pricingPosture: null,
                },
                "Pricing set to Auto across holdings."
              )
            }
            className="rounded-lg border border-card-border bg-background px-3 py-1.5 text-body-xs font-medium text-foreground transition-colors hover:bg-card disabled:opacity-50"
          >
            Auto
          </button>
        </div>
      </div>
    </div>
  );
}

function SectorOpsRow({
  sector,
  corpId,
  currency,
  disabled,
  onPost,
  plantsMode = false,
}: {
  sector: NatViewSector;
  corpId: string;
  currency: string;
  disabled: boolean;
  onPost: PostFn;
  /** Plants tier: the growth slider becomes a build summary. */
  plantsMode?: boolean;
}) {
  const [growth, setGrowth] = useState(sector.targetGrowthRate);
  const [production, setProduction] = useState(sector.productionPolicy);
  const [strategy, setStrategy] = useState(sector.strategyId);
  const effects = getPolicyEffectInfo(production);

  // Suggestion #91: the production method drives what a sector consumes and
  // produces (and, under plants, its per-unit yield), but this panel never
  // exposed it — so a state-owned sector ran forever on its seeded method while
  // every private corp could retool. The command already accepted the national
  // CEO; only the control was missing.
  const strategies = SECTOR_STRATEGIES[sector.sectorType as CorporationType] ?? [];
  const retooling = sector.transitionFromStrategyId != null;

  return (
    <div className="space-y-4 rounded-lg border border-card-border bg-card-elevated/40 p-4">
      {/* Header + current stats */}
      <div>
        <div className="text-body-sm font-semibold capitalize text-foreground">
          {sector.sectorType} · {sector.stateName}
          {plantsMode && sector.mothballed && (
            <MothballedPill className="ml-2" sectorType={sector.sectorType as CorporationType} />
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-body-xs text-muted">
          <span>
            Revenue{" "}
            <span className="font-medium text-foreground">
              {natMoney(sector.revenue, currency)}/turn
            </span>
          </span>
          <span>
            Workers{" "}
            <span className="font-medium text-foreground">
              {sector.workers.toLocaleString("en-US")}
            </span>
          </span>
          <span>
            Margin{" "}
            <span className="font-medium text-foreground">{sector.profitMargin.toFixed(1)}%</span>
          </span>
          {plantsMode ? (
            <span className="flex items-center gap-1.5">
              Fill <FillChip fill={sector.fillRate} band={sector.fillRateBand} />
            </span>
          ) : (
            <span>
              Growth{" "}
              <span className="font-medium text-foreground">
                {sector.currentGrowthRate.toFixed(1)}%
              </span>{" "}
              → target {sector.targetGrowthRate.toFixed(1)}%
            </span>
          )}
          <span>
            Production{" "}
            <span className="font-medium text-foreground">
              {sector.productionPolicyLevel >= 0 ? "+" : ""}
              {sector.productionPolicyLevel}%
            </span>{" "}
            → target {sector.productionPolicy >= 0 ? "+" : ""}
            {sector.productionPolicy}%
          </span>
        </div>
      </div>

      {/* Production method (suggestion #91) */}
      {strategies.length > 1 && (
        <div>
          <div className="text-body-sm font-medium text-foreground">Production method</div>
          <p className="text-body-xs text-muted">
            How this sector makes what it makes. Each method uses different inputs and produces
            different goods. Changing method costs a retooling period before the new one is live.
          </p>
          {retooling ? (
            <p className="mt-2 text-body-xs text-warning">
              Retooling in progress. You can pick a new method once it finishes.
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <select
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
                disabled={disabled}
                aria-label="Production method"
                className="flex-1 min-w-[12rem] rounded-lg border border-card-border bg-card px-3 py-2 text-body-sm text-foreground disabled:opacity-50"
              >
                {strategies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <Button
                onClick={() =>
                  onPost(
                    `/api/corporations/${corpId}/sectors/${sector.sectorId}/strategy`,
                    { strategyId: strategy },
                    "Retooling started."
                  )
                }
                disabled={disabled || strategy === sector.strategyId}
              >
                Retool
              </Button>
            </div>
          )}
          {!retooling && (
            <p className="mt-1.5 text-body-xs text-muted">
              {strategies.find((s) => s.id === strategy)?.description ?? ""}
            </p>
          )}
        </div>
      )}

      {/* Capacity — plants: a build summary, not a slider. */}
      {plantsMode && (
        <div>
          <div className="text-body-sm font-medium text-foreground">Capacity</div>
          <p className="text-body-xs text-muted">
            What these {facilityPlural(sector.sectorType as CorporationType)} can make in one
            financial day. Capacity is bought, not set: order a build and it arrives after a
            construction lag.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2">
            <div>
              <div className="text-body-sm font-semibold tabular-nums text-foreground">
                {formatUnits(sector.capacityUnits)}
                <span className="ml-1 text-body-xs font-normal text-muted">
                  {CAPACITY_UNIT_LABEL}
                </span>
              </div>
              <BuildQueueBadge queue={sector.buildQueueSummary} className="mt-1" />
            </div>
            <div className="text-body-xs text-muted">
              Sold / made{" "}
              <span className="font-medium tabular-nums text-foreground">
                {formatUnits(sector.soldUnits)} / {formatUnits(sector.producedUnits)}
              </span>
            </div>
            <Link
              href={sectorBuildUrl(corpId, sector.sectorId)}
              className="ml-auto rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-body-xs font-semibold text-foreground transition-colors hover:bg-gold/20"
            >
              Build capacity
            </Link>
          </div>
        </div>
      )}

      {/* Capacity */}
      <div className={plantsMode ? "hidden" : undefined}>
        <div className="text-body-sm font-medium text-foreground">Capacity</div>
        <p className="text-body-xs text-muted">
          Set the growth rate this sector trends toward each turn. Higher targets expand revenue
          faster but raise the per-turn growth cost. Range {MIN_GROWTH_RATE}% to {MAX_GROWTH_RATE}%.
        </p>
        <div className="mt-2 flex items-center gap-3">
          <Slider
            variant="success"
            min={MIN_GROWTH_RATE}
            max={MAX_GROWTH_RATE}
            step={GROWTH_STEP}
            value={growth}
            onChange={(e) => setGrowth(Number(e.target.value))}
            disabled={disabled}
            aria-label="Target growth rate"
            className="flex-1"
          />
          <span className="w-14 text-right text-body-sm font-semibold tabular-nums text-foreground">
            {growth.toFixed(1)}%
          </span>
          <Button
            onClick={() =>
              onPost(
                `/api/corporations/${corpId}/sectors/${sector.sectorId}/growth`,
                { targetGrowthRate: growth },
                "Capacity target updated."
              )
            }
            disabled={disabled || growth === sector.targetGrowthRate}
          >
            Set
          </Button>
        </div>
      </div>

      {/* Production */}
      <div>
        <div className="text-body-sm font-medium text-foreground">Production</div>
        <p className="text-body-xs text-muted">
          Set a target output level ({PRODUCTION_MIN}% to +{PRODUCTION_MAX}%). The active level
          trends toward the target by 1 point per turn. Higher output raises revenue and commodity
          supply; lower output reduces them and cuts input demand.
        </p>
        {/* Live effect of the drafted target */}
        <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg border border-card-border bg-background/40 p-2">
          <EffectStat label="Revenue" info={effects.revenue} positiveIsGood />
          <EffectStat label="Output (supply)" info={effects.output} positiveIsGood />
          <EffectStat label="Input (demand)" info={effects.input} positiveIsGood={false} />
        </div>
        <div className="mt-2 flex items-center gap-3">
          <Slider
            variant={production >= 0 ? "success" : "error"}
            min={PRODUCTION_MIN}
            max={PRODUCTION_MAX}
            step={1}
            value={production}
            onChange={(e) => setProduction(Number(e.target.value))}
            disabled={disabled}
            aria-label="Production policy target"
            className="flex-1"
          />
          <span className="w-12 text-right text-body-sm font-semibold tabular-nums text-foreground">
            {production >= 0 ? "+" : ""}
            {production}%
          </span>
          <Button
            onClick={() =>
              onPost(
                `/api/corporations/${corpId}/sectors/${sector.sectorId}/policy`,
                { productionPolicy: production },
                "Production target updated."
              )
            }
            disabled={disabled || production === sector.productionPolicy}
          >
            Set
          </Button>
        </div>
      </div>
    </div>
  );
}

function EffectStat({
  label,
  info,
  positiveIsGood,
}: {
  label: string;
  info: { multiplier: number; label: string };
  positiveIsGood: boolean;
}) {
  const up = info.multiplier >= 1;
  const good = positiveIsGood ? up : !up;
  return (
    <div className="text-center">
      <div className="text-[10px] text-muted">{label}</div>
      <div className={`text-body-xs font-semibold ${good ? "text-success" : "text-error"}`}>
        {info.label}
      </div>
    </div>
  );
}
