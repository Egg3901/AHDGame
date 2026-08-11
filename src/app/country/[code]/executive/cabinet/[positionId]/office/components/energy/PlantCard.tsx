"use client";

import { useState } from "react";
import type { PlantView } from "../../useCabinetOffice";
import { TIER_LABELS } from "@/lib/constants/cabinetEnergy";
import { Stat, EnergyIcon, ConfirmDialog, fmtMoneyM, fmtCapacity } from "./energyUi";

const TIER_COLOR = ["#94a3b8", "#c9a24b", "#4ade80", "#22d3ee"];

export function PlantCard({
  plant,
  basePath,
  canAct,
  currencySymbol,
  regionName,
  busy,
  onAction,
}: {
  plant: PlantView;
  basePath: string;
  canAct: boolean;
  currencySymbol: string;
  regionName: string;
  busy: boolean;
  onAction: (method: "POST" | "DELETE", path: string, body?: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border border-card-border bg-card">
      <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--gov)_12%,transparent)] text-gov-soft">
            <EnergyIcon name={plant.icon} className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-foreground">{plant.name}</span>
              <span
                className="rounded border px-1.5 py-0.5 text-[10px] font-semibold"
                style={{
                  borderColor: TIER_COLOR[plant.tier] + "66",
                  color: TIER_COLOR[plant.tier],
                  background: TIER_COLOR[plant.tier] + "1a",
                }}
              >
                {TIER_LABELS[plant.tier]}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
              <span>{fmtCapacity(plant.capacityBase)} base</span>
              <span>·</span>
              <span>{regionName}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:w-[200px] lg:shrink-0">
          <Stat label="Capacity" value={fmtCapacity(plant.effectiveCapacity)} tone="gov" />
          <Stat label="Upkeep" value={fmtMoneyM(currencySymbol, plant.effectiveUpkeep)} />
        </div>

        <button
          onClick={() => setOpen(!open)}
          className="shrink-0 self-start rounded-lg border border-card-border bg-card-muted px-3 py-1.5 text-[12px] font-semibold text-muted hover:text-foreground lg:self-auto"
        >
          {open ? "Close" : "Manage"}
        </button>
      </div>

      {open && (
        <div className="border-t border-card-border bg-card-muted p-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="dossier-label mb-2 text-muted">Expand capacity</div>
              {plant.tier >= 3 ? (
                <div className="rounded-lg border border-card-border bg-card px-3 py-2 text-[12px] text-success">
                  ✓ Maximum capacity
                </div>
              ) : (
                <button
                  disabled={!canAct || busy}
                  onClick={() => onAction("POST", `${basePath}/${plant._id}/upgrade`)}
                  className="w-full rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-[12px] font-semibold text-success hover:bg-success/20 disabled:opacity-50"
                >
                  Upgrade → {TIER_LABELS[plant.tier + 1]} · 1 action
                </button>
              )}
            </div>

            <div>
              <div className="dossier-label mb-2 text-muted">Retire</div>
              <button
                disabled={!canAct || busy}
                onClick={() => setConfirmRetire(true)}
                className="w-full rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-[12px] font-semibold text-error hover:bg-error/20 disabled:opacity-50"
              >
                Retire plant
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmRetire}
        title="Retire plant"
        confirmLabel="Retire"
        body={
          <>
            Permanently retire <span className="font-semibold text-foreground">{plant.name}</span>?
            This frees its upkeep and removes its capacity from the grid.
          </>
        }
        onCancel={() => setConfirmRetire(false)}
        onConfirm={() => {
          setConfirmRetire(false);
          onAction("DELETE", `${basePath}/${plant._id}`);
        }}
      />
    </div>
  );
}
