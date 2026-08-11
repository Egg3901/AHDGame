"use client";

import { Input } from "@/components/ui";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { formatLocalAmount, formatLocalAmountFull } from "@/lib/utils/formatters";
import type { TreasuryPresetId, TreasuryPresetOption } from "@/lib/treasury/partyTreasuryPresets";

interface TreasuryPlanningCardProps {
  title: string;
  description: string;
  canEdit: boolean;
  treasury: number;
  currencyCode: CurrencyCode;
  transferReserveAmount: string;
  memberSupportReserveAmount: string;
  nppRecruitmentReserveAmount: string;
  totalReserveTarget: number;
  discretionaryTreasury: number;
  netHourlyTreasuryChange: number;
  turnsUntilZero: number | null;
  turnsUntilReserveFloor: number | null;
  turnsToReachReserveFloor: number | null;
  saving: boolean;
  saveDisabled: boolean;
  accentColor: string;
  treasuryPreset?: TreasuryPresetId;
  presetOptions?: TreasuryPresetOption[];
  budgetSummary?: Array<{ label: string; value: string }>;
  onPresetSelect?: (preset: Exclude<TreasuryPresetId, "custom">) => void;
  onFieldChange: (
    field: "transferReserveAmount" | "memberSupportReserveAmount" | "nppRecruitmentReserveAmount",
    value: string
  ) => void;
  onSave: () => void;
}

function ForecastChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "success" | "warning" | "error";
}) {
  const toneClasses = {
    success: "border-success/30 bg-success/10 text-success",
    warning: "border-warning/30 bg-warning/10 text-warning",
    error: "border-error/30 bg-error/10 text-error",
  } as const;

  return (
    <div className={`rounded-lg border px-3 py-2 ${toneClasses[tone]}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-sm font-bold tabular-nums">{value}</div>
    </div>
  );
}

export function TreasuryPlanningCard({
  title,
  description,
  canEdit,
  treasury,
  currencyCode,
  transferReserveAmount,
  memberSupportReserveAmount,
  nppRecruitmentReserveAmount,
  totalReserveTarget,
  discretionaryTreasury,
  netHourlyTreasuryChange,
  turnsUntilZero,
  turnsUntilReserveFloor,
  turnsToReachReserveFloor,
  saving,
  saveDisabled,
  accentColor,
  treasuryPreset = "custom",
  presetOptions = [],
  budgetSummary = [],
  onPresetSelect,
  onFieldChange,
  onSave,
}: TreasuryPlanningCardProps) {
  // Post-Phase-6: treasury and reserve fields arrive pre-denominated in the
  // party's local home currency, so we format directly with that symbol and
  // skip the FX-aware useCurrency() helpers (which would re-multiply).

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      <div className="border-b border-card-border/40 bg-card-muted/20 px-6 py-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">
              Treasurer Planning
            </div>
            <h3 className="mt-1 text-heading-sm font-bold text-foreground">{title}</h3>
            <p className="mt-2 max-w-3xl text-sm text-muted">{description}</p>
          </div>
          <div className="rounded-lg border border-card-border bg-background/60 px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Combined Reserve Target
            </div>
            <div className="mt-1 text-body-lg font-bold tabular-nums text-foreground">
              {formatLocalAmount(totalReserveTarget, currencyCode)}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-card-border bg-background/50 px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Treasury
            </div>
            <div className="mt-1 text-body-lg font-bold tabular-nums text-warning">
              {formatLocalAmount(treasury, currencyCode)}
            </div>
          </div>
          <div className="rounded-lg border border-card-border bg-background/50 px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Discretionary
            </div>
            <div className="mt-1 text-body-lg font-bold tabular-nums text-secondary">
              {formatLocalAmount(discretionaryTreasury, currencyCode)}
            </div>
          </div>
          <div className="rounded-lg border border-card-border bg-background/50 px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Net Treasury
            </div>
            <div
              className={`mt-1 text-body-lg font-bold tabular-nums ${
                netHourlyTreasuryChange >= 0 ? "text-success" : "text-error"
              }`}
            >
              {netHourlyTreasuryChange >= 0 ? "+" : "-"}
              {formatLocalAmount(Math.abs(netHourlyTreasuryChange), currencyCode)}
              <span className="ml-1 text-body-sm font-medium text-muted">/ hr</span>
            </div>
          </div>
          <div className="rounded-lg border border-card-border bg-background/50 px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Soft Target Mode
            </div>
            <div className="mt-1 text-body font-bold text-foreground">Warnings only</div>
            <div className="mt-1 text-body-sm text-muted">Chair can still override and spend.</div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <ForecastChip
            label="Reserve Floor"
            value={
              turnsUntilReserveFloor !== null
                ? `${turnsUntilReserveFloor} turns until breach`
                : turnsToReachReserveFloor !== null
                  ? `${turnsToReachReserveFloor} turns to rebuild`
                  : "Healthy"
            }
            tone={
              turnsUntilReserveFloor !== null
                ? "warning"
                : turnsToReachReserveFloor !== null
                  ? "error"
                  : "success"
            }
          />
          <ForecastChip
            label="Treasury Runway"
            value={turnsUntilZero !== null ? `${turnsUntilZero} turns until zero` : "Stable"}
            tone={turnsUntilZero !== null ? "error" : "success"}
          />
          <ForecastChip
            label="Emergency Override"
            value="Logged when sends/transfers pierce reserve"
            tone="warning"
          />
        </div>
      </div>

      <div className="px-6 py-5">
        {presetOptions.length > 0 && onPresetSelect && (
          <div className="mb-5 space-y-3 rounded-lg border border-card-border bg-background/30 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Treasurer Presets
                </div>
                <p className="mt-1 text-body-sm text-muted">
                  Apply a preset to auto-fill reserve targets and the treasury ratios below.
                </p>
              </div>
              <div className="text-xs text-muted">
                Current posture:{" "}
                <span className="font-semibold text-foreground">
                  {treasuryPreset === "custom"
                    ? "Custom"
                    : (presetOptions.find((option) => option.id === treasuryPreset)?.label ??
                      "Custom")}
                </span>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {presetOptions.map((option) => {
                const isActive = option.id === treasuryPreset;
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => onPresetSelect(option.id)}
                    className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                      isActive
                        ? "border-primary bg-primary/10"
                        : "border-card-border bg-card hover:border-primary/50"
                    } disabled:opacity-50`}
                  >
                    <div className="text-sm font-semibold text-foreground">{option.label}</div>
                    <div className="mt-1 text-xs text-muted">{option.description}</div>
                  </button>
                );
              })}
            </div>
            {budgetSummary.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {budgetSummary.map((item) => (
                  <span
                    key={item.label}
                    className="rounded-full border border-card-border bg-card px-2.5 py-1 text-[11px] text-muted"
                  >
                    <span className="font-semibold text-foreground">{item.label}</span> {item.value}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Transfer Reserve
            </label>
            <Input
              type="number"
              min={0}
              value={transferReserveAmount}
              disabled={!canEdit}
              onChange={(e) => onFieldChange("transferReserveAmount", e.target.value)}
              className="bg-background"
            />
            <p className="text-body-sm text-muted">
              Keep at least this much for national/state branch transfers.
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Member Support Reserve
            </label>
            <Input
              type="number"
              min={0}
              value={memberSupportReserveAmount}
              disabled={!canEdit}
              onChange={(e) => onFieldChange("memberSupportReserveAmount", e.target.value)}
              className="bg-background"
            />
            <p className="text-body-sm text-muted">
              Protect this pool for direct sends and candidate support.
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              NPP Recruitment Reserve
            </label>
            <Input
              type="number"
              min={0}
              value={nppRecruitmentReserveAmount}
              disabled={!canEdit}
              onChange={(e) => onFieldChange("nppRecruitmentReserveAmount", e.target.value)}
              className="bg-background"
            />
            <p className="text-body-sm text-muted">
              Hold this amount back for NPP recruitment and relocations.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-card-border bg-background/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="text-body-sm text-muted">
              Current soft floor:{" "}
              <span className="font-semibold text-foreground">
                {formatLocalAmountFull(totalReserveTarget, currencyCode)}
              </span>
            </div>
            {!canEdit && (
              <div className="text-xs font-medium text-warning">
                Treasurer or Admin required to update reserve targets.
              </div>
            )}
          </div>
          <button
            onClick={onSave}
            disabled={!canEdit || saveDisabled}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: accentColor }}
          >
            {saving ? "Saving…" : "Save Treasurer Plan"}
          </button>
        </div>
      </div>
    </div>
  );
}
