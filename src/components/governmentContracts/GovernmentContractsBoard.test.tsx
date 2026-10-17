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
  it("opens a notification's tender even outside the visible results page", async () => {
    const focus = "d".repeat(24);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.endsWith("/access")
                ? {}
                : url.endsWith(focus)
                  ? {
                      tender: {
                        ...row,
                        _id: focus,
                        title: "Linked concession",
                        tab: "closed",
                        status: "open",
                        canManage: false,
                        bids: [],
                        bidHistory: [],
                      },
                      currentTurn: 8,
                    }
                  : { tenders: [row], total: 23, page: 2, totalPages: 3, currentTurn: 8 }
            )
          )
      )
    );
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <GovernmentContractsBoard
          countryId="JP"
          countryName="Japan"
          focusTenderId={focus}
          page={2}
        />
      </NextIntlClientProvider>
    );
    expect(await screen.findByRole("heading", { name: /Linked concession/ })).toBeTruthy();
    expect(screen.getByText("No bids are available to display.")).toBeTruthy();
  });
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

  it.each(["defence", "extraction"] as const)(
    "warns and requires a fresh acknowledgement for a conflicted %s award",
    async (type) => {
      const conflicted = "b".repeat(24),
        independent = "c".repeat(24);
      const closed = {
        ...row,
        tab: "closed",
        status: "open",
        canManage: true,
        bidHistory: [],
        terms:
          type === "defence"
            ? row.terms
            : {
                type: "extraction",
                stateId: "JP-01",
                resource: "oil",
                share: 0.3,
                termTurns: 48,
                royaltyRatePerTurn: 0.01,
                minimumSigningFeeAnchor: 0,
              },
        bids: [
          { corporationId: conflicted, corporationName: "Related supplier", amount: 90 },
          { corporationId: independent, corporationName: "Independent supplier", amount: 95 },
        ],
        awardWarnings: {
          [conflicted]: { basis: "owner", stakeShare: 0, favorabilityPenalty: 4.1 },
        },
      };
      const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST")
          return new Response(JSON.stringify({ contractId: "contract" }));
        return new Response(
          JSON.stringify(
            url.endsWith("/access")
              ? {}
              : url.endsWith(row._id)
                ? { tender: closed, currentTurn: 8 }
                : {
                    tenders: [closed],
                    total: 1,
                    page: 1,
                    pageSize: 10,
                    totalPages: 1,
                    currentTurn: 8,
                  }
          )
        );
      });
      vi.stubGlobal("fetch", fetcher);
      show("closed", type, 1);
      fireEvent.click(await screen.findByRole("button", { name: "View terms and bids" }));
      const radios = await screen.findAllByRole("radio");
      fireEvent.click(radios[0]);
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "Reason for this award." },
      });
      expect(screen.getByRole("alert").textContent).toContain("4.1 favorability");
      const award = screen.getByRole("button", { name: "Award selected bid" }) as HTMLButtonElement;
      expect(award.disabled).toBe(true);
      fireEvent.click(screen.getByRole("checkbox"));
      expect(award.disabled).toBe(false);
      fireEvent.click(radios[1]);
      expect(screen.queryByRole("checkbox")).toBeNull();
      fireEvent.click(radios[0]);
      expect(award.disabled).toBe(true);
      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(award);
      await waitFor(() =>
        expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true)
      );
      const post = fetcher.mock.calls.find(([, init]) => init?.method === "POST")!;
      expect(JSON.parse(post[1]!.body as string)).toMatchObject({
        corporationId: conflicted,
        acknowledgeConflict: true,
      });
    }
  );

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
