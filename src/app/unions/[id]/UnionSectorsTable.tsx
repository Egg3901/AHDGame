"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { EmptyState, Tooltip } from "@/components/ui";
import {
  ORGANIZE_SECTORS_BATCH_MAX,
  RAID_APPROVAL_EDGE_REQUIRED,
  clamp0to100,
} from "@/lib/unions/organizeSectorEconomy";
import type { SectorRow } from "./unionTypes";
import {
  EMPTY_SECTOR_FILTER,
  SECTOR_HOLDING_FILTER_LABEL,
  SECTOR_SORT_DEFAULT_DIR,
  SECTOR_STATUS_FILTER_LABEL,
  filterSectors,
  quoteBatch,
  sectorDriveCost,
  sectorHolding,
  sectorMembers,
  sortSectors,
  type SectorFilter,
  type SectorHolding,
  type SectorSortKey,
  type SectorStatus,
  type SortDir,
} from "./unionSectorTable";

/** Rows shown before "Show all", so a big industry does not become a wall. */
const PAGE_SIZE = 25;

function formatApprovalEdge(edge: number): string {
  const rounded = Number(edge.toFixed(3));
  // Preserve which side of the raid threshold an unrounded edge falls on.
  if (rounded === RAID_APPROVAL_EDGE_REQUIRED && edge !== rounded) {
    return `${edge < rounded ? "<" : ">"}${rounded}`;
  }
  return String(rounded);
}

interface Column {
  key: string;
  label: string;
  help: string;
  sortKey?: SectorSortKey;
  align?: "right";
}

const COLUMNS: Column[] = [
  {
    key: "corporation",
    label: "Corporation",
    help: "The employer running this shop. Opens the sector page.",
    sortKey: "corporation",
  },
  {
    key: "representative",
    label: "Representing union",
    help: "The one union representing this shop. The member count belongs to this union, not to every union in the industry.",
  },
  { key: "state", label: "State", help: "Where the shop operates.", sortKey: "state" },
  {
    key: "workers",
    label: "Workers",
    help: "Members of the representing union in this shop, over its whole workforce. Unrepresented shops have no union members. Sorts by workforce.",
    sortKey: "workers",
    align: "right",
  },
  {
    key: "wage",
    label: "Wage",
    help: "What this shop pays, as a multiple of the regional median wage.",
    sortKey: "wage",
    align: "right",
  },
  {
    key: "gap",
    label: "Demand gap",
    help: "How far this shop's wage falls short of the union's public wage claim. Met means it already pays the claim or more.",
    sortKey: "gap",
    align: "right",
  },
  {
    key: "unionization",
    label: "Unionization",
    help: "Share of this shop's workforce belonging to its representing union. A successful raid transfers representation, rather than adding competing memberships.",
    sortKey: "unionization",
    align: "right",
  },
  {
    key: "status",
    label: "Status",
    help: "Whether this shop can strike now, and if not, why. Sorts ready shops first.",
    sortKey: "status",
  },
];

// Labelled "Drive", not "Organize": the heading is a sort button and must not
// share an accessible name with every row's Organize button.
const ORGANIZE_COLUMN: Column = {
  key: "organize",
  label: "Drive",
  help: `One drive costs action points plus treasury, priced by shop size, or by current unionization in a shop this union already holds. The percentage is the unionization it adds, scaled by approval. A drive on a rival union's shop is a raid: it wins only with ${RAID_APPROVAL_EDGE_REQUIRED} approval points over the rival, and a lost raid still costs. Sorts cheapest first.`,
  sortKey: "cost",
};

export interface UnionSectorsTableProps {
  unionId: string;
  approval: number;
  sectors: SectorRow[];
  treasury: number;
  myActions: number | null;
  /** True for the sitting head of an unsuspended union: shows the organize column and selection. */
  canOrganize: boolean;
  organizeActionCost: number;
  organizeGain: number;
  actionPending: boolean;
  /** Initial status filter, set when the Overview links straight to a status. */
  initialStatus?: SectorStatus | "";
  onOrganize: (sectorId: string) => void;
  onOrganizeBatch: (sectorIds: string[]) => Promise<string[]>;
}

/**
 * The union's shops: sortable by any column, filterable by name, state,
 * strike status and who holds the shop. A union head can tick shops and run
 * every drive in one go, or run a single drive from the row as before.
 */
