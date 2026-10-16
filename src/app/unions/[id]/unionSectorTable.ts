/**
 * Pure model behind the union Sectors tab: status classification, filtering,
 * sorting and the cost of a batch of organizing drives. Kept out of the
 * component so the table's behaviour is unit tested without rendering it.
 */
import {
  ORGANIZE_SECTOR_ACTION_COST,
  organizeSectorTreasuryCost,
} from "@/lib/unions/organizeSectorEconomy";
import { unionMembers } from "@/lib/unions/unionDues";
import type { SectorRow } from "./unionTypes";

export type SectorStatus = "striking" | "underorganized" | "cooldown" | "agreement" | "ready";

/** Same precedence the Status column has always used. */
export function sectorStatus(s: SectorRow): SectorStatus {
  if (s.strikeActive || s.strikeBlockReason === "already_striking") return "striking";
  if (s.strikeBlockReason === "underorganized") return "underorganized";
  if (s.strikeBlockReason === "sector_cooldown") return "cooldown";
  if (s.strikeBlockReason === "collective_agreement") return "agreement";
  return "ready";
}

/**
 * Filter option labels. Worded differently from the Status column badges on
 * purpose, so a badge and an option never read as the same control.
 */
export const SECTOR_STATUS_FILTER_LABEL: Record<SectorStatus, string> = {
  ready: "Ready to strike",
  striking: "On strike",
  agreement: "Covered by an agreement",
  cooldown: "In strike cooldown",
  underorganized: "Too weak to strike",
};

export type SectorHolding = "ours" | "rival" | "none";

export function sectorHolding(s: SectorRow, unionId: string): SectorHolding {
  if (!s.representingUnionId) return "none";
  return s.representingUnionId === unionId ? "ours" : "rival";
}

export const SECTOR_HOLDING_FILTER_LABEL: Record<SectorHolding, string> = {
  ours: "Held by this union",
  rival: "Held by a rival union",
  none: "Not represented",
};

export type SectorSortKey =
  "corporation" | "state" | "workers" | "wage" | "gap" | "unionization" | "status" | "cost";

export type SortDir = "asc" | "desc";

/** First click on a numeric column shows the biggest first; text columns go A to Z. */
export const SECTOR_SORT_DEFAULT_DIR: Record<SectorSortKey, SortDir> = {
  corporation: "asc",
  state: "asc",
  workers: "desc",
  wage: "desc",
  gap: "desc",
  unionization: "desc",
  status: "asc",
  cost: "asc",
};

/** Status order for sorting: what a union head can act on soonest comes first. */
const STATUS_RANK: Record<SectorStatus, number> = {
  ready: 0,
  striking: 1,
  agreement: 2,
  cooldown: 3,
  underorganized: 4,
};

/** Treasury price of one drive on this row, priced exactly as the server prices it. */
export function sectorDriveCost(s: SectorRow, unionId: string): number {
  return organizeSectorTreasuryCost({
    workers: s.workers,
    unionization: s.unionization,
    isOwnSector: s.representingUnionId === unionId,
  });
}

export function sectorMembers(s: SectorRow): number {
  return unionMembers([{ workers: s.workers, unionization: s.unionization }]);
}

export interface SectorFilter {
  text: string;
  status: SectorStatus | "";
  holding: SectorHolding | "";
}

export const EMPTY_SECTOR_FILTER: SectorFilter = { text: "", status: "", holding: "" };

export function filterSectors(
  rows: SectorRow[],
  filter: SectorFilter,
  unionId: string
): SectorRow[] {
  const q = filter.text.trim().toLowerCase();
  return rows.filter((s) => {
    if (q && !s.corporationName.toLowerCase().includes(q) && !s.stateId.toLowerCase().includes(q)) {
      return false;
    }
    if (filter.status && sectorStatus(s) !== filter.status) return false;
    if (filter.holding && sectorHolding(s, unionId) !== filter.holding) return false;
    return true;
  });
}

function sortValue(s: SectorRow, key: SectorSortKey, unionId: string): number | string | null {
  switch (key) {
    case "corporation":
      return s.corporationName.toLowerCase();
    case "state":
      return s.stateId.toLowerCase();
    case "workers":
      return s.workers ?? 0;
    case "wage":
      return s.wageLevel;
    case "gap":
      // No standing claim has no gap at all: it sorts last either way.
      return s.wageGap;
    case "unionization":
      return s.unionization;
    case "status":
      return STATUS_RANK[sectorStatus(s)];
    case "cost":
      return sectorDriveCost(s, unionId);
  }
}

/** Stable sort; rows with no value for the key always sink to the bottom. */
export function sortSectors(
  rows: SectorRow[],
  key: SectorSortKey | null,
  dir: SortDir,
  unionId: string
): SectorRow[] {
  if (!key) return rows;
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row, key, unionId) }))
    .sort((a, b) => {
      if (a.value == null && b.value == null) return a.index - b.index;
      if (a.value == null) return 1;
      if (b.value == null) return -1;
      const cmp =
        typeof a.value === "string" && typeof b.value === "string"
          ? a.value.localeCompare(b.value)
          : (a.value as number) - (b.value as number);
      return cmp !== 0 ? cmp * sign : a.index - b.index;
    })
    .map((entry) => entry.row);
}

export interface BatchQuote {
  count: number;
  actionPoints: number;
  treasury: number;
  /** Why the batch cannot run as selected, or null when it can. */
  blocker: string | null;
}

/**
 * What running drives on `selected` costs, and whether the head can pay for
 * all of it. `myActions` null means the balance has not loaded, which never
 * blocks: the server is still the authority.
 */
export function quoteBatch(
  selected: SectorRow[],
  unionId: string,
  treasury: number,
  myActions: number | null
): BatchQuote {
  const actionPoints = selected.length * ORGANIZE_SECTOR_ACTION_COST;
  const cost = selected.reduce((sum, s) => sum + sectorDriveCost(s, unionId), 0);
  let blocker: string | null = null;
  if (myActions != null && myActions < actionPoints) {
    blocker = `Needs ${actionPoints} action points, you have ${myActions}.`;
  } else if (treasury < cost) {
    blocker = `Needs ${cost.toLocaleString("en-US")} from the treasury, which holds ${Math.round(
      treasury
    ).toLocaleString("en-US")}.`;
  }
  return { count: selected.length, actionPoints, treasury: cost, blocker };
}
