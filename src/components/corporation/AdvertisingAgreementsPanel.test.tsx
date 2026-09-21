/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import AdvertisingAgreementsPanel from "./AdvertisingAgreementsPanel";

afterEach(cleanup);
afterEach(() => vi.unstubAllGlobals());

interface Agreement {
  id: string;
  role: "buyer" | "supplier";
  status: string;
  allocationShareBps: number;
  durationTurns?: number;
  lastEffectiveAnchor?: number;
  lastOverlap?: number;
  counterparty?: { id: string; name: string; ticker?: string };
}

function stubFetch(agreements: Agreement[]) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        url,
        method,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      });
      if (method === "GET") {
        return { ok: true, json: async () => ({ agreements }) };
      }
      return { ok: true, json: async () => ({ success: true }) };
    })
  );
  return calls;
}

describe("AdvertisingAgreementsPanel", () => {
  it("inspects agreements with role, share, and last settlement stats", async () => {
    stubFetch([
      {
        id: "ad1",
        role: "buyer",
        status: "active",
        allocationShareBps: 2500,
        lastEffectiveAnchor: 130,
        lastOverlap: 0.8,
        counterparty: { id: "supplier", name: "Media Co", ticker: "MED" },
      },
    ]);
    render(<AdvertisingAgreementsPanel corpId="corp1" />);

    expect(await screen.findByText("Media Co")).toBeTruthy();
    expect(screen.getByText("buyer")).toBeTruthy();
    expect(screen.getByText("active")).toBeTruthy();
    expect(screen.getByText("25% of budget")).toBeTruthy();
    expect(screen.getByText(/last coverage overlap 80%/i)).toBeTruthy();
    expect(screen.getByText(/effective value 130/i)).toBeTruthy();
  });

  it("proposes an agreement through the corporation route", async () => {
    const calls = stubFetch([]);
    render(<AdvertisingAgreementsPanel corpId="corp1" />);
    await screen.findByText(/coverage advertising/i);

    fireEvent.change(screen.getByLabelText("Advertising supplier corporation ID"), {
      target: { value: "supplier-id" },
    });
    fireEvent.change(screen.getByLabelText("Marketing budget share percent"), {
      target: { value: "25" },
    });
    fireEvent.change(screen.getByLabelText("Agreement duration turns"), {
      target: { value: "12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Propose agreement" }));

    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    const post = calls.find((call) => call.method === "POST")!;
    expect(post.url).toBe("/api/corporations/corp1/advertising-agreements");
    expect(post.body).toEqual({
      supplierCorpId: "supplier-id",
      allocationShareBps: 2500,
      durationTurns: 12,
    });
    expect(await screen.findByText("Advertising proposal sent")).toBeTruthy();
  });

  it("accepts a pending agreement as the supplier", async () => {
    const calls = stubFetch([
      {
        id: "ad1",
        role: "supplier",
        status: "pending",
        allocationShareBps: 2500,
        counterparty: { id: "buyer", name: "Buyer Co" },
      },
    ]);
    render(<AdvertisingAgreementsPanel corpId="corp1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));

    await waitFor(() => expect(calls.some((call) => call.method === "PATCH")).toBe(true));
    const patch = calls.find((call) => call.method === "PATCH")!;
    expect(patch.url).toBe("/api/corporations/corp1/advertising-agreements/ad1");
    expect(patch.body).toEqual({ action: "accept" });
    expect(await screen.findByText("Agreement accepted")).toBeTruthy();
  });

  it("does not offer accept to a pending buyer", async () => {
    stubFetch([
      {
        id: "ad1",
        role: "buyer",
        status: "pending",
        allocationShareBps: 2500,
        counterparty: { id: "supplier", name: "Media Co" },
      },
    ]);
    render(<AdvertisingAgreementsPanel corpId="corp1" />);

    await screen.findByText("Media Co");
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });

  it("cancels an active agreement", async () => {
    const calls = stubFetch([
      {
        id: "ad1",
        role: "buyer",
        status: "active",
        allocationShareBps: 2500,
        counterparty: { id: "supplier", name: "Media Co" },
      },
    ]);
    render(<AdvertisingAgreementsPanel corpId="corp1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(calls.some((call) => call.method === "PATCH")).toBe(true));
    expect(calls.find((call) => call.method === "PATCH")!.body).toEqual({
      action: "cancel",
    });
    expect(await screen.findByText("Agreement canceled")).toBeTruthy();
  });

  it("surfaces a failed action without clearing the list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!init?.method || init.method === "GET") {
          return {
            ok: true,
            json: async () => ({
              agreements: [
                {
                  id: "ad1",
                  role: "supplier",
                  status: "pending",
                  allocationShareBps: 2500,
                  counterparty: { id: "buyer", name: "Buyer Co" },
                },
              ],
            }),
          };
        }
        return { ok: false, json: async () => ({ error: "allocation_exceeds_budget" }) };
      })
    );
    render(<AdvertisingAgreementsPanel corpId="corp1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    expect(await screen.findByText("allocation_exceeds_budget")).toBeTruthy();
    expect(screen.getByText("Buyer Co")).toBeTruthy();
  });
});
