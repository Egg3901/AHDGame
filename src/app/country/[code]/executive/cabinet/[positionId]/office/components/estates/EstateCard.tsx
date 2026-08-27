"use client";

import { useState } from "react";
import type { EstateView } from "../../useCabinetOffice";
import { FUNDING_LEVELS, TIER_LABELS, getEstateArchetype } from "@/lib/constants/cabinetEstates";
import { Stat, EstateIcon, ConfirmDialog, fmtMoneyM } from "./estatesUi";
// The tab above these cards carries the explanation; a note on every card would
// only repeat it. The lock still reaches here so the card's own buttons disable.
import { useActingLock } from "../ActingLock";

const TIER_COLOR = ["#94a3b8", "#c9a24b", "#4ade80", "#22d3ee"];

export function EstateCard({
  estate,
  basePath,
  canAct: canActProp,
  currencySymbol,
  siteLabel,
  busy,
  onAction,
}: {
  estate: EstateView;
  basePath: string;
  canAct: boolean;
  currencySymbol: string;
  siteLabel: string;
  busy: boolean;
  onAction: (method: "POST" | "DELETE", path: string, body?: unknown) => void;
}) {
  // An acting secretary reads this surface but does not move it.
  const actingLockReason = useActingLock("assets");
  const canAct = canActProp && !actingLockReason;

  const [open, setOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const condTone = estate.condition >= 70 ? "up" : estate.condition >= 50 ? "warning" : "down";
  const archetype = getEstateArchetype(estate.portfolioKey, estate.archetypeId);

  return (
    <div className="overflow-hidden rounded-xl border border-card-border bg-card">
      <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--gov)_12%,transparent)] text-gov-soft">
            <EstateIcon name={estate.icon} className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-foreground">{estate.name}</span>
              <span
                className="rounded border px-1.5 py-0.5 text-[10px] font-semibold"
                style={{
                  borderColor: TIER_COLOR[estate.tier] + "66",
                  color: TIER_COLOR[estate.tier],
                  background: TIER_COLOR[estate.tier] + "1a",
                }}
              >
                {TIER_LABELS[estate.tier]}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
              <span>{FUNDING_LEVELS.find((f) => f.id === estate.fundingLevel)?.label}</span>
              <span>·</span>
              <span>{estate.outputBase.toLocaleString("en-US")} cap.</span>
              <span>·</span>
              <span>{siteLabel}</span>
            </div>
            {archetype && (
              <p className="mt-1 text-[11px] leading-snug text-muted">{archetype.description}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 lg:w-[280px] lg:shrink-0">
          <Stat label="Output" value={estate.effectiveOutput.toLocaleString("en-US")} tone="gov" />
          <Stat label="Condition" value={`${estate.condition}%`} tone={condTone} />
          <Stat label="Upkeep" value={fmtMoneyM(currencySymbol, estate.effectiveUpkeep)} />
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
          <div className="grid gap-4 lg:grid-cols-3">
            <div>
              <div className="dossier-label mb-2 text-muted">Funding</div>
              <div className="space-y-1.5">
                {FUNDING_LEVELS.map((f) => (
                  <button
                    key={f.id}
                    disabled={!canAct || busy}
                    onClick={() =>
                      onAction("POST", `${basePath}/${estate._id}/fund`, { fundingLevel: f.id })
                    }
                    className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 text-left text-[12px] disabled:opacity-50 ${
                      estate.fundingLevel === f.id
                        ? "border-[var(--gov)] bg-[color-mix(in_srgb,var(--gov)_10%,transparent)] text-gov-soft"
                        : "border-card-border bg-card text-muted hover:text-foreground"
                    }`}
                  >
                    <span className="font-medium">{f.label}</span>
                    <span className="text-[10px] opacity-70">{f.upkeepMult}× cost</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="dossier-label mb-2 text-muted">Expand</div>
              {estate.tier >= 3 ? (
                <div className="rounded-lg border border-card-border bg-card px-3 py-2 text-[12px] text-success">
                  ✓ Flagship tier
                </div>
              ) : (
                <button
                  disabled={!canAct || busy}
                  onClick={() => onAction("POST", `${basePath}/${estate._id}/expand`)}
                  className="w-full rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-[12px] font-semibold text-success hover:bg-success/20 disabled:opacity-50"
                >
                  Expand → {TIER_LABELS[estate.tier + 1]} · 1 action
                </button>
              )}
            </div>

            <div>
              <div className="dossier-label mb-2 text-muted">Close</div>
              <button
                disabled={!canAct || busy}
                onClick={() => setConfirmClose(true)}
                className="w-full rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-[12px] font-semibold text-error hover:bg-error/20 disabled:opacity-50"
              >
                Close facility
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmClose}
        title="Close facility"
        confirmLabel="Close"
        body={
          <>
            Permanently close <span className="font-semibold text-foreground">{estate.name}</span>?
            This frees its upkeep and cannot be undone.
          </>
        }
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false);
          onAction("DELETE", `${basePath}/${estate._id}`);
        }}
      />
    </div>
  );
}
