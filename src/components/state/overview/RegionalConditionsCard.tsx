"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { CountryId } from "@/lib/constants/countries";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";
import { prioritizeModifiers } from "@/lib/utils/approvalModifiers";
import { regionApprovalUrl } from "@/lib/urls";
import { computeRegionalConditionMargin } from "@/lib/states/conditions/marginEffects";

/** Overview shows the highest-impact drivers; the rest live on the full page. */
const OVERVIEW_HEADLINE_MAX = 6;

function approvalColor(v: number) {
  return v >= 50 ? "text-success" : v >= 40 ? "text-warning" : "text-error";
}

function signed(n: number, suffix = ""): string {
  return `${n > 0 ? "+" : ""}${n}${suffix}`;
}

function toneClass(n: number, kind: "text" | "bg" | "fill"): string {
  if (n > 0) {
    if (kind === "text") return "text-success";
    if (kind === "bg") return "bg-success";
    return "bg-success/80";
  }
  if (n < 0) {
    if (kind === "text") return "text-error";
    if (kind === "bg") return "bg-error";
    return "bg-error/80";
  }
  return kind === "text" ? "text-muted" : "bg-muted";
}

function marginForModifier(modifier: ActiveModifier): number | null {
  if (modifier.source === "address" || modifier.source === "war") return null;
  if (modifier.marginEffect === 0) return null;
  return modifier.marginEffect ?? null;
}

/**
 * Split active modifiers into opposing political forces for the balance viz.
 * Pure helper — kept here so the card and tests share one definition.
 */
export function splitConditionForces(modifiers: ActiveModifier[]): {
  tailwinds: ActiveModifier[];
  headwinds: ActiveModifier[];
  boostTotal: number;
  dragTotal: number;
} {
  // The war block is national and can reach into the twenties. It has no
  // business in a regional balance bar: it would dominate the viz and read as
  // though one region were carrying a country-wide effect.
  const regional = modifiers.filter((m) => m.source !== "war");
  const tailwinds = regional.filter((m) => m.effect > 0);
  const headwinds = regional.filter((m) => m.effect < 0);
  return {
    tailwinds,
    headwinds,
    boostTotal: tailwinds.reduce((s, m) => s + m.effect, 0),
    dragTotal: headwinds.reduce((s, m) => s + m.effect, 0),
  };
}

function ForceBalanceBar({ boostTotal, dragTotal }: { boostTotal: number; dragTotal: number }) {
  const boostAbs = Math.abs(boostTotal);
  const dragAbs = Math.abs(dragTotal);
  const total = boostAbs + dragAbs;
  const boostPct = total > 0 ? (boostAbs / total) * 100 : 50;
  const dragPct = total > 0 ? (dragAbs / total) * 100 : 50;

  return (
    <div className="space-y-2" aria-hidden="true">
      <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-wider">
        <span className="font-semibold text-success">Tailwinds {signed(boostTotal)}</span>
        <span className="font-semibold text-error">Headwinds {signed(dragTotal)}</span>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-sm bg-track">
        <div
          className="bg-success transition-[width] duration-500 ease-out"
          style={{ width: `${boostPct}%` }}
        />
        <div
          className="bg-error transition-[width] duration-500 ease-out"
          style={{ width: `${dragPct}%` }}
        />
      </div>
    </div>
  );
}

