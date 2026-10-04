// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en/worldConflicts.json";
import HungarianElectoralDecisionPanel from "./HungarianElectoralDecisionPanel";
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function show(kind?: "threshold1994" | "system2011") {
  render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      <HungarianElectoralDecisionPanel kind={kind} />
    </NextIntlClientProvider>
  );
}
describe("Hungarian electoral decision controls", () => {
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
    fireEvent.click(await screen.findByRole("button", { name: "Propose amendment" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/congress/bills/synthetic-bill"));
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ kind: "threshold1994" });
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
    await screen.findByText("This decision opens in January 1994.");
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
    await screen.findByRole("button", { name: "Propose revised amendment" });
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
    fireEvent.click(await screen.findByRole("button", { name: "Propose amendment" }));
    await screen.findByRole("alert");
    expect(push).not.toHaveBeenCalled();
    await waitFor(() =>
      expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false)
    );
  });
  it("opens the modern decision through its own bound bill endpoint", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ decision: { available: true, reason: "available", proposal: null } })
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ billId: "modern-bill" }), { status: 201 })
      );
    vi.stubGlobal("fetch", fetcher);
    show("system2011");
    expect(await screen.findByText("Hungarian 2011 electoral system")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Propose amendment" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/congress/bills/modern-bill"));
    expect(fetcher.mock.calls[1][0]).toBe("/api/country/hu/electoral-reform/2011/proposal");
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ kind: "system2011" });
  });
});
