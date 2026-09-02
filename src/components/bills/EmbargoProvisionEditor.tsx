"use client";

import { type CountryId } from "@/lib/constants/countries";
import { COMMODITY_TYPES, COMMODITY_LABELS } from "@/lib/constants/commodities";
import { MAX_PROVISIONS } from "@shared/constants/legislation";
import type { EmbargoProvisionInput } from "./embargoProvisionTypes";
import { useCountryDisplayName } from "@/contexts/RegisteredCountriesContext";

interface Props {
  value: EmbargoProvisionInput[];
  onChange: (next: EmbargoProvisionInput[]) => void;
  countryId: CountryId;
  enabledCountryIds: readonly CountryId[];
}

function emptyRow(): EmbargoProvisionInput {
  return {
    action: "embargo",
    targetCountry: "",
    commodity: "all",
    direction: "both",
    mode: "block",
  };
}

export function EmbargoProvisionEditor({ value, onChange, countryId, enabledCountryIds }: Props) {
  const resolveCountryName = useCountryDisplayName();
  const rows = value.length > 0 ? value : [emptyRow()];
  const targetOptions = enabledCountryIds.filter((id) => id !== countryId);

  function updateRow(i: number, patch: Partial<EmbargoProvisionInput>) {
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

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-purple-500/35 bg-purple-500/5 p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-purple-200/80">
          Embargo Provisions
        </h4>
        <span className="text-xs text-muted">
          {rows.length} / {MAX_PROVISIONS}
        </span>
      </div>

      {rows.map((row, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-card-border bg-card p-3">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted">
            <span>Embargo #{i + 1}</span>
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
            <label
              className="mb-1 block text-xs font-medium text-muted"
              htmlFor={`emb-action-${i}`}
            >
              Action
            </label>
            <select
              id={`emb-action-${i}`}
              value={row.action}
              onChange={(e) =>
                updateRow(i, { action: e.target.value as EmbargoProvisionInput["action"] })
              }
              className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
            >
              <option value="embargo">Impose embargo</option>
              <option value="end_embargo">Lift embargo (repeal)</option>
            </select>
          </div>

          <div>
            <label
              className="mb-1 block text-xs font-medium text-muted"
              htmlFor={`emb-target-${i}`}
            >
              Target Country
            </label>
            <select
              id={`emb-target-${i}`}
              value={row.targetCountry}
              onChange={(e) =>
                updateRow(i, {
                  targetCountry: (e.target.value || "") as CountryId | "",
                })
              }
              className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
            >
              <option value="">Select…</option>
              {targetOptions.map((id) => (
                <option key={id} value={id}>
                  {id} — {resolveCountryName(id)}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label
                className="mb-1 block text-xs font-medium text-muted"
                htmlFor={`emb-commodity-${i}`}
              >
                Commodity
              </label>
              <select
                id={`emb-commodity-${i}`}
                value={row.commodity}
                onChange={(e) =>
                  updateRow(i, {
                    commodity: e.target.value as EmbargoProvisionInput["commodity"],
                  })
                }
                className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
              >
                <option value="all">All commodities</option>
                {COMMODITY_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {COMMODITY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                className="mb-1 block text-xs font-medium text-muted"
                htmlFor={`emb-direction-${i}`}
              >
                Direction
              </label>
              <select
                id={`emb-direction-${i}`}
                value={row.direction}
                onChange={(e) =>
                  updateRow(i, {
                    direction: e.target.value as EmbargoProvisionInput["direction"],
                  })
                }
                className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
              >
                <option value="both">Both ways</option>
                <option value="export">Our exports to them</option>
                <option value="import">Their imports to us</option>
              </select>
            </div>
          </div>

          {row.action === "embargo" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  className="mb-1 block text-xs font-medium text-muted"
                  htmlFor={`emb-mode-${i}`}
                >
                  Restriction
                </label>
                <select
                  id={`emb-mode-${i}`}
                  value={row.mode}
                  onChange={(e) =>
                    updateRow(i, {
                      mode: e.target.value as EmbargoProvisionInput["mode"],
                      ...(e.target.value === "block" ? { cap: undefined } : {}),
                    })
                  }
                  className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
                >
                  <option value="block">Block (stop the flow)</option>
                  <option value="cap">Cap (limit the flow)</option>
                </select>
              </div>

              {row.mode === "cap" && (
                <div>
                  <label
                    className="mb-1 block text-xs font-medium text-muted"
                    htmlFor={`emb-cap-${i}`}
                  >
                    Cap (units)
                  </label>
                  <input
                    id={`emb-cap-${i}`}
                    type="number"
                    min={0}
                    step={1000}
                    value={row.cap ?? ""}
                    onChange={(e) =>
                      updateRow(i, {
                        cap: e.target.value === "" ? undefined : Number(e.target.value),
                      })
                    }
                    className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-right font-mono text-sm"
                    placeholder="0"
                  />
                </div>
              )}
            </div>
          )}

          <p className="text-[11px] italic text-muted/60">
            {row.action === "end_embargo"
              ? "Repeals a matching legislated embargo on this country, commodity, and direction."
              : row.mode === "cap"
                ? "Caps the directed flow at the unit limit above; trade beyond it is cut."
                : "Blocks the directed flow entirely while this law stands."}
          </p>
        </div>
      ))}

      <button
        type="button"
        onClick={addRow}
        disabled={rows.length >= MAX_PROVISIONS}
        className="w-full rounded-lg border border-dashed border-purple-500/40 bg-purple-500/10 px-3 py-2 text-xs font-medium text-purple-200 hover:bg-purple-500/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        + Add another embargo provision
      </button>
    </div>
  );
}
