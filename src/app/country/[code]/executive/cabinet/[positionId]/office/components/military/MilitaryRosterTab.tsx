"use client";

import { useMemo, useState } from "react";
import type { MilitaryUnitView } from "../../useCabinetOffice";
import type { CommanderRef } from "@/lib/military/types";
import { getBranches, absorbedBranchesOf } from "@/lib/constants/military";
import { AggTile, MilIcon, domainIcon, fmtUpkeepMoney } from "./militaryUi";
import { ARREARS_READINESS_WEIGHT } from "@/lib/military/readinessDrift";
import { UnitCard } from "./UnitCard";
import { RecruitPanel } from "./RecruitPanel";

export function MilitaryRosterTab({
  countryCode,
  countryId,
  positionId,
  units,
  commanders,
  canAct,
  currencySymbol,
  gdp,
  baselineGdp,
  hasBudget,
  appropriation,
  appropriationNetPerTurn,
  arrearsRatio,
  upkeepPerIndexUnit,
  manpowerPool,
  onUpdate,
  liveYear = null,
}: {
  countryCode: string;
  countryId: string;
  positionId: string;
  units: MilitaryUnitView[];
  commanders: CommanderRef[];
  canAct: boolean;
  currencySymbol: string;
  /** National GDP, same units as the appropriation; null blocks recruitment. */
  gdp: number | null;
  /** GDP prices are anchored to; null = price off live GDP. */
  baselineGdp: number | null;
  /** False when the country has no federalBudget row for this era at all. */
  hasBudget: boolean;
  /** Defence account balance — what procurement is actually paid from. */
  appropriation: number;
  /** Accrual minus standing upkeep; <= 0 means the account is not growing. */
  appropriationNetPerTurn: number;
  /** 0..1 unfunded share of upkeep; > 0 suppresses readiness. */
  arrearsRatio: number;
  /** Real money per unit of the abstract upkeep index — see `fmtUpkeepMoney`. */
  upkeepPerIndexUnit: number;
  /** Recruitable manpower pool; undefined disables the manpower gate. */
  manpowerPool?: number;
  onUpdate: () => void;
  /** Live in-game year for era-gated branches (null = modern catalog). */
  liveYear?: number | null;
}) {
  // Branch tabs from the country's own catalog PLUS any absorbed branch a merge
  // carried in (units whose branchId the catalog does not name). Without the
  // second list, a unified Germany's inherited NVA formations have no tab to
  // render under and read as deleted.
  const branches = [
    ...getBranches(countryId, liveYear),
    ...absorbedBranchesOf(countryId, units),
  ];
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [recruiting, setRecruiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const branch = branches.find((b) => b.id === branchId) ?? branches[0];
  // True only when the active tab is one of the country's OWN branches — the
  // recruit button (and its panel) render for those alone.
  const catalogHasBranch =
    !!branch && getBranches(countryId, liveYear).some((b) => b.id === branch.id);
  const basePath = `/api/country/${countryCode}/executive/cabinet/${positionId}/military`;

  const branchUnits = useMemo(
    () => units.filter((u) => u.branchId === branchId),
    [units, branchId]
  );

  async function act(method: "POST" | "DELETE", path: string, body?: unknown) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        // Recruit/upgrade/disband refuse for reasons the roster cannot show —
        // budget, manpower, branch caps, a lost seat. Silence would read as a
        // dead button.
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        setActionError(payload?.error ?? "That order was refused.");
        return;
      }
      onUpdate();
    } catch {
      setActionError("That order could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  const bPower = branchUnits.reduce((s, u) => s + u.effectivePower, 0);
  const bPers = branchUnits.reduce((s, u) => s + u.personnel, 0);
  const bUpkeep = branchUnits.reduce((s, u) => s + u.effectiveUpkeep, 0);
  const bReady = branchUnits.length
    ? Math.round(branchUnits.reduce((s, u) => s + u.readiness, 0) / branchUnits.length)
    : 0;

  if (!branch) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 text-center text-[13px] text-muted">
        No branches configured.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {actionError && (
        <p role="alert" className="text-[11px] text-error">
          {actionError}
        </p>
      )}
      {/* branch sub-tabs */}
      <div className="rounded-xl border border-card-border bg-card p-2">
        <div className="flex flex-wrap gap-1.5">
          {branches.map((b) => {
            const active = branchId === b.id;
            const count = units.filter((u) => u.branchId === b.id).length;
            return (
              <button
                key={b.id}
                onClick={() => {
                  setBranchId(b.id);
                  setRecruiting(false);
                }}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-semibold ${
                  active ? "text-black" : "bg-card-muted text-muted hover:text-foreground"
                }`}
                style={active ? { background: "var(--gov)" } : undefined}
              >
                <MilIcon name={domainIcon(b.domain)} className="h-4 w-4" />
                <span>{b.name}</span>
                <span
                  className={`rounded-full px-1.5 text-[10px] ${active ? "bg-black/20" : "bg-card-border"}`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* branch aggregate */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <AggTile label="Combat power" value={bPower.toLocaleString("en-US")} tone="gov" />
        <AggTile label="Personnel" value={`${(bPers / 1000).toFixed(1)}K`} />
        <AggTile label="Avg readiness" value={`${bReady}%`} ring={bReady} />
        <AggTile
          label="Upkeep / turn"
          value={fmtUpkeepMoney(currencySymbol, bUpkeep, upkeepPerIndexUnit)}
        />
      </div>

      {/*
        Arrears detail only. The appropriation BALANCE lives in the masthead force strip
        (CabinetForceStrip) beside Available manpower — one number, one place. What the
        strip has no room for is the consequence, which is what a minister needs here.
      */}
      {arrearsRatio > 0 && (
        <div className="rounded-xl border border-[color-mix(in_srgb,var(--error)_40%,transparent)] bg-[color-mix(in_srgb,var(--error)_8%,transparent)] p-3 text-[12px] text-foreground">
          The defence appropriation could not fund {Math.round(arrearsRatio * 100)}% of this
          force&apos;s upkeep. Readiness is settling toward a baseline{" "}
          {Math.round(arrearsRatio * ARREARS_READINESS_WEIGHT * 100)}% lower than each unit&apos;s
          posture would otherwise hold, and will recover as soon as the account is funded.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{branch.name} · order of battle</h2>
        <div className="flex flex-wrap items-center gap-2">
          {canAct && commanders.length > 0 && branchUnits.length > 0 && (
            <select
              aria-label={`Assign all ${branch.name} units to a general`}
              disabled={busy}
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                act("POST", `${basePath}/assign-branch`, {
                  branchId: branch.id,
                  assignedGeneralId: v === "__staff__" ? null : v,
                });
              }}
              className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-[12px] text-foreground disabled:opacity-50"
            >
              <option value="">Assign entire {branch.name}…</option>
              {commanders.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.spec}
                </option>
              ))}
              <option value="__staff__">General Staff (unassigned)</option>
            </select>
          )}
          {/* Recruit only into the country's own services. An absorbed branch has no
              establishment on the survivor's books — recruiting into it would mint
              formations the recruit route's own catalog check would refuse. */}
          {catalogHasBranch && (
            <button
              onClick={() => setRecruiting(true)}
              disabled={!canAct || busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--gov)_40%,transparent)] bg-[color-mix(in_srgb,var(--gov)_10%,transparent)] px-3 py-1.5 text-[12px] font-semibold text-gov-soft hover:bg-[color-mix(in_srgb,var(--gov)_20%,transparent)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Recruit unit
            </button>
          )}
        </div>
      </div>

      {recruiting && (
        <RecruitPanel
          branch={branch}
          currencySymbol={currencySymbol}
          busy={busy}
          liveYear={liveYear}
          countryId={countryId}
          gdp={gdp}
          baselineGdp={baselineGdp}
          hasBudget={hasBudget}
          appropriation={appropriation}
          appropriationNetPerTurn={appropriationNetPerTurn}
          manpowerPool={manpowerPool}
          onCancel={() => setRecruiting(false)}
          onRecruit={(type, name) => {
            setRecruiting(false);
            act("POST", `${basePath}/recruit`, { branchId: branch.id, type, name });
          }}
        />
      )}

      <div className="space-y-2.5">
        {branchUnits.length === 0 && (
          <div className="rounded-xl border border-card-border bg-card p-6 text-center text-[13px] text-muted">
            No active units in this branch. Recruit one to begin.
          </div>
        )}
        {branchUnits.map((u) => (
          <UnitCard
            key={u._id}
            unit={u}
            basePath={basePath}
            countryId={countryId}
            commanders={commanders}
            canAct={canAct}
            currencySymbol={currencySymbol}
            upkeepPerIndexUnit={upkeepPerIndexUnit}
            gdp={gdp}
            baselineGdp={baselineGdp}
            busy={busy}
            onAction={act}
          />
        ))}
      </div>
    </div>
  );
}
