"use client";

import { useState } from "react";
import { NppSlotTierTable } from "./NppSlotTierTable";
import { formatLocalFunds } from "@/lib/actions";
import type { CurrencyCode } from "@/lib/constants/currencies";

export interface RecruitStateInfo {
  stateId: string;
  stateName: string;
  stateOrg: number;
  currentNPPs: number;
  maxSlots: number;
  availableSlots: number;
  actionCost: number;
  canRecruit: boolean;
  hasStateLeadership: boolean;
}

export interface NppRecruitSegmentProps {
  states: RecruitStateInfo[];
  /** Available NPP Action Points in the national pool. */
  actionPoints: number;
  /** Treasury cost to recruit (per-currency) + available treasury, for gating/display. */
  recruitFund: number;
  treasury: number;
  currency: CurrencyCode;
  onRecruit: (stateId: string) => Promise<{ ok: boolean }>;
}

function quality(org: number): { label: string; tone: string } {
  if (org >= 60) return { label: "High", tone: "text-success" };
  if (org >= 35) return { label: "Medium", tone: "text-warning" };
  return { label: "Low", tone: "text-error" };
}

export function NppRecruitSegment({
  states,
  actionPoints,
  recruitFund,
  treasury,
  currency,
  onRecruit,
}: NppRecruitSegmentProps) {
  const initial = states.find((s) => s.availableSlots > 0)?.stateId ?? states[0]?.stateId ?? "";
  const [stateId, setStateId] = useState(initial);
  const [busy, setBusy] = useState(false);
  const st = states.find((s) => s.stateId === stateId) ?? states[0];

  if (!st) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-4 text-sm text-muted">
        No eligible states for recruitment.
      </div>
    );
  }

  const q = quality(st.stateOrg);
  const avail = st.availableSlots;
  const affordable = actionPoints >= st.actionCost && treasury >= recruitFund;
  const disabled = busy || avail <= 0 || !affordable;

  const handle = async () => {
    setBusy(true);
    try {
      await onRecruit(st.stateId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-card-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Recruit a New NPP</h3>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
            {actionPoints} AP · {formatLocalFunds(treasury, currency)}
          </span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted">
          Recruit a non-player politician to expand the slate. Greater state organization yields
          stronger recruits and unlocks more slots.
        </p>

        <label className="mb-1 block text-xs font-medium text-muted">Recruit in state</label>
        <div className="mb-4 flex flex-wrap gap-2">
          {states.map((s) => {
            const sel = s.stateId === stateId;
            return (
              <button
                key={s.stateId}
                type="button"
                onClick={() => setStateId(s.stateId)}
                className={`flex flex-col items-center rounded-lg border px-3 py-1.5 ${
                  sel ? "border-primary bg-primary/10" : "border-card-border hover:bg-card-elevated"
                }`}
              >
                <span className="text-xs font-bold">{s.stateId}</span>
                <span className="text-[10px] text-muted">{s.stateOrg.toFixed(0)}%</span>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-card-border bg-card-elevated p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted">Slots</div>
            <div className="text-lg font-bold">
              {st.currentNPPs}{" "}
              <span className="text-xs font-normal text-muted">/ {st.maxSlots}</span>
            </div>
            <div className="text-[11px] text-muted">{avail} available</div>
          </div>
          <div className="rounded-lg border border-card-border bg-card-elevated p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted">Recruit quality</div>
            <div className={`text-lg font-bold ${q.tone}`}>{q.label}</div>
            <div className="text-[11px] text-muted">driven by {st.stateOrg.toFixed(0)}% org</div>
          </div>
          <div className="rounded-lg border border-card-border bg-card-elevated p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted">Cost</div>
            <div className="text-lg font-bold">
              {st.actionCost} <span className="text-xs font-normal text-muted">AP</span>
            </div>
            <div className="text-[11px] text-green-400">
              + {formatLocalFunds(recruitFund, currency)}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handle}
          disabled={disabled}
          className="mt-4 w-full rounded-lg bg-primary py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {avail <= 0
            ? `No slots available in ${st.stateName}`
            : !affordable
              ? "Insufficient Action Points or funds"
              : busy
                ? "Recruiting…"
                : `Recruit NPP in ${st.stateName}`}
        </button>
      </div>

      <div className="rounded-xl border border-card-border bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold">How recruitment works</h3>
        <NppSlotTierTable currentOrg={st.stateOrg} className="mb-3" />
        <ul className="ml-4 list-disc space-y-1 text-xs text-muted">
          <li>
            <b>Slots</b> scale with state organization per the table above — build org to open more.
          </li>
          <li>
            <b>Quality</b> of recruits rises with org%: better starting stats.
          </li>
          <li>
            <b>Cost</b> is a flat 5 Action Points plus {formatLocalFunds(recruitFund, currency)} per
            recruit, drawn from your party pool and treasury.
          </li>
          <li>Newly recruited NPPs join your slate and can be whipped &amp; managed.</li>
        </ul>
      </div>
    </div>
  );
}
