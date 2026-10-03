"use client";

import { Fragment, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { STATE_FLAGS } from "@/lib/constants";
import {
  CORPORATION_TYPE_LABELS,
  MAX_GROWTH_RATE,
  MIN_GROWTH_RATE,
  type CorporationType,
} from "@/lib/constants/corporations";
import { scaleMoney } from "@/lib/constants/moneyTimescale";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import { WAGE_LEVEL_MAX, WAGE_LEVEL_MIN } from "@/lib/labour/laborCost";
import { getPolicyEffectInfo } from "@/lib/utils/productionPolicy";
import { useCountryDisplayName } from "@/contexts/RegisteredCountriesContext";
import type { CountryId } from "@/lib/constants/countries";
import type { CorporationDetail, SectorDetail } from "../CorporationPageTypes";
import { formatUnits, sectorBuildUrl } from "../plantsPresentation";
import {
  DenseSection,
  FillText,
  InlineStatus,
  SmallButton,
  TableScroll,
  Td,
  Th,
  signTone,
  useCorpMoney,
} from "../dense/DenseKit";
import { BulkWageControl } from "./BulkWageControl";

/** Result shape returned by the atomic bulk endpoint helper. */
export interface BulkOperationsResult {
  ok: boolean;
  matchedCount?: number;
  growth?: {
    targetGrowthRate: number;
    projectedTotalCostPerTurn: number;
    currentTotalCostPerTurn: number;
    costDeltaPerTurn: number;
  };
  wages?: {
    wageLevel: number;
    currentTotalCostPerTurn: number;
    projectedTotalCostPerTurn: number;
    costDeltaPerTurn: number;
    missingCostCount: number;
    protectedCount: number;
  };
  error?: string;
}

export type BulkOperationsFn = (
  countryId: string,
  sectorType: CorporationType | null,
  body: {
    targetGrowthRate?: number;
    productionPolicy?: number; // pragma: allowlist secret
    pricingPosture?: number | null;
    wageLevel?: number;
    preview?: boolean;
  }
) => Promise<BulkOperationsResult>;

/** Single-sector growth set, with optional preview (projected cost, no write). */
export type SectorGrowthFn = (
  sectorId: string,
  targetGrowthRate: number,
  body?: { preview?: boolean }
) => Promise<{
  ok: boolean;
  projectedCostPerTurn?: number;
  currentCostPerTurn?: number;
  costDeltaPerTurn?: number;
  error?: string;
}>;

export interface SectorLeverResult {
  ok: boolean;
  error?: string;
}

const POLICY_MIN = -25;
const POLICY_MAX = 25;
const POSTURE_STEPS = [-0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2] as const;

function postureLabel(p: number | null): string {
  if (p == null) return "Auto";
  if (p === 0) return "Market";
  return `${p > 0 ? "+" : ""}${Math.round(p * 100)}%`;
}

function signedPct(n: number): string {
  return `${n > 0 ? "+" : ""}${n}%`;
}

const clampPolicy = (n: number) => Math.max(POLICY_MIN, Math.min(POLICY_MAX, Math.round(n)));

/** Growth-cost previews come back on the daily clock; the table speaks per turn. */
const perTurn = (daily: number) => Math.round(scaleMoney(daily, "turn"));

const cellInput =
  "h-6 rounded border bg-background px-1.5 text-right text-[13px] tabular-nums text-foreground focus:border-foreground focus:outline-none disabled:opacity-50";

/** A value the CEO just saved, shown until the refreshed sector catches up. */
interface Pending<T> {
  value: T;
  base: T;
}

function shown<T>(server: T, pending: Pending<T> | null): T {
  return pending && pending.base === server ? pending.value : server;
}

type RowStatus = { tone: "success" | "error" | "muted"; text: string } | null;

interface RowProps {
  sector: SectorDetail;
  corpId: string;
  plantsMode: boolean;
  labourEnabled: boolean;
  fmt: (local: number) => string;
  fmtSigned: (local: number) => string;
  onSavePolicy: (sectorId: string, productionPolicy: number) => Promise<SectorLeverResult>;
  onSetPricing: (sectorId: string, posture: number | null) => Promise<SectorLeverResult>;
  onSetWage: (sectorId: string, wageLevel: number) => Promise<SectorLeverResult>;
  onSectorGrowth: SectorGrowthFn;
  columnCount: number;
}

function OperationsRow({
  sector,
  corpId,
  plantsMode,
  labourEnabled,
  fmt,
  fmtSigned,
  onSavePolicy,
  onSetPricing,
  onSetWage,
  onSectorGrowth,
  columnCount,
}: RowProps) {
  const [status, setStatus] = useState<RowStatus>(null);
  const [busy, setBusy] = useState(false);

  const serverPolicy = sector.productionPolicy ?? 0;
  const [policyDraft, setPolicyDraft] = useState<string | null>(null);
  const [pendingPolicy, setPendingPolicy] = useState<Pending<number> | null>(null);
  const policyValue = shown(serverPolicy, pendingPolicy);

  const serverPosture = sector.pricingPosture ?? null;
  const [pendingPosture, setPendingPosture] = useState<Pending<number | null> | null>(null);
  const postureValue = shown(serverPosture, pendingPosture);

  const serverWage = sector.wageLevel ?? 1;
  const [wageDraft, setWageDraft] = useState<string | null>(null);
  const [pendingWage, setPendingWage] = useState<Pending<number> | null>(null);
  const wageValue = shown(serverWage, pendingWage);

  const [growthDraft, setGrowthDraft] = useState<string | null>(null);
  const [growthPreview, setGrowthPreview] = useState<{
    target: number;
    projected: number;
    current: number;
    delta: number;
  } | null>(null);

  const active = sector.productionPolicyLevel ?? 0;
  const effects = getPolicyEffectInfo(active);
  const scale = (daily: number) => perTurn(daily);
  const revenue = sector.financialRevenue ?? sector.revenue;
  const margin = sector.fillAdjustedMarginPct ?? sector.effectiveProfitMargin;
  const flag = STATE_FLAGS[sector.stateId];

  async function run(action: () => Promise<SectorLeverResult>, success: string) {
    setBusy(true);
    setStatus({ tone: "muted", text: "Saving" });
    try {
      const r = await action();
      setStatus(
        r.ok ? { tone: "success", text: success } : { tone: "error", text: r.error ?? "Failed" }
      );
      return r.ok;
    } finally {
      setBusy(false);
    }
  }

  async function commitPolicy() {
    if (policyDraft === null) return;
    const parsed = Number(policyDraft);
    setPolicyDraft(null);
    if (!Number.isFinite(parsed)) return;
    const next = clampPolicy(parsed);
    if (next === policyValue) return;
    const ok = await run(() => onSavePolicy(sector._id, next), `Output target ${signedPct(next)}`);
    if (ok) setPendingPolicy({ value: next, base: serverPolicy });
  }

  async function commitPosture(raw: string) {
    const next = raw === "auto" ? null : Number(raw);
    const ok = await run(() => onSetPricing(sector._id, next), `Pricing ${postureLabel(next)}`);
    if (ok) setPendingPosture({ value: next, base: serverPosture });
  }

  async function commitWage() {
    if (wageDraft === null) return;
    const parsed = Number(wageDraft);
    setWageDraft(null);
    if (!Number.isFinite(parsed)) return;
    const next = Math.round(Math.max(WAGE_LEVEL_MIN, Math.min(WAGE_LEVEL_MAX, parsed)) * 100) / 100;
    if (next === wageValue) return;
    const ok = await run(() => onSetWage(sector._id, next), `Wages ${next.toFixed(2)}x`);
    if (ok) setPendingWage({ value: next, base: serverWage });
  }

  async function previewGrowth() {
    if (growthDraft === null) return;
    const parsed = Number(growthDraft);
    if (!Number.isFinite(parsed)) return;
    const target = Math.max(MIN_GROWTH_RATE, Math.min(MAX_GROWTH_RATE, parsed));
    setBusy(true);
    setStatus(null);
    const r = await onSectorGrowth(sector._id, target, { preview: true });
    setBusy(false);
    if (!r.ok) {
      setStatus({ tone: "error", text: r.error ?? "Preview failed" });
      return;
    }
    setGrowthPreview({
      target,
      projected: r.projectedCostPerTurn ?? 0,
      current: r.currentCostPerTurn ?? 0,
      delta: r.costDeltaPerTurn ?? 0,
    });
  }

  async function confirmGrowth() {
    if (!growthPreview) return;
    const target = growthPreview.target;
    setBusy(true);
    const r = await onSectorGrowth(sector._id, target);
    setBusy(false);
    setGrowthPreview(null);
    setGrowthDraft(null);
    setStatus(
      r.ok
        ? { tone: "success", text: `Growth target ${target}%` }
        : { tone: "error", text: r.error ?? "Failed" }
    );
  }

  const growthTarget = sector.targetGrowthRate ?? 0;

  return (
    <Fragment>
      <tr className="hover:bg-card-elevated/40">
        <Td>
          <Link
            href={`/corporation/${corpId}/sector/${sector._id}`}
            className="inline-flex max-w-[13rem] items-center gap-1.5 truncate text-foreground hover:underline"
          >
            {flag && (
              <Image
                src={flag}
                alt=""
                width={16}
                height={11}
                className="h-[11px] w-4 shrink-0 rounded-[2px] object-cover"
                unoptimized={bypassNextImageOptimization(flag)}
              />
            )}
            <span className="truncate">{sector.displayName ?? sector.stateName}</span>
          </Link>
          {sector.mothballed && <span className="ml-1.5 text-[11px] text-muted">mothballed</span>}
          {sector.embargoSuspended && (
            <span className="ml-1.5 text-[11px] text-error">embargo</span>
          )}
        </Td>
        <Td className="text-muted">{sector.sectorLabel}</Td>
        <Td align="right">{fmt(scale(revenue))}</Td>
        <Td align="right" className={signTone(margin)}>
          {Number.isFinite(margin) ? `${margin.toFixed(1)}%` : "—"}
        </Td>
        <Td align="right" className={signTone(sector.profit)}>
          {fmtSigned(scale(sector.profit))}
        </Td>
        <Td align="right" className="hidden text-muted lg:table-cell">
          {sector.workers.toLocaleString("en-US")}
        </Td>
        {plantsMode ? (
          <>
            <Td align="right" className="text-muted">
              {formatUnits(sector.capacityUnits)}
              {sector.buildQueueSummary && sector.buildQueueSummary.unitsOrdered > 0 && (
                <span
                  className="ml-1 text-[11px] text-foreground"
                  title={`${formatUnits(sector.buildQueueSummary.unitsOrdered)} units/day under construction`}
                >
                  +{formatUnits(sector.buildQueueSummary.unitsOrdered)}
                </span>
              )}
            </Td>
            <Td align="right">
              <FillText fill={sector.fillRate} band={sector.fillRateBand} />
            </Td>
          </>
        ) : (
          <Td align="right">
            <span className="inline-flex items-center gap-1">
              <span className="text-muted" title="Current growth rate">
                {sector.currentGrowthRate}%
              </span>
              <span aria-hidden className="text-muted/60">
                →
              </span>
              <input
                type="number"
                min={MIN_GROWTH_RATE}
                max={MAX_GROWTH_RATE}
                step={0.5}
                aria-label={`Growth target, ${sector.stateName} ${sector.sectorLabel}`}
                value={growthDraft ?? String(growthTarget)}
                disabled={busy || growthPreview !== null}
                onChange={(e) => setGrowthDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void previewGrowth();
                  if (e.key === "Escape") setGrowthDraft(null);
                }}
                className={`${cellInput} w-14 ${growthDraft !== null && Number(growthDraft) !== growthTarget ? "border-foreground/70" : "border-card-border"}`}
              />
              {growthDraft !== null && Number(growthDraft) !== growthTarget && !growthPreview && (
                <SmallButton onClick={() => void previewGrowth()} disabled={busy}>
                  Set growth
                </SmallButton>
              )}
            </span>
          </Td>
        )}
        <Td align="right">
          <span
            className="inline-flex items-center gap-1"
            title={`At the active level: revenue ${effects.revenue.label}, output ${effects.output.label}, inputs ${effects.input.label}. The level moves 1 point per turn toward the target.`}
          >
            <span className={`text-[12px] ${signTone(active)}`}>{signedPct(active)}</span>
            <span aria-hidden className="text-muted/60">
              →
            </span>
            <input
              type="number"
              min={POLICY_MIN}
              max={POLICY_MAX}
              step={1}
              aria-label={`Output target, ${sector.stateName} ${sector.sectorLabel}`}
              value={policyDraft ?? String(policyValue)}
              disabled={busy}
              onChange={(e) => setPolicyDraft(e.target.value)}
              onBlur={() => void commitPolicy()}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setPolicyDraft(null);
              }}
              className={`${cellInput} w-14 ${policyValue !== active ? "border-foreground/50" : "border-card-border"}`}
            />
          </span>
        </Td>
        {sector.pricingPosture !== undefined && (
          <Td align="right">
            <select
              aria-label={`Pricing, ${sector.stateName} ${sector.sectorLabel}`}
              value={postureValue == null ? "auto" : String(postureValue)}
              disabled={busy}
              onChange={(e) => void commitPosture(e.target.value)}
              className="h-6 rounded border border-card-border bg-background px-1 text-xs text-foreground focus:border-foreground focus:outline-none disabled:opacity-50"
            >
              <option value="auto">Auto</option>
              {POSTURE_STEPS.map((p) => (
                <option key={p} value={String(p)}>
                  {postureLabel(p)}
                </option>
              ))}
            </select>
          </Td>
        )}
        {labourEnabled && sector.wageLevel !== undefined && (
          <Td align="right">
            <input
              type="number"
              min={WAGE_LEVEL_MIN}
              max={WAGE_LEVEL_MAX}
              step={0.05}
              aria-label={`Wage level, ${sector.stateName} ${sector.sectorLabel}`}
              value={wageDraft ?? wageValue.toFixed(2)}
              disabled={busy}
              onChange={(e) => setWageDraft(e.target.value)}
              onBlur={() => void commitWage()}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setWageDraft(null);
              }}
              className={`${cellInput} w-16 border-card-border`}
            />
          </Td>
        )}
        <Td align="right" className="text-xs">
          <span className="inline-flex items-center justify-end gap-2">
            {status && (
              <span
                className={`max-w-[9rem] truncate ${status.tone === "success" ? "text-success" : status.tone === "error" ? "text-error" : "text-muted"}`}
                title={status.text}
                role={status.tone === "error" ? "alert" : "status"}
              >
                {status.text}
              </span>
            )}
            {plantsMode && (
              <Link
                href={sectorBuildUrl(corpId, sector._id)}
                className="text-foreground underline decoration-card-border underline-offset-2 hover:decoration-foreground"
              >
                Build
              </Link>
            )}
          </span>
        </Td>
      </tr>
      {growthPreview && (
        <tr>
          <td colSpan={columnCount} className="border-b border-card-border/60 px-2 py-1.5">
            <div className="flex flex-wrap items-center justify-end gap-2 text-xs" role="status">
              <span className="text-foreground">
                Growth {growthPreview.target}%: about {fmt(perTurn(growthPreview.projected))}/turn
                once ramped, now {fmt(perTurn(growthPreview.current))}/turn (
                {fmtSigned(perTurn(growthPreview.delta))}).
              </span>
              <SmallButton tone="primary" onClick={() => void confirmGrowth()} disabled={busy}>
                {busy ? "Applying" : "Confirm"}
              </SmallButton>
              <SmallButton onClick={() => setGrowthPreview(null)} disabled={busy}>
                Cancel
              </SmallButton>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

interface Scope {
  key: string;
  country: string;
  sectorType: CorporationType | null;
  label: string;
  count: number;
}

function BulkBar({
  scopes,
  plantsMode,
  labourEnabled,
  pricingEnabled,
  onBulkOperations,
  fmt,
  fmtSigned,
}: {
  scopes: Scope[];
  plantsMode: boolean;
  labourEnabled: boolean;
  pricingEnabled: boolean;
  onBulkOperations: BulkOperationsFn;
  fmt: (local: number) => string;
  fmtSigned: (local: number) => string;
}) {
  const [scopeKey, setScopeKey] = useState(scopes[0]?.key ?? "");
  const scope = scopes.find((s) => s.key === scopeKey) ?? scopes[0];
  const [policy, setPolicy] = useState("0");
  const [posture, setPosture] = useState("auto");
  const [growth, setGrowth] = useState("0");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [preview, setPreview] = useState<{
    target: number;
    matched: number;
    projected: number;
    current: number;
    delta: number;
  } | null>(null);

  if (!scope) return null;

  async function apply(
    body: Parameters<BulkOperationsFn>[2],
    describe: (matched: number) => string
  ) {
    setBusy(true);
    setMessage(null);
    const r = await onBulkOperations(scope.country, scope.sectorType, body);
    setBusy(false);
    setMessage(
      r.ok
        ? { tone: "success", text: describe(r.matchedCount ?? 0) }
        : { tone: "error", text: r.error ?? "Failed" }
    );
    return r;
  }

  async function previewGrowth() {
    const target = Math.max(MIN_GROWTH_RATE, Math.min(MAX_GROWTH_RATE, Number(growth) || 0));
    setBusy(true);
    setMessage(null);
    const r = await onBulkOperations(scope.country, scope.sectorType, {
      targetGrowthRate: target,
      preview: true,
    });
    setBusy(false);
    if (r.ok && r.growth) {
      setPreview({
        target,
        matched: r.matchedCount ?? 0,
        projected: r.growth.projectedTotalCostPerTurn,
        current: r.growth.currentTotalCostPerTurn,
        delta: r.growth.costDeltaPerTurn,
      });
    } else {
      setMessage({ tone: "error", text: r.error ?? "Failed to preview" });
    }
  }

  const fieldLabel = "flex items-center gap-1.5 text-xs text-muted";

  return (
    <div className="space-y-1.5 border-b border-card-border/60 py-2">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <label className={fieldLabel}>
          Apply to
          <select
            aria-label="Bulk scope"
            value={scope.key}
            onChange={(e) => {
              setScopeKey(e.target.value);
              setPreview(null);
              setMessage(null);
            }}
            className="h-7 max-w-[16rem] rounded-md border border-card-border bg-background px-1.5 text-xs text-foreground focus:border-foreground focus:outline-none"
          >
            {scopes.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label} ({s.count})
              </option>
            ))}
          </select>
        </label>

        <span className={fieldLabel}>
          <label htmlFor="bulk-output">Output</label>
          <input
            id="bulk-output"
            type="number"
            min={POLICY_MIN}
            max={POLICY_MAX}
            step={1}
            aria-label="Bulk output target"
            value={policy}
            onChange={(e) => setPolicy(e.target.value)}
            className={`${cellInput} w-14 border-card-border`}
          />
          <SmallButton
            disabled={busy}
            onClick={() => {
              const value = clampPolicy(Number(policy) || 0);
              void apply(
                { productionPolicy: value },
                (n) => `Output target ${signedPct(value)} on ${n} sectors`
              );
            }}
          >
            Set output
          </SmallButton>
        </span>

        {pricingEnabled && (
          <span className={fieldLabel}>
            <label htmlFor="bulk-pricing">Pricing</label>
            <select
              id="bulk-pricing"
              aria-label="Bulk pricing"
              value={posture}
              onChange={(e) => setPosture(e.target.value)}
              className="h-7 rounded-md border border-card-border bg-background px-1 text-xs text-foreground focus:border-foreground focus:outline-none"
            >
              <option value="auto">Auto</option>
              {POSTURE_STEPS.map((p) => (
                <option key={p} value={String(p)}>
                  {postureLabel(p)}
                </option>
              ))}
            </select>
            <SmallButton
              disabled={busy}
              onClick={() => {
                const value = posture === "auto" ? null : Number(posture);
                void apply(
                  { pricingPosture: value },
                  (n) => `Pricing ${postureLabel(value)} on ${n} sectors`
                );
              }}
            >
              Set pricing
            </SmallButton>
          </span>
        )}

        {!plantsMode && (
          <span className={fieldLabel}>
            <label htmlFor="bulk-growth">Growth</label>
            <input
              id="bulk-growth"
              type="number"
              min={MIN_GROWTH_RATE}
              max={MAX_GROWTH_RATE}
              step={0.5}
              aria-label="Bulk growth target"
              value={growth}
              onChange={(e) => {
                setGrowth(e.target.value);
                setPreview(null);
              }}
              className={`${cellInput} w-14 border-card-border`}
            />
            %
            <SmallButton disabled={busy || preview !== null} onClick={() => void previewGrowth()}>
              Set growth
            </SmallButton>
          </span>
        )}

        {labourEnabled && (
          <BulkWageControl
            key={scope.key}
            country={scope.country}
            sectorType={scope.sectorType}
            onBulkOperations={onBulkOperations}
            fmtMoney={fmt}
          />
        )}
      </div>

      {preview && (
        <div className="flex flex-wrap items-center gap-2 text-xs" role="status">
          <span className="text-foreground">
            Growth {preview.target}% on {preview.matched} sectors: about{" "}
            {fmt(perTurn(preview.projected))}/turn once ramped, now {fmt(perTurn(preview.current))}
            /turn ({fmtSigned(perTurn(preview.delta))}).
          </span>
          <SmallButton
            tone="primary"
            disabled={busy}
            onClick={async () => {
              const target = preview.target;
              setPreview(null);
              await apply(
                { targetGrowthRate: target },
                (n) => `Growth target ${target}% on ${n} sectors`
              );
            }}
          >
            Confirm
          </SmallButton>
          <SmallButton disabled={busy} onClick={() => setPreview(null)}>
            Cancel
          </SmallButton>
        </div>
      )}
      <InlineStatus message={message?.text} tone={message?.tone ?? "muted"} />
    </div>
  );
}