function ApprovalMeter({
  approval,
  baseApproval,
}: {
  approval: number;
  baseApproval: number | null | undefined;
}) {
  const clamped = Math.max(0, Math.min(100, approval));
  const delta = baseApproval != null ? approval - baseApproval : null;

  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted">Approval</div>
          <div
            className={`text-3xl font-bold tabular-nums leading-none ${approvalColor(approval)}`}
          >
            {approval.toFixed(1)}%
          </div>
        </div>
        <div className="text-right">
          {baseApproval != null && (
            <>
              <div className="text-[10px] uppercase tracking-wider text-muted">Base</div>
              <div className="text-sm font-semibold tabular-nums text-foreground">
                {baseApproval.toFixed(1)}%
              </div>
            </>
          )}
          {delta != null && Math.abs(delta) >= 0.05 && (
            <div className={`mt-0.5 text-xs font-medium tabular-nums ${toneClass(delta, "text")}`}>
              {signed(Number(delta.toFixed(1)))} from base
            </div>
          )}
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-sm bg-track" aria-hidden="true">
        <div
          className={`h-full rounded-sm transition-[width] duration-500 ease-out ${toneClass(approval - 50, "fill")}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

function DriverRow({ modifier }: { modifier: ActiveModifier }) {
  const positive = modifier.effect > 0;
  const margin = marginForModifier(modifier);
  const isAddress = modifier.source === "address";
  const isWar = modifier.source === "war";

  return (
    <li
      className={
        "flex min-h-10 items-center gap-2 rounded-md border px-2.5 py-2 " +
        (positive ? "border-success/25 bg-success/5" : "border-error/25 bg-error/5") +
        (isAddress ? " border-dashed" : "")
      }
      title={
        isAddress
          ? "Temporary boost from an active State of the State address (approval only)"
          : isWar
            ? "How the war is going: the front line, whether allies are contributing, and how long the public has carried it. Affects approval only."
            : "Derived from regional metric thresholds; affects approval and sector profit margins"
      }
    >
      <span
        className={
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-xs font-bold tabular-nums " +
          (positive ? "bg-success/15 text-success" : "bg-error/15 text-error")
        }
        aria-hidden
      >
        {positive ? "+" : "−"}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {modifier.label}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
        <span
          className={
            "text-xs font-semibold tabular-nums " + (positive ? "text-success" : "text-error")
          }
        >
          {signed(modifier.effect)} appr.
        </span>
        {margin != null && margin !== 0 && (
          <span
            className={
              "text-[10px] font-medium tabular-nums " + (margin > 0 ? "text-success" : "text-error")
            }
          >
            {signed(margin)}pp margin
          </span>
        )}
      </span>
    </li>
  );
}

export function RegionalConditionsCard({
  countryId,
  stateId,
  modifiers,
  approval,
  baseApproval,
}: {
  countryId: CountryId;
  stateId: string;
  modifiers: ActiveModifier[];
  approval?: number | null;
  baseApproval?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const netApproval = modifiers.reduce((sum, m) => sum + m.effect, 0);
  const netMargin = computeRegionalConditionMargin(modifiers);
  const href = regionApprovalUrl(countryId, stateId);
  const showScore = approval != null;
  const { headline, remainder } = prioritizeModifiers(modifiers, { max: OVERVIEW_HEADLINE_MAX });
  const forces = splitConditionForces(modifiers);
  const hasForces = modifiers.length > 0;

  return (
    <section className="rounded-xl border border-card-border bg-card p-4 shadow-panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full flex-wrap items-start justify-between gap-3 rounded-md text-left transition-colors hover:opacity-90 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
      >
        <div className="flex items-start gap-2">
          <ChevronDown
            className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted">
              Regional Conditions
            </div>
            {open ? (
              <p className="mt-0.5 max-w-prose text-xs text-muted">
                The political weather: forces lifting or dragging government approval.
              </p>
            ) : (
              hasForces && (
                <p className="mt-0.5 text-xs">
                  <span className="font-semibold text-success">
                    Tailwinds {signed(forces.boostTotal)}
                  </span>
                  <span className="text-muted"> / </span>
                  <span className="font-semibold text-error">
                    Headwinds {signed(forces.dragTotal)}
                  </span>
                </p>
              )
            )}
          </div>
        </div>
        {hasForces && (
          <div className="flex gap-4 text-right text-xs">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted">Net approval</div>
              <div
                className={`mt-0.5 font-semibold tabular-nums ${toneClass(netApproval, "text")}`}
              >
                {signed(netApproval)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted">Net margin</div>
              <div className={`mt-0.5 font-semibold tabular-nums ${toneClass(netMargin, "text")}`}>
                {signed(netMargin, "pp")}
              </div>
            </div>
          </div>
        )}
      </button>

      {open && (
        <div id={panelId} role="region">
          {showScore && (
            <div className="mt-4">
              <ApprovalMeter approval={approval} baseApproval={baseApproval} />
            </div>
          )}

          {!showScore && !hasForces && (
            <p className="mt-3 text-xs text-muted">
              Named metric states that adjust government approval and in-state sector profit
              margins.
            </p>
          )}

          {hasForces ? (
            <div className="mt-4 space-y-4">
              <ForceBalanceBar boostTotal={forces.boostTotal} dragTotal={forces.dragTotal} />

              <div>
                <div className="mb-2 text-[10px] uppercase tracking-wider text-muted">
                  Top drivers
                  {remainder.length > 0 && (
                    <span className="normal-case tracking-normal text-muted">
                      {" "}
                      · showing {headline.length} of {modifiers.length}
                    </span>
                  )}
                </div>
                <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {headline.map((m) => (
                    <DriverRow key={m.id} modifier={m} />
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            showScore && (
              <p className="mt-3 text-sm italic text-muted">No active regional conditions.</p>
            )
          )}

          <div className="mt-4 border-t border-card-border/60 pt-3">
            <Link
              href={href}
              className="text-xs font-medium text-primary hover:underline underline-offset-2"
            >
              {remainder.length > 0
                ? `View all ${modifiers.length} conditions & full breakdown →`
                : "View full approval breakdown →"}
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
