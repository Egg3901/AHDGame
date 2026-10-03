// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en/worldConflicts.json";
import BulgarianConstitutionalDecisionPanel from "./BulgarianConstitutionalDecisionPanel";
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function show() {
  render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      <BulgarianConstitutionalDecisionPanel />
    </NextIntlClientProvider>
  );
}
describe("Bulgarian constitutional decision controls", () => {
  it("opens the actual parliamentary bill and navigates to its vote", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ decision: { available: true, reason: "available", proposal: null } })
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ billId: "synthetic-bill" }), { status: 201 })
      );
    vi.stubGlobal("fetch", fetcher);
    show();
    fireEvent.click(
      await screen.findByRole("button", { name: "Introduce the constitution draft" })
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/congress/bills/synthetic-bill"));
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ kind: "constitution1991" });
  });
  it("shows an unopened date and an existing failed decision's revision", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            decision: { available: false, reason: "before-date", proposal: null },
          })
        )
      )
    );
    show();
    await screen.findByText("This decision opens in July 1991.");
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            decision: {
              available: true,
              reason: "available",
              proposal: { billId: "old-bill", billStatus: "failed", canRevise: true },
            },
          })
        )
      )
    );
    show();
    await screen.findByRole("button", { name: "Introduce a revised draft" });
    expect((screen.getByRole("link") as HTMLAnchorElement).getAttribute("href")).toBe(
      "/congress/bills/old-bill"
    );
  });
  it("keeps a refused decision visible and reports the conflict", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ decision: { available: true, reason: "available", proposal: null } })
          )
        )
        .mockResolvedValueOnce(new Response(null, { status: 409 }))
    );
    show();
    fireEvent.click(
      await screen.findByRole("button", { name: "Introduce the constitution draft" })
    );
    await screen.findByRole("alert");
    expect(push).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Introduce the constitution draft",
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false)
    );
  });
  it("shows pending collective signature progress without navigating to a nonexistent bill", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            decision: {
              available: true,
              reason: "available",
              proposal: null,
              initiative: { support: 98, required: 100, canIntroduce: false },
            },
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ initiative: { support: 99, required: 100, canIntroduce: false } }),
          { status: 202 }
        )
      );
    vi.stubGlobal("fetch", fetcher);
    show();
    await screen.findByText("Collective initiative: 98 of 100 required deputy signatures.");
    fireEvent.click(await screen.findByRole("button", { name: "Endorse the collective draft" }));
    await screen.findByText("Collective initiative: 99 of 100 required deputy signatures.");
    expect(push).not.toHaveBeenCalled();
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      kind: "constitution1991",
      action: "endorse",
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("opens the normal bill when the collective signature reaches its threshold", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            decision: {
              available: true,
              reason: "available",
              proposal: null,
              initiative: { support: 99, required: 100, canIntroduce: false },
            },
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            billId: "collective-bill",
            initiative: { support: 100, required: 100, canIntroduce: true },
          }),
          { status: 201 }
        )
      );
    vi.stubGlobal("fetch", fetcher);
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Endorse the collective draft" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/congress/bills/collective-bill"));
  });
});
