/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BlendLedger } from "./BlendLedger";
import type { CampaignBlendVM, LedgerRowVM } from "./campaignBlendViewModel";

function rows(n: number): LedgerRowVM[] {
  return Array.from({ length: n }, (_, i) => ({
    turnTag: `T${4182 - i}`,
    label: `Ground Game to Lv ${24 - i}`,
    cost: "-$412,000 · -4a",
    demoted: false,
    reason: null,
  }));
}

function ledger(over: Partial<CampaignBlendVM["ledger"]> = {}): CampaignBlendVM["ledger"] {
  return {
    rows: rows(10),
    rangeText: "1-10 of 24",
    pageText: "Page 1 of 3",
    hasPager: true,
    canPrev: false,
    canNext: true,
    page: 0,
    pageCount: 3,
    ...over,
  };
}

const noop = () => {};

function renderLedger(over: Partial<Parameters<typeof BlendLedger>[0]> = {}) {
  return render(<BlendLedger ledger={ledger()} onPrev={noop} onNext={noop} {...over} />);
}

describe("rows", () => {
  it("renders one row per entry on the page", () => {
    renderLedger();
    expect(screen.getAllByText(/Ground Game to Lv/)).toHaveLength(10);
  });

  it("shows the turn tag and the cost", () => {
    renderLedger();
    expect(screen.getByText("T4182")).toBeTruthy();
    expect(screen.getAllByText("-$412,000 · -4a").length).toBe(10);
  });

  it("says so plainly when nothing has been bought", () => {
    renderLedger({ ledger: ledger({ rows: [], hasPager: false }) });
    expect(screen.getByText("Nothing has been bought yet.")).toBeTruthy();
  });
});

describe("demotions", () => {
  it("reads a demotion as demoted rather than as a spend", () => {
    const demoted: LedgerRowVM = {
      turnTag: "T4177",
      label: "Media Spending down to Lv 5",
      cost: "demoted",
      demoted: true,
      reason: "insolvency",
    };
    renderLedger({ ledger: ledger({ rows: [demoted], hasPager: false }) });
    expect(screen.getByText("demoted")).toBeTruthy();
    expect(screen.getByText("insolvency")).toBeTruthy();
  });
});

describe("pager", () => {
  it("shows the range and page position", () => {
    renderLedger();
    expect(screen.getByText("1-10 of 24")).toBeTruthy();
    expect(screen.getByText("Page 1 of 3")).toBeTruthy();
  });

  it("disables Prev on the first page", () => {
    renderLedger();
    expect((screen.getByRole("button", { name: "PREV" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "NEXT" }) as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it("disables Next on the last page", () => {
    renderLedger({
      ledger: ledger({ rows: rows(4), canPrev: true, canNext: false, page: 2 }),
    });
    expect((screen.getByRole("button", { name: "NEXT" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("calls back when paging", () => {
    const onNext = vi.fn();
    renderLedger({ onNext });
    screen.getByRole("button", { name: "NEXT" }).click();
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("hides the pager when everything fits on one page", () => {
    renderLedger({ ledger: ledger({ rows: rows(3), hasPager: false }) });
    expect(screen.queryByRole("button", { name: "NEXT" })).toBeNull();
  });
});
