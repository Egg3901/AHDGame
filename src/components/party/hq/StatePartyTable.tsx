"use client";

import type { StatePartyRow } from "@/lib/states/buildStatePartyRows";
import { orgTier, toneColor, orgFill, leanLabelFromValue } from "./orgTier";

export type StatePartySortKey =
  | "name"
  | "organization"
  | "politicalStrength"
  | "treasury"
  | "registrationPct"
  | "nppCount"
  | "lean";

export interface StatePartyTableProps {
  rows: StatePartyRow[];
  sel: Set<string>;
  onToggle: (regionId: string) => void;
  onToggleAll: () => void;
  onOpen: (regionId: string) => void;
  sortKey: StatePartySortKey;
  sortDir: 1 | -1;
  onSort: (key: StatePartySortKey) => void;
}

const COLUMNS: { key: StatePartySortKey; label: string }[] = [
  { key: "organization", label: "Org%" },
  { key: "politicalStrength", label: "PS" },
  { key: "treasury", label: "Funds" },
  { key: "registrationPct", label: "Reg%" },
  { key: "nppCount", label: "NPPs" },
  { key: "lean", label: "Lean" },
];

function fmtMoney(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export function StatePartyTable({
  rows,
  sel,
  onToggle,
  onToggleAll,
  onOpen,
  sortKey,
  sortDir,
  onSort,
}: StatePartyTableProps) {
  const allSel = rows.length > 0 && rows.every((r) => sel.has(r.regionId));

  return (
    <div className="overflow-x-auto rounded-xl border border-card-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-card-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="w-8 px-2 py-2">
              <input
                type="checkbox"
                checked={allSel}
                onChange={onToggleAll}
                aria-label="Select all"
              />
            </th>
            <th className="px-2 py-2">
              <button
                type="button"
                className="hover:text-foreground"
                onClick={() => onSort("name")}
              >
                State{sortKey === "name" ? (sortDir > 0 ? " ▲" : " ▼") : ""}
              </button>
            </th>
            {COLUMNS.map((c) => (
              <th key={c.key} className="px-2 py-2">
                <button
                  type="button"
                  className="hover:text-foreground"
                  onClick={() => onSort(c.key)}
                >
                  {c.label}
                  {sortKey === c.key ? (sortDir > 0 ? " ▲" : " ▼") : ""}
                </button>
              </th>
            ))}
            <th className="px-2 py-2">Leadership</th>
            <th className="w-10 px-2 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-card-border">
          {rows.map((r) => {
            const t = orgTier(r.organization);
            const ln = leanLabelFromValue(r.lean);
            const checked = sel.has(r.regionId);
            return (
              <tr key={r.regionId} className={checked ? "bg-primary/5" : ""}>
                <td className="px-2 py-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(r.regionId)}
                    aria-label={`Select ${r.name}`}
                  />
                </td>
                <td className="px-2 py-2">
                  <button
                    type="button"
                    className="flex items-center gap-2 text-left hover:text-primary"
                    onClick={() => onOpen(r.regionId)}
                  >
                    <span
                      className="inline-flex h-6 w-7 items-center justify-center rounded text-[10px] font-bold text-white"
                      style={{ backgroundColor: orgFill(r.organization) }}
                    >
                      {r.regionId}
                    </span>
                    <span className="font-medium">{r.name}</span>
                    {r.isTarget && (
                      <span title="Priority build" className="text-primary">
                        ★
                      </span>
                    )}
                  </button>
                </td>
                <td className="px-2 py-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-semibold" style={{ color: toneColor(t.tone) }}>
                        {r.organization.toFixed(1)}%
                      </span>
                      <span className="text-[10px] text-muted">{t.label}</span>
                    </span>
                    <span className="block h-1 w-full overflow-hidden rounded-full bg-card-border/40">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${r.organization}%`, backgroundColor: toneColor(t.tone) }}
                      />
                    </span>
                  </div>
                </td>
                <td className="px-2 py-2 tabular-nums">{r.politicalStrength.toFixed(0)}</td>
                <td className="px-2 py-2 tabular-nums">{fmtMoney(r.treasury)}</td>
                <td className="px-2 py-2 tabular-nums">{r.registrationPct.toFixed(0)}%</td>
                <td className="px-2 py-2">
                  <span className="rounded-full bg-card-border/40 px-2 py-0.5 text-xs">
                    {r.nppCount}
                  </span>
                </td>
                <td className="px-2 py-2">
                  <span className="text-xs" style={{ color: ln.color }}>
                    {ln.label}
                  </span>
                </td>
                <td className="px-2 py-2">
                  {r.chairName ? (
                    <span className="text-xs">{r.chairName}</span>
                  ) : (
                    <span className="text-xs text-muted italic">Vacant</span>
                  )}
                </td>
                <td className="px-2 py-2 text-right">
                  <button
                    type="button"
                    title="Manage state party"
                    aria-label="Manage state party"
                    onClick={() => onOpen(r.regionId)}
                    className="text-muted hover:text-foreground"
                  >
                    ⚙
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
