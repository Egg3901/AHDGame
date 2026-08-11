"use client";

import {
  CORPORATION_TYPES,
  CORPORATION_TYPE_LABELS,
  type CorporationType,
} from "@/lib/constants/corporations";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { MAX_PROVISIONS } from "@shared/constants/legislation";
import type { TariffProvisionInput } from "./tariffProvisionTypes";

interface Props {
  value: TariffProvisionInput[];
  onChange: (next: TariffProvisionInput[]) => void;
  countryId: CountryId;
  enabledCountryIds: readonly CountryId[];
}

function emptyRow(): TariffProvisionInput {
  return { scopeType: "economy_wide", rate: 10 };
}

export function TariffProvisionEditor({ value, onChange, countryId, enabledCountryIds }: Props) {
  const rows = value.length > 0 ? value : [emptyRow()];
  const originOptions = enabledCountryIds.filter((id) => id !== countryId);

  function updateRow(i: number, patch: Partial<TariffProvisionInput>) {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange(next);
  }

  function addRow() {
    if (rows.length >= MAX_PROVISIONS) return;
    onChange([...rows, emptyRow()]);
  }

  function removeRow(i: number) {
    const next = rows.filter((_, idx) => idx !== i);
    onChange(next.length > 0 ? next : [emptyRow()]);
  }

  function onScopeChange(i: number, scope: TariffProvisionInput["scopeType"]) {
    // Clear target fields when scope changes so stale values don't leak across
    updateRow(i, {
      scopeType: scope,
      targetSectorType: undefined,
      targetOriginCountryId: undefined,
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-purple-500/35 bg-purple-500/5 p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-purple-200/80">
          Tariff Provisions
        </h4>
        <span className="text-xs text-muted">
          {rows.length} / {MAX_PROVISIONS}
        </span>
      </div>

      {rows.map((row, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-card-border bg-card p-3">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted">
            <span>Tariff #{i + 1}</span>
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="text-muted hover:text-error"
              >
                Remove
              </button>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted" htmlFor={`scope-${i}`}>
              Scope
            </label>
            <select
              id={`scope-${i}`}
              value={row.scopeType}
              onChange={(e) =>
                onScopeChange(i, e.target.value as TariffProvisionInput["scopeType"])
              }
              className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
            >
              <option value="economy_wide">Economy-wide (all foreign corps)</option>
              <option value="sector">Sector (target one industry)</option>
              <option value="origin_country">
                Origin country (target imports from one country)
              </option>
            </select>
          </div>

          {row.scopeType === "sector" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted" htmlFor={`sector-${i}`}>
                Target Sector
              </label>
              <select
                id={`sector-${i}`}
                value={row.targetSectorType ?? ""}
                onChange={(e) =>
                  updateRow(i, {
                    targetSectorType: (e.target.value || undefined) as CorporationType | undefined,
                  })
                }
                className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
              >
                <option value="">Select…</option>
                {CORPORATION_TYPES.map((s) => (
                  <option key={s} value={s}>
                    {CORPORATION_TYPE_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          )}

          {row.scopeType === "origin_country" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted" htmlFor={`origin-${i}`}>
                Origin Country
              </label>
              <select
                id={`origin-${i}`}
                value={row.targetOriginCountryId ?? ""}
                onChange={(e) =>
                  updateRow(i, {
                    targetOriginCountryId: (e.target.value || undefined) as CountryId | undefined,
                  })
                }
                className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
              >
                <option value="">Select…</option>
                {originOptions.map((id) => (
                  <option key={id} value={id}>
                    {id} — {COUNTRY_CONFIGS[id]?.name ?? id}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] italic text-muted/60">
                Only enabled countries other than your own are listed.
              </p>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-muted" htmlFor={`rate-${i}`}>
              Rate
            </label>
            <div className="flex items-center gap-2">
              <input
                id={`rate-${i}`}
                type="range"
                min={0}
                max={100}
                step={1}
                value={row.rate}
                onInput={(e) =>
                  updateRow(i, { rate: Number((e.target as HTMLInputElement).value) })
                }
                className="flex-1 accent-purple-500"
              />
              <span className="min-w-[48px] rounded-md border border-card-border bg-card-elevated px-2 py-1 text-right font-mono text-xs">
                {row.rate}%
              </span>
            </div>
            <p className="mt-1 text-[11px] italic text-muted/60">
              {row.rate === 0
                ? "Rate 0 → nullifies any existing tariff at this scope."
                : `${row.rate}% margin penalty on foreign imports in this scope.`}
            </p>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addRow}
        disabled={rows.length >= MAX_PROVISIONS}
        className="w-full rounded-lg border border-dashed border-purple-500/40 bg-purple-500/10 px-3 py-2 text-xs font-medium text-purple-200 hover:bg-purple-500/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        + Add another tariff provision
      </button>
    </div>
  );
}
