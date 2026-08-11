"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { regionPartyApiUrl, regionPartyUrl } from "@/lib/urls";
import type { StatePartyRow } from "@/lib/states/buildStatePartyRows";
import { orgTier, toneColor } from "./orgTier";

interface RegionDetail {
  treasury?: number;
  memberCount?: number;
  gotvBudgetPercent?: number;
  rivals?: Array<{ partyId: string; abbreviation: string }>;
}

export interface StateDrawerProps {
  row: StatePartyRow;
  countryCode: string;
  partyId: string;
  canManage: boolean;
  priorityLocked: boolean;
  onClose: () => void;
  onFund: (regionId: string, amount: number) => Promise<void> | void;
  onTogglePriority: (regionId: string) => Promise<void> | void;
  onRecruit: (regionId: string) => void;
}

const PRESETS = [10000, 25000, 50000, 100000];

function fmtMoney(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export function StateDrawer({
  row,
  countryCode,
  partyId,
  canManage,
  priorityLocked,
  onClose,
  onFund,
  onTogglePriority,
  onRecruit,
}: StateDrawerProps) {
  const [detail, setDetail] = useState<RegionDetail | null>(null);
  const [fund, setFund] = useState(25000);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(regionPartyApiUrl(countryCode, row.regionId, partyId));
        const d = await r.json();
        if (!cancelled) setDetail(d.stateParty ?? null);
      } catch {
        /* drawer header still renders from the row */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [countryCode, row.regionId, partyId]);

  const t = orgTier(row.organization);
  const treasury = detail?.treasury ?? row.treasury;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-50 h-full w-full max-w-sm overflow-y-auto border-l border-card-border bg-card p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <div className="text-lg font-bold">{row.name}</div>
            <div className="text-xs text-muted">State party</div>
          </div>
          <button className="text-muted hover:text-foreground" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {/* Org readout */}
        <div className="mb-4 rounded-lg border border-card-border bg-background/50 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-muted">Organization</span>
            <span className="text-xl font-bold" style={{ color: toneColor(t.tone) }}>
              {row.organization.toFixed(1)}%
            </span>
          </div>
          <span className="mt-2 block h-2 w-full overflow-hidden rounded-full bg-card-border/40">
            <span
              className="block h-full rounded-full"
              style={{ width: `${row.organization}%`, backgroundColor: toneColor(t.tone) }}
            />
          </span>
          <div className="mt-1 text-xs text-muted">{t.label}</div>
        </div>

        {/* Mini grid */}
        <div className="mb-4 grid grid-cols-4 gap-2 text-center">
          <Mini label="Treasury" value={fmtMoney(treasury)} />
          <Mini
            label="Members"
            value={detail?.memberCount != null ? String(detail.memberCount) : "—"}
          />
          <Mini label="NPPs" value={String(row.nppCount)} />
          <Mini
            label="GOTV"
            value={detail?.gotvBudgetPercent != null ? `${detail.gotvBudgetPercent}%` : "—"}
          />
        </div>

        {/* Leadership */}
        <div className="mb-4">
          <div className="mb-1 text-xs uppercase tracking-wide text-muted">Leadership</div>
          {row.chairName ? (
            <div className="text-sm">{row.chairName} · State Chair</div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted italic">Vacant · State Chair</span>
              <Link
                href={`${regionPartyUrl(countryCode, row.regionId, partyId)}?tab=overview`}
                className="rounded-md border border-card-border px-2 py-1 text-xs hover:bg-card-elevated"
              >
                Appoint
              </Link>
            </div>
          )}
        </div>

        {/* Fund */}
        {canManage && (
          <div className="mb-4">
            <div className="mb-1 text-xs uppercase tracking-wide text-muted">
              Fund this state party
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                step={5000}
                value={fund}
                onChange={(e) => setFund(Math.max(0, +e.target.value))}
                aria-label="Fund amount"
                className="w-full rounded-md border border-card-border bg-background px-2 py-1 text-sm"
              />
              <button
                disabled={busy || fund <= 0}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onFund(row.regionId, fund);
                  } finally {
                    setBusy(false);
                  }
                }}
                className="rounded-md bg-primary px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
              >
                Transfer
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {PRESETS.map((v) => (
                <button
                  key={v}
                  onClick={() => setFund(v)}
                  className="rounded-md border border-card-border px-2 py-0.5 text-xs hover:bg-card-elevated"
                >
                  {fmtMoney(v)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        {canManage && (
          <div className="space-y-2">
            <button
              disabled={priorityLocked}
              onClick={() => onTogglePriority(row.regionId)}
              title={priorityLocked ? "Priority region is locked this turn" : undefined}
              className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-50 ${
                row.isTarget
                  ? "border-primary bg-primary/5"
                  : "border-card-border hover:bg-card-elevated"
              }`}
            >
              <span>{row.isTarget ? "Priority build region" : "Set as priority build"}</span>
              {row.isTarget && <span className="text-primary">✓</span>}
            </button>
            <button
              onClick={() => onRecruit(row.regionId)}
              className="flex w-full items-center justify-between rounded-lg border border-card-border px-3 py-2 text-left text-sm hover:bg-card-elevated"
            >
              <span>Recruit NPP here</span>
              <span className="text-muted">›</span>
            </button>
          </div>
        )}

        <Link
          href={regionPartyUrl(countryCode, row.regionId, partyId)}
          className="mt-3 block rounded-lg border border-card-border px-3 py-2 text-center text-sm hover:bg-card-elevated"
        >
          Open full state party page
        </Link>
      </aside>
    </>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-card-border bg-background/50 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