export function UnionSectorsTable({
  unionId,
  approval,
  sectors,
  treasury,
  myActions,
  canOrganize,
  organizeActionCost,
  organizeGain,
  actionPending,
  initialStatus = "",
  onOrganize,
  onOrganizeBatch,
}: UnionSectorsTableProps) {
  const [filter, setFilter] = useState<SectorFilter>({
    ...EMPTY_SECTOR_FILTER,
    status: initialStatus,
  });
  const [sortKey, setSortKey] = useState<SectorSortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const visible = useMemo(
    () => sortSectors(filterSectors(sectors, filter, unionId), sortKey, sortDir, unionId),
    [sectors, filter, unionId, sortKey, sortDir]
  );
  const shown = showAll ? visible : visible.slice(0, PAGE_SIZE);

  // A selection can outlive its row (filtered out, or gone after a reload);
  // only rows still in the data count toward the quote.
  const selectedRows = useMemo(
    () =>
      selected
        .map((id) => sectors.find((s) => s.sectorId === id))
        .filter((s): s is SectorRow => s != null),
    [selected, sectors]
  );
  const quote = quoteBatch(selectedRows, unionId, treasury, myActions);
  const atBatchMax = selectedRows.length >= ORGANIZE_SECTORS_BATCH_MAX;

  const columns = canOrganize ? [...COLUMNS, ORGANIZE_COLUMN] : COLUMNS;
  const filtered = filter.text.trim() !== "" || filter.status !== "" || filter.holding !== "";

  function onSort(key: SectorSortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(SECTOR_SORT_DEFAULT_DIR[key]);
    }
  }

  function toggle(sectorId: string) {
    setSelected((prev) =>
      prev.includes(sectorId)
        ? prev.filter((id) => id !== sectorId)
        : prev.length >= ORGANIZE_SECTORS_BATCH_MAX
          ? prev
          : [...prev, sectorId]
    );
  }

  const shownIds = shown.map((s) => s.sectorId);
  const allShownSelected = shownIds.length > 0 && shownIds.every((id) => selected.includes(id));

  function toggleAllShown() {
    if (allShownSelected) {
      setSelected((prev) => prev.filter((id) => !shownIds.includes(id)));
      return;
    }
    setSelected((prev) => {
      const next = [...prev];
      for (const id of shownIds) {
        if (next.length >= ORGANIZE_SECTORS_BATCH_MAX) break;
        if (!next.includes(id)) next.push(id);
      }
      return next;
    });
  }

  async function runBatch() {
    const done = await onOrganizeBatch(selectedRows.map((s) => s.sectorId));
    setSelected((prev) => prev.filter((id) => !done.includes(id)));
  }

  if (sectors.length === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6">
        <EmptyState
          title="No sectors in scope"
          description="No corp-owned sector of this type exists in this country yet."
        />
      </div>
    );
  }

  const totalWorkers = visible.reduce((sum, s) => sum + (s.workers ?? 0), 0);
  const totalMembers = visible.reduce((sum, s) => sum + sectorMembers(s), 0);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        One representing union per shop. Unionization is its members&apos; share of the workforce. A
        successful raid transfers representation; there are no competing memberships or plurality
        contests. Current approval is a comparison, not a forecast: approval can change before a
        drive runs.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted">Search</span>
          <input
            type="search"
            value={filter.text}
            onChange={(e) => setFilter((f) => ({ ...f, text: e.target.value }))}
            placeholder="Corporation or state"
            aria-label="Filter sectors by corporation or state"
            className="w-48 rounded-lg border border-card-border bg-background px-3 py-1.5 text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted">Strike status</span>
          <select
            value={filter.status}
            onChange={(e) =>
              setFilter((f) => ({ ...f, status: e.target.value as SectorStatus | "" }))
            }
            aria-label="Filter sectors by strike status"
            className="rounded-lg border border-card-border bg-background px-2 py-1.5 text-xs"
          >
            <option value="">Any status</option>
            {(Object.keys(SECTOR_STATUS_FILTER_LABEL) as SectorStatus[]).map((status) => (
              <option key={status} value={status}>
                {SECTOR_STATUS_FILTER_LABEL[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted">Representation</span>
          <select
            value={filter.holding}
            onChange={(e) =>
              setFilter((f) => ({ ...f, holding: e.target.value as SectorHolding | "" }))
            }
            aria-label="Filter sectors by representing union"
            className="rounded-lg border border-card-border bg-background px-2 py-1.5 text-xs"
          >
            <option value="">Any union</option>
            {(Object.keys(SECTOR_HOLDING_FILTER_LABEL) as SectorHolding[]).map((holding) => (
              <option key={holding} value={holding}>
                {SECTOR_HOLDING_FILTER_LABEL[holding]}
              </option>
            ))}
          </select>
        </label>
        {filtered && (
          <button
            type="button"
            onClick={() => setFilter(EMPTY_SECTOR_FILTER)}
            className="rounded-lg border border-card-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-card-elevated hover:text-foreground"
          >
            Clear filters
          </button>
        )}
        <span className="ml-auto text-xs tabular-nums text-muted">
          {filtered ? `${visible.length} of ${sectors.length} shops` : `${sectors.length} shops`} ·{" "}
          {totalMembers.toLocaleString("en-US")} of {totalWorkers.toLocaleString("en-US")} workers
          organized across all unions
        </span>
      </div>

      {canOrganize && selectedRows.length > 0 && (
        <div
          role="region"
          aria-label="Selected drives"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm"
        >
          <span className="font-semibold">
            {quote.count} {quote.count === 1 ? "shop" : "shops"} selected
          </span>
          <span className="tabular-nums text-muted">
            {quote.actionPoints} AP{myActions != null && ` of ${myActions}`} ·{" "}
            {quote.treasury.toLocaleString("en-US")} of{" "}
            {Math.round(treasury).toLocaleString("en-US")} treasury
          </span>
          {atBatchMax && (
            <span className="text-xs text-muted">
              Up to {ORGANIZE_SECTORS_BATCH_MAX} drives per batch.
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelected([])}
              className="rounded-lg border border-card-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-card-elevated"
            >
              Clear
            </button>
            <button
              type="button"
              disabled={actionPending || quote.blocker != null}
              onClick={runBatch}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              Run {quote.count} {quote.count === 1 ? "drive" : "drives"}
            </button>
          </div>
          {quote.blocker && (
            <p className="w-full text-xs font-medium text-error">{quote.blocker}</p>
          )}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-6">
          <EmptyState
            title="No shops match"
            description="Change or clear the filters to see more of this union's shops."
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-card-border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-card-border bg-card-elevated text-left text-sm font-semibold text-foreground">
                {canOrganize && (
                  <th className="w-8 px-3 py-3">
                    <input
                      type="checkbox"
                      checked={allShownSelected}
                      onChange={toggleAllShown}
                      aria-label="Select every shop shown"
                      className="h-4 w-4 accent-primary"
                    />
                  </th>
                )}
                {columns.map((col) => {
                  const active = col.sortKey != null && col.sortKey === sortKey;
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      aria-sort={
                        active ? (sortDir === "asc" ? "ascending" : "descending") : undefined
                      }
                      className={`px-3 py-3 font-medium ${col.align === "right" ? "text-right" : ""}`}
                    >
                      <span
                        className={`inline-flex items-center gap-0.5 ${
                          col.align === "right" ? "justify-end" : ""
                        }`}
                      >
                        {col.sortKey ? (
                          <button
                            type="button"
                            onClick={() => onSort(col.sortKey!)}
                            className={`inline-flex items-center gap-1 hover:text-primary ${
                              active ? "text-primary" : ""
                            }`}
                          >
                            {col.label}
                            <span aria-hidden className="w-2 text-[9px]">
                              {active ? (sortDir === "asc" ? "▲" : "▼") : ""}
                            </span>
                          </button>
                        ) : (
                          col.label
                        )}
                        <Tooltip content={col.help} label={`What ${col.label} means`} />
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => {
                const isSelected = selected.includes(s.sectorId);
                const rival = sectorHolding(s, unionId) === "rival";
                const approvalEdge =
                  rival && s.representingUnionApproval != null
                    ? clamp0to100(approval) - clamp0to100(s.representingUnionApproval)
                    : null;
                const rowCost = sectorDriveCost(s, unionId);
                const cannotAffordAp = myActions != null && myActions < organizeActionCost;
                const cannotAfford = cannotAffordAp || treasury < rowCost;
                const members = sectorMembers(s);
                return (
                  <tr
                    key={s.sectorId}
                    className={`border-b border-card-border transition-colors last:border-0 hover:bg-card-elevated/60 ${
                      isSelected ? "bg-primary/5" : ""
                    }`}
                  >
                    {canOrganize && (
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!isSelected && atBatchMax}
                          onChange={() => toggle(s.sectorId)}
                          aria-label={`Select ${s.corporationName} in ${s.stateId}`}
                          className="h-4 w-4 accent-primary"
                        />
                      </td>
                    )}
                    <td className="px-3 py-3">
                      <Link
                        href={`/corporation/${s.corporationId}/sector/${s.sectorId}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {s.corporationName}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      {s.representingUnionId ? (
                        <Link
                          href={`/unions/${s.representingUnionId}`}
                          className={`text-xs hover:underline ${rival ? "text-warning" : "text-primary"}`}
                        >
                          {s.representingUnionName ?? `Unknown union (${s.representingUnionId})`}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted">Unrepresented</span>
                      )}
                      {rival && (
                        <div className="mt-1 space-y-0.5 text-[10px] tabular-nums text-muted">
                          {approvalEdge == null ? (
                            <p>
                              Rival approval unavailable
                              {s.representingUnionApproval === null
                                ? "; no live rival to contest."
                                : "."}
                            </p>
                          ) : (
                            <>
                              <p>Rival approval: {s.representingUnionApproval}%</p>
                              <p>This union: {approval}%</p>
                              <p title={`Unrounded edge: ${approvalEdge} points`}>
                                Current edge: {formatApprovalEdge(approvalEdge)} points (needs{" "}
                                {RAID_APPROVAL_EDGE_REQUIRED})
                              </p>
                              <p
                                className={
                                  approvalEdge >= RAID_APPROVAL_EDGE_REQUIRED
                                    ? "text-success"
                                    : "text-warning"
                                }
                              >
                                {approvalEdge >= RAID_APPROVAL_EDGE_REQUIRED
                                  ? "Meets current raid edge"
                                  : "Below current raid edge"}
                              </p>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-muted">{s.stateId}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">
                      <div>{members.toLocaleString("en-US")}</div>
                      <div className="text-[10px] text-muted">
                        of {(s.workers ?? 0).toLocaleString("en-US")}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">
                      {s.wageLevel.toFixed(2)}×
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">
                      {s.wageGap == null ? (
                        <span className="text-muted">No demand</span>
                      ) : s.wageGap <= 0 ? (
                        <span className="text-success">Met</span>
                      ) : (
                        <span className="text-warning">{s.wageGap.toFixed(2)}× short</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-card-elevated sm:block">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${Math.min(100, s.unionization)}%` }}
                          />
                        </div>
                        <span className="font-mono tabular-nums">{s.unionization.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {s.strikeActive || s.strikeBlockReason === "already_striking" ? (
                        <span className="rounded-md bg-error/15 px-2 py-0.5 text-xs font-medium text-error">
                          Striking
                        </span>
                      ) : s.strikeBlockReason === "underorganized" ? (
                        <span className="text-xs text-muted">Needs organizing</span>
                      ) : s.strikeBlockReason === "sector_cooldown" ? (
                        <span className="text-xs text-warning">
                          Cooldown to turn {s.strikeCooldownUntilTurn}
                        </span>
                      ) : s.strikeBlockReason === "collective_agreement" ? (
                        <span className="text-xs font-medium text-info">Under agreement</span>
                      ) : (
                        <span className="text-xs font-medium text-success">Strike ready</span>
                      )}
                    </td>
                    {canOrganize && (
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          disabled={actionPending || cannotAfford}
                          onClick={() => onOrganize(s.sectorId)}
                          className="rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                        >
                          {rival ? "Raid" : "Organize"}
                        </button>
                        <div className="mt-0.5 text-[10px] tabular-nums text-muted">
                          {organizeActionCost} AP · {rowCost.toLocaleString("en-US")} · +
                          {organizeGain.toFixed(1)}%
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {visible.length > PAGE_SIZE && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="text-xs font-medium text-primary hover:underline"
        >
          {showAll ? `Show the first ${PAGE_SIZE}` : `Show all ${visible.length} shops`}
        </button>
      )}
    </div>
  );
}
