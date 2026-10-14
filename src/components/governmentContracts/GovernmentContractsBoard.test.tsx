/** @vitest-environment happy-dom */
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/corporations.json";
import { GovernmentContractsBoard } from "./GovernmentContractsBoard";
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const row = {
  _id: "a".repeat(24),
  countryId: "JP",
  title: "Naval equipment tender",
  description: "Equipment for the national arsenal",
  terms: { type: "defence", component: "naval", lots: 3, grade: 1, maximumPricePerLot: 100 },
  tab: "active",
  closesTurn: 8,
  awardDeadlineTurn: 10,
  publishedTurn: 5,
};
beforeEach(() => {
  push.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith("/access")
              ? {
                  defence: false,
                  nationalExtraction: false,
                  regionalExtraction: false,
                  states: [],
                  corporations: [],
                  window: { endTurn: 12 },
                  currentTurn: 5,
                }
              : { total: 23, page: 2, pageSize: 10, totalPages: 3, currentTurn: 5, tenders: [row] }
          ),
          { status: 200 }
        )
    )
  );
});
function show(
  tab: "active" | "closed" | "awarded" | "canceled" = "active",
  type: "all" | "defence" | "extraction" = "all",
  page = 2
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <GovernmentContractsBoard
        countryId="JP"
        countryName="Japan"
        tab={tab}
        type={type}
        page={page}
      />
    </NextIntlClientProvider>
  );
}
describe("country government contracts board", () => {
  it("shows the four requested tabs and preserves country and type while resetting their page", async () => {
    show("active", "defence");
    await screen.findByText("Naval equipment tender");
    for (const label of ["Active Bidding", "Bidding Closed", "Awarded", "Canceled"])
      expect(screen.getByRole("link", { name: label })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Bidding Closed" }).getAttribute("href")).toBe(
      "/country/jp/government-contracts?tab=closed&type=defence&page=1"
    );
    expect(screen.getByRole("link", { name: "Next" }).getAttribute("href")).toBe(
      "/country/jp/government-contracts?tab=active&type=defence&page=3"
    );
    expect(screen.queryByRole("button", { name: "Publish tender" })).toBeNull();
  });
  it("resets the page on a type filter change", async () => {
    show();
    await screen.findByText("Naval equipment tender");
    fireEvent.change(screen.getByLabelText("Contract type"), { target: { value: "extraction" } });
    expect(push).toHaveBeenCalledWith(
      "/country/jp/government-contracts?tab=active&type=extraction&page=1"
    );
  });
  it("surfaces a failed request with retry instead of an empty-board message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ error: "Temporary failure" }), { status: 503 })
      )
    );
    show();
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText("No tenders are accepting bids")).toBeNull();
  });
  it("uses the tab-specific empty state and shows pagination even on an out-of-range page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.endsWith("/access")
                ? {}
                : { total: 0, page: 4, pageSize: 10, totalPages: 1, currentTurn: 5, tenders: [] }
            ),
            { status: 200 }
          )
      )
    );
    show("awarded", "all", 4);
    expect(await screen.findByText("No tenders have been awarded")).toBeTruthy();
    expect(screen.getByText("This page has no results. Return to an earlier page.")).toBeTruthy();
  });
});
