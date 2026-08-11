"use client";

import { useState } from "react";
import type { MilitaryUnitView } from "../../useCabinetOffice";
import type { CommanderRef } from "@/lib/military/types";
import type { UnitDomain } from "@/lib/db/types/militaryUnit";
import { isAtConflict } from "@/lib/military/theaters";
import { POSTURES, TECH_TIERS, TECH_UPKEEP_MULT, getUnitArchetype } from "@/lib/constants/military";
import { unitUpgradePrice } from "@/lib/military/procurement";
import { strengthPct } from "@/lib/military/strength";
import { Stat, MilIcon, ConfirmDialog, fmtMoneyM, fmtUpkeepMoney } from "./militaryUi";

const TECH_COLOR = ["#94a3b8", "#c9a24b", "#4ade80", "#22d3ee"];
const VET_LABEL = ["Green", "Regular", "Seasoned", "Veteran", "Elite"];
const VET_COLOR = ["#8a8a9a", "#94a3b8", "#4ade80", "#22d3ee", "#c084fc"];

export function UnitCard({
  unit,
  basePath,
  countryId,
  commanders,
  canAct,
  currencySymbol,
  upkeepPerIndexUnit,
  gdp,
  baselineGdp,
  busy,
  onAction,
}: {
  unit: MilitaryUnitView;
  basePath: string;
  countryId: string;
  commanders: CommanderRef[];
  canAct: boolean;
  currencySymbol: string;
  /** Real money per unit of the abstract upkeep index — see `fmtUpkeepMoney`. */
  upkeepPerIndexUnit: number;
  /** National GDP, same units as the appropriation. null => upgrade price unknown. */
  gdp: number | null;
  /**
   * GDP prices are anchored to; null = price off live GDP. MUST be passed through to
   * `unitUpgradePrice` — the server charges against the same anchor, so omitting it here
   * would make the quoted price drift from the bill as soon as a world's GDP moves.
   */
  baselineGdp: number | null;
  busy: boolean;
  onAction: (method: "POST" | "DELETE", path: string, body?: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDisband, setConfirmDisband] = useState(false);
  const readyTone = unit.readiness >= 70 ? "up" : unit.readiness >= 50 ? "warning" : "down";
  // Personnel scales combat power linearly, so a hollowed-out formation must read as
  // weak at a glance. Null = unknown archetype; show the raw headcount instead.
  const strength = strengthPct(unit);
  const strengthTone =
    strength === null || strength >= 70
      ? "text-muted"
      : strength >= 40
        ? "text-warning"
        : "text-error";
  const assignedTo = commanders.find((c) => c.id === unit.assignedGeneralId) ?? null;

  // Modernising costs cash up front and more upkeep forever. Both are shown on the
  // button rather than discovered afterwards — the price is computed with the same pure
  // helper the server charges with, so the quote cannot drift from the bill.
  const nextTier = unit.techTier + 1;
  // `MilitaryUnitView.domain` is a plain string over the wire; an unrecognised one
  // resolves to no archetype and the button reports the price as unavailable.
  const archetype = getUnitArchetype(unit.domain as UnitDomain, unit.type);
  const upgradePrice =
    nextTier <= 3 && archetype
      ? unitUpgradePrice(archetype, countryId, gdp, nextTier as 1 | 2 | 3, baselineGdp)
      : null;
  // effectiveUpkeep already carries this unit's current tech multiplier, so the next
  // tier is a ratio of the two rather than a re-derivation of the whole formula.
  const nextTierUpkeep = Math.round(
    (unit.effectiveUpkeep * (TECH_UPKEEP_MULT[nextTier] ?? 1)) /
      (TECH_UPKEEP_MULT[unit.techTier] ?? 1)
  );
  // Absolute currency, not millions — the upgrade price is in the same units as the
  // defence appropriation it is charged against (both derive from the budget's own gdp).
  const fmtMoney = (v: number) => fmtMoneyM(currencySymbol, v / 1e6);
  // A unit deployed to a Conflict cannot be Garrisoned — it holds at least Standard.
  const deployed = isAtConflict(unit.theaterId);

  return (
    <div className="overflow-hidden rounded-xl border border-card-border bg-card">
      <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--gov)_12%,transparent)] text-gov-soft">
            <MilIcon name={unit.icon} className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-foreground">{unit.name}</span>
              <span
                className="rounded border px-1.5 py-0.5 text-[10px] font-semibold"
                style={{
                  borderColor: TECH_COLOR[unit.techTier] + "66",
                  color: TECH_COLOR[unit.techTier],
                  background: TECH_COLOR[unit.techTier] + "1a",
                }}
              >
                {TECH_TIERS[unit.techTier]}
              </span>
              <span
                className="rounded border px-1.5 py-0.5 text-[10px] font-semibold"
                style={{
                  borderColor: VET_COLOR[unit.vet] + "66",
                  color: VET_COLOR[unit.vet],
                  background: VET_COLOR[unit.vet] + "1a",
                }}
              >
                {VET_LABEL[unit.vet]}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
              <span>{POSTURES.find((p) => p.id === unit.posture)?.label}</span>
              <span>·</span>
              <span className={strengthTone}>
                {unit.personnel.toLocaleString("en-US")} pers.
                {strength !== null && ` · ${strength}% strength`}
              </span>
              <span>·</span>
              <span title="Firepower / Protection / Support">
                EQP {unit.equipment.firepower}/{unit.equipment.protection}/{unit.equipment.support}
              </span>
              <span>·</span>
              <span>
                {assignedTo ? `Assigned · ${assignedTo.name}` : "General Staff · unassigned"}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 lg:w-[280px] lg:shrink-0">
          <Stat label="Power" value={unit.effectivePower} tone="gov" />
          <Stat label="Readiness" value={`${unit.readiness}%`} tone={readyTone} />
          <Stat
            label="Upkeep / turn"
            value={fmtUpkeepMoney(currencySymbol, unit.effectiveUpkeep, upkeepPerIndexUnit)}
          />
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
          <div className="mb-4">
            <div className="dossier-label mb-2 text-muted">Assign to</div>
            <select
              aria-label={`Assign ${unit.name} to a general`}
              disabled={!canAct || busy}
              value={unit.assignedGeneralId ?? ""}
              onChange={(e) =>
                onAction("POST", `${basePath}/${unit._id}/assign`, {
                  assignedGeneralId: e.target.value || null,
                })
              }
              className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-[12px] text-foreground disabled:opacity-50"
            >
              <option value="">General Staff (unassigned)</option>
              {commanders.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.spec}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted">
              The unit deploys wherever its general is posted.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div>
              <div className="dossier-label mb-2 text-muted">Posture</div>
              <div className="space-y-1.5">
                {POSTURES.map((p) => {
                  const blockedGarrison = deployed && p.id === "garrison";
                  return (
                    <button
                      key={p.id}
                      disabled={!canAct || busy || blockedGarrison}
                      title={
                        blockedGarrison
                          ? "Units deployed to a conflict must hold at least Standard posture"
                          : undefined
                      }
                      onClick={() =>
                        onAction("POST", `${basePath}/${unit._id}/posture`, { posture: p.id })
                      }
                      className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 text-left text-[12px] disabled:opacity-50 ${
                        unit.posture === p.id
                          ? "border-[var(--gov)] bg-[color-mix(in_srgb,var(--gov)_10%,transparent)] text-gov-soft"
                          : "border-card-border bg-card text-muted hover:text-foreground"
                      }`}
                    >
                      <span className="font-medium">{p.label}</span>
                      <span className="text-[10px] opacity-70">{p.upkeepMult}× cost</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="dossier-label mb-2 text-muted">Modernize</div>
              {unit.techTier >= 3 ? (
                <div className="rounded-lg border border-card-border bg-card px-3 py-2 text-[12px] text-success">
                  ✓ Cutting-edge
                </div>
              ) : (
                <>
                  <button
                    disabled={!canAct || busy || upgradePrice == null}
                    title={
                      upgradePrice == null
                        ? "No usable GDP figure for this country — modernisation is unavailable"
                        : undefined
                    }
                    onClick={() => onAction("POST", `${basePath}/${unit._id}/upgrade`)}
                    className="w-full rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-[12px] font-semibold text-success hover:bg-success/20 disabled:opacity-50"
                  >
                    Upgrade → {TECH_TIERS[unit.techTier + 1]} ·{" "}
                    {upgradePrice == null ? "price unavailable" : fmtMoney(upgradePrice)} · 1 action
                  </button>
                  {/* Modernising is not free to keep, either — say so before the click,
                      not after the next turn's budget report. */}
                  <p className="mt-1.5 text-[11px] text-muted">
                    Upkeep{" "}
                    {fmtUpkeepMoney(currencySymbol, unit.effectiveUpkeep, upkeepPerIndexUnit)} →{" "}
                    {fmtUpkeepMoney(currencySymbol, nextTierUpkeep, upkeepPerIndexUnit)}/turn
                  </p>
                </>
              )}
            </div>

            <div>
              <div className="dossier-label mb-2 text-muted">Decommission</div>
              <button
                disabled={!canAct || busy}
                onClick={() => setConfirmDisband(true)}
                className="w-full rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-[12px] font-semibold text-error hover:bg-error/20 disabled:opacity-50"
              >
                Disband unit
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDisband}
        title="Disband unit"
        confirmLabel="Disband"
        body={
          <>
            Permanently disband <span className="font-semibold text-foreground">{unit.name}</span>?
            This frees its upkeep and cannot be undone.
          </>
        }
        onCancel={() => setConfirmDisband(false)}
        onConfirm={() => {
          setConfirmDisband(false);
          onAction("DELETE", `${basePath}/${unit._id}`);
        }}
      />
    </div>
  );
}
