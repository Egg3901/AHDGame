"use client";

import { useState } from "react";
import { EmptyState } from "@/components/ui";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import {
  SOE_PRICE_CONTROL_PENALTY,
  SOE_PRICE_CONTROL_BONUS_MULTIPLIER,
  SOE_EMPLOYMENT_GUARANTEE_PENALTY,
} from "@/lib/nationalization/constants";
import type { NationalCorporationViewModel } from "@/lib/nationalization/nationalCorporationView";
import type { NatOfficialActions } from "../NationalCorporationView";
import { natMoney as money } from "../natMoney";
import { SectorGlyph } from "../sectorIcons";

type MandateEntry = NationalCorporationViewModel["mandates"][number];

/**
 * Public Mandates: one rich card per held sector showing the state metric it
 * uplifts, the live public-value / efficiency / profit readout, and the two
 * posture toggles (price control, employment). Toggles are interactive for the
 * seated treasury official or the CEO, and read-only for everyone else. Spec §11.4 / §17.
 */
export function NatMandatesTab({
  vm,
  official,
  onRefresh,
}: {
  vm: NationalCorporationViewModel;
  official?: NatOfficialActions | null;
  onRefresh: () => void;
}) {
  const isTreasuryOfficial = !!official?.hasTreasuryAuthority;
  // The seated CEO may also set mandates (they run the corporation).
  const canEdit = isTreasuryOfficial || vm.viewerIsCeo;
  const [busySectorId, setBusySectorId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null
  );

  async function setPosture(entry: MandateEntry, patch: Partial<SoePosture>) {
    if (!canEdit || busySectorId) return;
    const next: SoePosture = {
      priceControlled: entry.priceControlled,
      employmentGuaranteed: entry.employmentGuaranteed,
      ...patch,
    };
    setBusySectorId(entry.sectorId);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/country/${vm.countryId.toLowerCase()}/national-corporation/${vm.corporationId}/mandate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: "sector", sectorId: entry.sectorId, ...next }),
        }
      );
      const json = await res.json();
      if (!res.ok) {
        setFeedback({ type: "error", message: json.error ?? "Update failed." });
      } else {
        onRefresh();
      }
    } catch {
      setFeedback({ type: "error", message: "Network error." });
    } finally {
      setBusySectorId(null);
    }
  }

  if (vm.mandates.length === 0) {
    return (
      <EmptyState
        title="No mandates"
        description="This National Corporation owns no sectors yet."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-card-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-heading-sm font-semibold text-foreground">Public-service mandates</h2>
          <p className="mt-1 text-body-xs text-muted">
            Mandates trade operating margin for public value. Price control lowers consumer prices
            and lifts the mapped state metric ({Math.abs(SOE_PRICE_CONTROL_PENALTY)} pts margin,{" "}
            {SOE_PRICE_CONTROL_BONUS_MULTIPLIER}× value); an employment guarantee sets a worker
            floor ({Math.abs(SOE_EMPLOYMENT_GUARANTEE_PENALTY)} pts margin). Losses on mandated
            services are absorbed by the treasury.
          </p>
        </div>
        <span
          className={`shrink-0 self-start whitespace-nowrap rounded-full border px-2.5 py-0.5 text-body-xs font-medium ${
            canEdit
              ? "border-gold/40 bg-gold/10 text-gold"
              : "border-card-border bg-card-muted text-muted"
          }`}
        >
          {isTreasuryOfficial
            ? "State-authority session"
            : vm.viewerIsCeo
              ? "CEO control"
              : "Read-only · public view"}
        </span>
      </div>

      <div className="space-y-3">
        {vm.mandates.map((m) => {
          const saving = busySectorId === m.sectorId;
          return (
            <div
              key={m.sectorId}
              className="overflow-hidden rounded-xl border border-card-border bg-card"
            >
              <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center">
                {/* Identity */}
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <SectorGlyph type={m.sectorType} className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-body-sm font-semibold text-foreground">
                        {CORPORATION_TYPE_LABELS[m.sectorType]}
                      </span>
                      <span className="rounded-full border border-card-border bg-card-muted px-2 py-0.5 text-[10px] font-medium text-muted">
                        {m.stateName}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted">
                      maps to{" "}
                      <span className="font-mono text-gold/80">
                        {m.mappedMetrics.join(" · ") || "—"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Live effect readout */}
                <div className="grid grid-cols-3 gap-3 lg:w-[300px] lg:shrink-0">
                  <Mini
                    label="Public value"
                    value={`+${m.publicValuePerTurn.toFixed(2)}/t`}
                    tone="success"
                  />
                  <Mini
                    label="Efficiency"
                    value={`${m.efficiencyPct.toFixed(1)}%`}
                    tone={m.efficiencyPct >= -12 ? "muted" : "error"}
                  />
                  <Mini
                    label="Profit/turn"
                    value={money(m.profitPerTurn, vm.currency)}
                    tone={m.profitPerTurn >= 0 ? "foreground" : "error"}
                  />
                </div>

                {/* Posture toggles. Price control only helps a sector that maps to
                    a state metric — hidden for unmapped sectors (it would be pure
                    margin cost). Employment relief is universal, so it always shows. */}
                <div className="flex shrink-0 items-center gap-5 lg:w-[260px] lg:justify-end">
                  {m.mappedMetrics.length > 0 && (
                    <PostureToggle
                      label="Price-controlled"
                      hint="+value, −margin"
                      checked={m.priceControlled}
                      disabled={!canEdit || saving}
                      onChange={(v) => setPosture(m, { priceControlled: v })}
                    />
                  )}
                  <PostureToggle
                    label="Employment"
                    hint="worker floor"
                    checked={m.employmentGuaranteed}
                    disabled={!canEdit || saving}
                    onChange={(v) => setPosture(m, { employmentGuaranteed: v })}
                  />
                </div>
              </div>
            </div>
          );
        })}
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

interface SoePosture {
  priceControlled: boolean;
  employmentGuaranteed: boolean;
}

function Mini({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "success" | "error" | "muted" | "foreground";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "error"
        ? "text-error"
        : tone === "muted"
          ? "text-muted"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-card-border bg-card-muted px-2 py-1.5 text-center">
      <div className="text-[9px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-0.5 text-body-sm font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

function PostureToggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 ${disabled ? "cursor-default" : "cursor-pointer"}`}>
      <div className="text-right">
        <div className="whitespace-nowrap text-[11px] font-medium text-foreground">{label}</div>
        <div className="text-[10px] text-muted">{hint}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
          checked ? "bg-gold" : "bg-card-border"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
    </label>
  );
}