type SortKey = "revenue" | "margin" | "profit" | "fill";

interface CeoOperationsTableProps {
  corporation: CorporationDetail;
  sectors: SectorDetail[];
  corpId: string;
  onSavePolicy: (sectorId: string, productionPolicy: number) => Promise<SectorLeverResult>;
  onSetPricing: (sectorId: string, posture: number | null) => Promise<SectorLeverResult>;
  onSetWage: (sectorId: string, wageLevel: number) => Promise<SectorLeverResult>;
  onBulkOperations: BulkOperationsFn;
  onSectorGrowth: SectorGrowthFn;
}

/**
 * Every holding on one row, with its levers in the row: output target,
 * pricing, wages, and growth (or a build link under plants). A bulk bar
 * above applies the same levers to a country or a sector group at once.
 */
export default function CeoOperationsTable({
  corporation,
  sectors,
  corpId,
  onSavePolicy,
  onSetPricing,
  onSetWage,
  onBulkOperations,
  onSectorGrowth,
}: CeoOperationsTableProps) {
  const plantsMode = corporation.plantsMode === true;
  const labourEnabled = corporation.labourEnabled === true;
  const money = useCorpMoney(corporation.liquidCurrencyCode);
  const countryName = useCountryDisplayName();
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const pricingEnabled = sectors.some((s) => s.pricingPosture !== undefined);
  const wagesEnabled = labourEnabled && sectors.some((s) => s.wageLevel !== undefined);

  const homeCountry = corporation.countryId;
  const scopes = useMemo<Scope[]>(() => {
    const byCountry = new Map<string, SectorDetail[]>();
    for (const s of sectors) {
      const c = s.countryId ?? homeCountry;
      byCountry.set(c, [...(byCountry.get(c) ?? []), s]);
    }
    const multiCountry = byCountry.size > 1;
    const countries = [...byCountry.keys()].sort((a, b) =>
      a === homeCountry ? -1 : b === homeCountry ? 1 : a.localeCompare(b)
    );
    const out: Scope[] = [];
    for (const c of countries) {
      const list = byCountry.get(c) ?? [];
      const suffix = multiCountry ? ` in ${countryName(c as CountryId)}` : "";
      out.push({
        key: `${c}::*`,
        country: c,
        sectorType: null,
        label: `All sectors${suffix}`,
        count: list.length,
      });
      const types = new Map<CorporationType, number>();
      for (const s of list) {
        const t = s.sectorType as CorporationType;
        types.set(t, (types.get(t) ?? 0) + 1);
      }
      for (const [t, n] of [...types.entries()].sort((a, b) => b[1] - a[1])) {
        out.push({
          key: `${c}::${t}`,
          country: c,
          sectorType: t,
          label: `${CORPORATION_TYPE_LABELS[t]}${suffix}`,
          count: n,
        });
      }
    }
    return out;
  }, [sectors, homeCountry, countryName]);

  const sorted = useMemo(() => {
    const value: Record<SortKey, (s: SectorDetail) => number> = {
      revenue: (s) => s.financialRevenue ?? s.revenue,
      margin: (s) => s.fillAdjustedMarginPct ?? s.effectiveProfitMargin,
      profit: (s) => s.profit,
      fill: (s) => s.fillRate ?? -1,
    };
    const dir = sortDir === "asc" ? 1 : -1;
    return [...sectors].sort((a, b) => (value[sortKey](a) - value[sortKey](b)) * dir);
  }, [sectors, sortKey, sortDir]);

  const sortBy = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };
  const sortState = (key: SortKey) => (key === sortKey ? sortDir : null);

  // Region, sector, revenue, margin, profit, workers, (capacity + fill | growth),
  // output, [pricing], [wages], status.
  const columnCount =
    6 + (plantsMode ? 2 : 1) + 1 + (pricingEnabled ? 1 : 0) + (wagesEnabled ? 1 : 0) + 1;

  return (
    <DenseSection
      id="ceo-operations"
      title="Operations"
      meta={`${sectors.length} sector${sectors.length === 1 ? "" : "s"}, per turn`}
    >
      {sectors.length === 0 ? (
        <p className="py-2 text-xs text-muted">
          No sectors yet. Found the first plant from the Sectors tab.
        </p>
      ) : (
        <>
          <BulkBar
            scopes={scopes}
            plantsMode={plantsMode}
            labourEnabled={wagesEnabled}
            pricingEnabled={pricingEnabled}
            onBulkOperations={onBulkOperations}
            fmt={money.fmt}
            fmtSigned={money.fmtSigned}
          />
          <TableScroll>
            <table className="w-full min-w-[860px] border-collapse">
              <thead>
                <tr>
                  <Th>Region</Th>
                  <Th>Sector</Th>
                  <Th align="right" onClick={() => sortBy("revenue")} sorted={sortState("revenue")}>
                    Revenue
                  </Th>
                  <Th align="right" onClick={() => sortBy("margin")} sorted={sortState("margin")}>
                    Margin
                  </Th>
                  <Th align="right" onClick={() => sortBy("profit")} sorted={sortState("profit")}>
                    Profit
                  </Th>
                  <Th align="right" className="hidden lg:table-cell">
                    Workers
                  </Th>
                  {plantsMode ? (
                    <>
                      <Th
                        align="right"
                        title="Nameplate capacity, units per day. +N is under construction."
                      >
                        Capacity
                      </Th>
                      <Th align="right" onClick={() => sortBy("fill")} sorted={sortState("fill")}>
                        Fill
                      </Th>
                    </>
                  ) : (
                    <Th align="right" title="Current growth rate, and the target it moves toward.">
                      Growth
                    </Th>
                  )}
                  <Th
                    align="right"
                    title="Production level now, and the target it moves toward by 1 point per turn (-25 to +25)."
                  >
                    Output
                  </Th>
                  {pricingEnabled && (
                    <Th
                      align="right"
                      title="Posted price against the market. Undercut to sell first; price above to keep margin."
                    >
                      Pricing
                    </Th>
                  )}
                  {wagesEnabled && (
                    <Th
                      align="right"
                      title="Wage multiplier. 1.00 is baseline pay; floors still apply."
                    >
                      Wages
                    </Th>
                  )}
                  <Th align="right">
                    <span className="sr-only">Status and actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <OperationsRow
                    key={s._id}
                    sector={s}
                    corpId={corpId}
                    plantsMode={plantsMode}
                    labourEnabled={wagesEnabled}
                    fmt={money.fmt}
                    fmtSigned={money.fmtSigned}
                    onSavePolicy={onSavePolicy}
                    onSetPricing={onSetPricing}
                    onSetWage={onSetWage}
                    onSectorGrowth={onSectorGrowth}
                    columnCount={columnCount}
                  />
                ))}
              </tbody>
            </table>
          </TableScroll>
        </>
      )}
    </DenseSection>
  );
}
