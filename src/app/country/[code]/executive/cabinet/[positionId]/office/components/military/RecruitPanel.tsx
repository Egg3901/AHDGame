"use client";

import { useState } from "react";
import { getUnitTypesForYear, type Branch } from "@/lib/constants/military";
import { unitPurchasePrice } from "@/lib/military/procurement";
import { MilIcon, fmtMoneyAbs, fmtMoneySigned } from "./militaryUi";

export function RecruitPanel({
  branch,
  currencySymbol,
  busy,
  liveYear = null,
  countryId,
  gdp,
  baselineGdp,
  hasBudget,
  appropriation,
  appropriationNetPerTurn,
  manpowerPool,
  onRecruit,
  onCancel,
}: {
  branch: Branch;
  currencySymbol: string;
  busy: boolean;
  /** Live in-game year for era-gated unit archetypes (null = all types). */
  liveYear?: number | null;
  countryId: string;
  /** National GDP, same units as the appropriation. null => price unknown, block. */
  gdp: number | null;
  /** GDP prices are anchored to; null = price off live GDP (pre-anchor behaviour). */
  baselineGdp: number | null;
  /** False when the country has no federalBudget row for this era at all. */
  hasBudget: boolean;
  /** Defence account balance. Procurement is paid from this, never the treasury. */
  appropriation: number;
  /** Accrual minus standing upkeep. <= 0 means the account is not growing. */
  appropriationNetPerTurn: number;
  /** Recruitable manpower; undefined disables the gate rather than blocking. */
  manpowerPool?: number;
  onRecruit: (type: string, name: string) => void;
  onCancel: () => void;
}) {
  const types = getUnitTypesForYear(branch.domain, liveYear);
  const [sel, setSel] = useState(types[0]?.type ?? "");
  const [name, setName] = useState("");
  const archetype = types.find((t) => t.type === sel) ?? types[0];

  if (!archetype) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-4 text-[13px] text-muted">
        No unit types available for this branch in the current year.
      </div>
    );
  }

  // Computed BELOW the `if (!archetype)` guard — above it `archetype` is
  // `UnitArchetype | undefined` and unitPurchasePrice would be a type error.
  const price = unitPurchasePrice(archetype, countryId, gdp, baselineGdp);
  const manpowerShort = manpowerPool != null && manpowerPool < archetype.personnel;
  // A null price means the country has no usable GDP. The server refuses with
  // 409; the panel must not render a 0 or a free unit.
  const priceUnknown = price == null;
  // Procurement has no overdraft — the balance must cover the price outright, which is
  // the same rule `debitAppropriation`'s $gte guard enforces server-side.
  const appropriationShort = price != null && appropriation < price;
  // Only meaningful while the account is actually growing. A force in arrears has a
  // negative net, and "affordable in −3 turns" is worse than saying nothing.
  const turnsUntilAffordable =
    appropriationShort && appropriationNetPerTurn > 0
      ? Math.ceil((price - appropriation) / appropriationNetPerTurn)
      : null;

  return (
    <div className="rounded-xl border border-[color-mix(in_srgb,var(--gov)_30%,transparent)] bg-card p-4 gov-glow">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Recruit a new {branch.name} unit</h3>
        <button onClick={onCancel} className="text-[12px] text-muted hover:text-foreground">
          Cancel
        </button>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <div className="dossier-label mb-1.5 text-muted">Unit type</div>
          <div className="grid gap-1.5">
            {types.map((ty) => (
              <button
                key={ty.type}
                onClick={() => setSel(ty.type)}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left ${
                  sel === ty.type
                    ? "border-[var(--gov)] bg-[color-mix(in_srgb,var(--gov)_10%,transparent)]"
                    : "border-card-border bg-card-muted hover:border-[color-mix(in_srgb,var(--gov)_40%,transparent)]"
                }`}
              >
                <span className="flex items-center gap-2">
                  <MilIcon name={ty.icon} className="h-4 w-4 text-gov-soft" />
                  <span className="text-[12px] font-medium text-foreground">{ty.type}</span>
                </span>
                <span className="tabular text-[11px] text-muted">{ty.power} pwr</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col">
          <div className="dossier-label mb-1.5 text-muted">Designation</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. 3rd Vanguard"
            className="rounded-lg border border-card-border bg-card-muted px-3 py-2 text-[13px] text-foreground outline-none focus:border-[var(--gov)]"
          />
          <div className="mt-3 rounded-lg border border-card-border bg-card-muted p-3 text-[12px]">
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Build cost</span>
              <span className="tabular font-semibold text-foreground">
                {price == null ? "—" : fmtMoneyAbs(currencySymbol, price)}
              </span>
            </div>
            <div className="pb-1 text-[11px] text-muted">
              One-time draw on the defence appropriation — not recurring upkeep.
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Appropriation after</span>
              <span
                className={`tabular ${appropriationShort ? "text-[var(--error)]" : "text-foreground"}`}
              >
                {price == null ? "—" : fmtMoneySigned(currencySymbol, appropriation - price)}
              </span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Personnel</span>
              <span
                className={`tabular ${manpowerShort ? "text-[var(--error)]" : "text-foreground"}`}
              >
                {archetype.personnel.toLocaleString("en-US")}
              </span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-muted">Combat power</span>
              <span className="tabular font-semibold text-gov-soft">{archetype.power}</span>
            </div>
          </div>

          {priceUnknown && (
            <div className="mt-2 text-[11px] text-[var(--error)]">
              {hasBudget
                ? "This country has no usable GDP figure, so a price cannot be computed. Recruitment is unavailable."
                : "This country has no national budget in this era, so units cannot be funded. Recruitment is unavailable."}
            </div>
          )}

          {appropriationShort && !priceUnknown && (
            <div className="mt-2 rounded-lg border border-[color-mix(in_srgb,var(--error)_40%,transparent)] bg-[color-mix(in_srgb,var(--error)_8%,transparent)] p-2 text-[11px] text-foreground">
              Defence appropriation is short by {fmtMoneyAbs(currencySymbol, price - appropriation)}
              . New orders cannot be financed by borrowing — the overdraft covers upkeep only.
              {turnsUntilAffordable != null
                ? ` Affordable in ${turnsUntilAffordable} turn${turnsUntilAffordable === 1 ? "" : "s"} at the current rate.`
                : " This account is not growing; raise the defence budget or cut the standing force."}
            </div>
          )}

          {manpowerShort && (
            <div className="mt-2 text-[11px] text-[var(--error)]">
              Insufficient manpower — {archetype.personnel.toLocaleString("en-US")} required,{" "}
              {(manpowerPool ?? 0).toLocaleString("en-US")} available.
            </div>
          )}
          <button
            disabled={busy || manpowerShort || priceUnknown || appropriationShort}
            onClick={() => onRecruit(sel, name.trim() || "New")}
            className="mt-3 w-full rounded-lg py-2 text-[13px] font-semibold text-black disabled:opacity-50"
            style={{ background: "var(--gov)" }}
          >
            Authorize recruitment · 1 action
          </button>
        </div>
      </div>
    </div>
  );
}
