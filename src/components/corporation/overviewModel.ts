import type { BondInfo, CorpTabId, SectorDetail } from "./CorporationPageTypes";

/** Shared reads of a sector row for both Overview layouts. */
export function sectorRevenue(s: SectorDetail): number {
  return s.financialRevenue ?? s.revenue;
}

export function sectorMargin(s: SectorDetail): number | null {
  const m = s.fillAdjustedMarginPct ?? s.effectiveProfitMargin;
  return typeof m === "number" && Number.isFinite(m) ? m : null;
}

/** Turns ahead a bond repayment counts as coming up. Matches the page-level notice. */
export const BOND_DUE_WINDOW_TURNS = 48;
/** Turns of cash runway under which the Simple view calls it out. */
export const RUNWAY_WARN_TURNS = 48;
const RUNWAY_URGENT_TURNS = 12;

export type AttentionTone = "error" | "warning" | "primary";

export interface AttentionItem {
  key: string;
  tone: AttentionTone;
  title: string;
  detail?: string;
  tab?: CorpTabId;
}

export interface AttentionInput {
  /** Per-turn net income in corp-local money; null when the books are hidden. */
  netIncomePerTurn: number | null;
  /** Per-turn retained earnings in corp-local money; null when the books are hidden. */
  retainedPerTurn: number | null;
  /** Corp-local cash; null when the books are hidden. */
  cash: number | null;
  sectors: SectorDetail[];
  bondInfo: BondInfo | null;
  openVoteCount: number;
  leverageRating: string | null;
  /** Formats a corp-local amount for the detail line. */
  fmt: (local: number) => string;
}

function names(rows: SectorDetail[]): string {
  const shown = rows.slice(0, 3).map((s) => `${s.displayName ?? s.stateName} ${s.sectorLabel}`);
  const more = rows.length - shown.length;
  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * What a reader of the Simple view needs to act on, most urgent first. Plain
 * data in, plain data out, so the rules can be tested without rendering.
 * Every item names the tab where it is dealt with.
 */
export function buildAttentionItems(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  const { cash, retainedPerTurn, netIncomePerTurn, fmt } = input;

  if (cash != null && cash < 0) {
    items.push({
      key: "cash-negative",
      tone: "error",
      title: "Cash is below zero",
      detail: `${fmt(cash)} on hand.`,
      tab: "financials",
    });
  } else if (cash != null && retainedPerTurn != null && retainedPerTurn < 0 && cash > 0) {
    const turns = Math.floor(cash / -retainedPerTurn);
    if (turns < RUNWAY_WARN_TURNS) {
      items.push({
        key: "runway",
        tone: turns < RUNWAY_URGENT_TURNS ? "error" : "warning",
        title: `Cash lasts about ${turns} ${plural(turns, "turn", "turns")} at this rate`,
        detail: `Losing ${fmt(-retainedPerTurn)} a turn after dividends.`,
        tab: "financials",
      });
    }
  }

  if (netIncomePerTurn != null && netIncomePerTurn < 0) {
    items.push({
      key: "loss",
      tone: "error",
      title: "Losing money",
      detail: `Net income ${fmt(netIncomePerTurn)} a turn.`,
      tab: "financials",
    });
  }

  const bonds = input.bondInfo?.bonds ?? [];
  const defaulted = bonds.filter((b) => b.defaulted && !b.matured);
  if (defaulted.length > 0) {
    items.push({
      key: "bond-default",
      tone: "error",
      title: `${defaulted.length} ${plural(defaulted.length, "bond", "bonds")} in default`,
      tab: "credit",
    });
  }
  const currentTurn = input.bondInfo?.currentTurn;
  if (currentTurn != null && Number.isFinite(currentTurn)) {
    const due = bonds
      .filter(
        (b) =>
          !b.defaulted &&
          !b.matured &&
          b.maturityTurn >= currentTurn &&
          b.maturityTurn - currentTurn <= BOND_DUE_WINDOW_TURNS
      )
      .sort((a, b) => a.maturityTurn - b.maturityTurn);
    if (due.length > 0) {
      const inTurns = due[0].maturityTurn - currentTurn;
      items.push({
        key: "bond-due",
        tone: inTurns <= RUNWAY_URGENT_TURNS ? "error" : "warning",
        title: `${due.length} ${plural(due.length, "bond", "bonds")} due within ${BOND_DUE_WINDOW_TURNS} turns`,
        detail: `Next repayment in ${inTurns} ${plural(inTurns, "turn", "turns")}, on turn ${due[0].maturityTurn}.`,
        tab: "credit",
      });
    }
  }

  const active = input.sectors.filter((s) => !s.mothballed);
  const embargoed = active.filter((s) => s.embargoSuspended);
  if (embargoed.length > 0) {
    items.push({
      key: "embargo",
      tone: "error",
      title: `${embargoed.length} ${plural(embargoed.length, "sector", "sectors")} suspended by embargo`,
      detail: names(embargoed),
      tab: "sectors",
    });
  }
  const losing = active
    .filter((s) => !s.embargoSuspended && typeof s.profit === "number" && s.profit < 0)
    .sort((a, b) => (a.profit ?? 0) - (b.profit ?? 0));
  if (losing.length > 0) {
    items.push({
      key: "losing-sectors",
      tone: "warning",
      title: `${losing.length} ${plural(losing.length, "sector", "sectors")} losing money`,
      detail: names(losing),
      tab: "sectors",
    });
  }
  const lowFill = active.filter((s) => s.fillRateBand === "low");
  if (lowFill.length > 0) {
    items.push({
      key: "low-fill",
      tone: "warning",
      title: `${lowFill.length} ${plural(lowFill.length, "sector", "sectors")} selling under 40% of output`,
      detail: names(lowFill),
      tab: "sectors",
    });
  }

  const grade = input.leverageRating?.trim().charAt(0).toUpperCase();
  if (grade && grade !== "A" && grade !== "B") {
    items.push({
      key: "leverage",
      tone: "warning",
      title: `Leverage rated ${input.leverageRating}`,
      detail: "Heavy debt for its earnings. New bonds cost more at this rating.",
      tab: "credit",
    });
  }

  if (input.openVoteCount > 0) {
    items.push({
      key: "votes",
      tone: "primary",
      title: `${input.openVoteCount} shareholder ${plural(input.openVoteCount, "vote", "votes")} open`,
      tab: "shares",
    });
  }

  return items;
}
