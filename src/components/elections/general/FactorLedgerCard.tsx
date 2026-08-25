"use client";

/**
 * Factor Ledger card — a read-only breakdown of why a presidential candidate is
 * ahead or behind, split into named factors.
 *
 * The viewer picks a candidate; the card renders that candidate's national
 * waterfall from `ElectionResponse.factorLedger` (teed off the engine's own vote
 * math server-side, never recomputed). Each factor is a signed diverging bar in
 * the same visual language as PersuasionDrivers / NationalMoodGauge: positive
 * pushes toward the candidate (party color), negative away (drag red).
 *
 * Fog-of-war is applied server-side: the factor waterfall is public for every
 * candidate, but `bucketAppeal` (where a candidate's support comes from) is
 * present only for a candidate the viewer owns. Renders nothing when the field
 * is absent (races that ran before the ledger existed).
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type {
  FactorLedgerSnapshot,
  CandidateNationalLedger,
  FactorContribution,
} from "@/lib/electionEngine/factorLedger";

export interface FactorLedgerCandidate {
  id: string;
  name: string;
  color: string;
}

const DRAG_COLOR = "#ef4444";

function signedInt(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded.toLocaleString()}`;
}

function CandidateSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: FactorLedgerCandidate[];
  onChange: (id: string) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-muted">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-card-border bg-background px-2 py-1 text-xs"
      >
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function FactorRow({
  factor: f,
  maxAbs,
  positiveColor,
}: {
  factor: FactorContribution;
  maxAbs: number;
  positiveColor: string;
}) {
  const t = useTranslations("elections");
  const isPositive = f.voteDelta >= 0;
  const widthPct = maxAbs > 0 ? (Math.abs(f.voteDelta) / maxAbs) * 50 : 0;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-semibold">
          {f.label}
          {typeof f.multiplier === "number" ? (
            <span className="ml-1 tabular-nums font-normal text-muted">
              x{f.multiplier.toFixed(2)}
            </span>
          ) : null}
        </span>
        <span
          className="tabular-nums font-bold"
          style={{ color: isPositive ? positiveColor : DRAG_COLOR }}
        >
          {signedInt(f.voteDelta)} {t("factorLedger.votesUnit")}
        </span>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-background">
        <span
          className="absolute top-0 h-full"
          style={{ left: "50%", width: 1, background: "var(--card-border)" }}
        />
        <span
          className="absolute top-0 h-full"
          style={{
            left: isPositive ? "50%" : `${50 - widthPct}%`,
            width: `${widthPct}%`,
            background: isPositive ? positiveColor : DRAG_COLOR,
            opacity: 0.85,
          }}
        />
      </div>
    </div>
  );
}

export function FactorLedgerCard({
  data,
  candidates,
}: {
  data?: FactorLedgerSnapshot | null;
  candidates: FactorLedgerCandidate[];
}) {
  const t = useTranslations("elections");
  const national: CandidateNationalLedger[] = useMemo(
    () => data?.byCandidateNational ?? [],
    [data]
  );

  // Default focus: the leader (byCandidateNational is finalVotes-sorted).
  const defaultId = national[0]?.candidateId ?? null;
  const [focusId, setFocusId] = useState<string | null>(defaultId);

  const focus =
    national.find((c) => c.candidateId === focusId) ??
    national.find((c) => c.candidateId === defaultId) ??
    null;

  const candidateById = useMemo(() => {
    const m = new Map<string, FactorLedgerCandidate>();
    for (const c of candidates) m.set(c.id, c);
    return m;
  }, [candidates]);

  // Only offer candidates that actually carry a ledger row.
  const selectable = useMemo(
    () =>
      national
        .map((n) => candidateById.get(n.candidateId))
        .filter((c): c is FactorLedgerCandidate => c != null),
    [national, candidateById]
  );

  if (!data || national.length === 0) return null;

  const focusDisplay = focus ? candidateById.get(focus.candidateId) : undefined;
  const positiveColor = focusDisplay?.color ?? "#22c55e";
  const focusName = focusDisplay?.name ?? t("factorLedger.candidateFallback");

  const maxAbs = focus ? Math.max(0, ...focus.factors.map((f) => Math.abs(f.voteDelta))) : 0;
  const bucketAppeal = focus?.bucketAppeal ?? [];

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
          {t("factorLedger.title")}
        </h3>
        <span className="text-[10px] uppercase tracking-wider text-muted">
          {t("factorLedger.recordedTurn", { turn: data.recordedTurn })}
        </span>
      </div>
      <p className="mb-3 text-xs leading-snug text-muted">{t("factorLedger.subtitle")}</p>

      {selectable.length > 0 && focus ? (
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <CandidateSelect
            label={t("factorLedger.candidateLabel")}
            value={focus.candidateId}
            options={selectable}
            onChange={setFocusId}
          />
        </div>
      ) : null}

      {focus ? (
        <>
          <div className="mb-2 flex items-baseline justify-between text-xs">
            <span className="font-semibold" style={{ color: positiveColor }}>
              {focusName}
            </span>
            <span className="tabular-nums text-muted">
              {t("factorLedger.baseline")}: {Math.round(focus.nominalWeight).toLocaleString()}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {focus.factors.map((f) => (
              <FactorRow key={f.key} factor={f} maxAbs={maxAbs} positiveColor={positiveColor} />
            ))}
          </div>
          <div className="mt-3 flex items-baseline justify-between border-t border-card-border pt-2 text-xs">
            <span className="font-semibold uppercase tracking-wider text-muted">
              {t("factorLedger.totalVotes")}
            </span>
            <span className="tabular-nums font-bold" style={{ color: positiveColor }}>
              {Math.round(focus.finalVotes).toLocaleString()} {t("factorLedger.votesUnit")}
            </span>
          </div>

          {bucketAppeal.length > 0 ? (
            <div className="mt-3 flex flex-col gap-1.5">
              <div className="text-[10px] uppercase tracking-wider text-muted">
                {t("factorLedger.bucketsTitle")}
              </div>
              {bucketAppeal.map((b) => (
                <div key={b.bucket} className="flex items-baseline justify-between text-xs">
                  <span className="font-semibold">{b.bucket}</span>
                  <span className="tabular-nums text-muted">
                    {(b.appealShare * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
