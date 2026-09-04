/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BankingRolloutPanel } from "./BankingRolloutPanel";

afterEach(() => {
  vi.restoreAllMocks();
});

const snapshot = {
  privateBankingEnabled: false,
  state: { mode: "shadow", readCurrencies: [] },
  currentTurn: 120,
  gate: { ok: false, reasons: ["1 estate(s) claimed on earlier turns are still in resolution"] },
  comparison: {
    turn: 120,
    currencies: [
      {
        currency: "USD",
        legacyOwnerTotal: 1000,
        accountOwnerTotal: 1000,
        rowDiscrepancies: 0,
        discrepancies: 0,
      },
    ],
  },
  rollback: [
    {
      code: "stuck_estate",
      detail: "1 estate(s) claimed on earlier turns are still in resolution",
      suggested: { kind: "mode", mode: "off" },
    },
  ],
  decisions: [
    { change: { kind: "mode", mode: "off" }, allowed: true, reasons: [], direction: "narrow" },
    { change: { kind: "mode", mode: "shadow" }, allowed: true, reasons: [], direction: "none" },
    {
      change: { kind: "mode", mode: "authoritative" },
      allowed: false,
      reasons: ["Gate closed: 1 estate(s) claimed on earlier turns are still in resolution"],
      direction: "widen",
    },
    {
      change: { kind: "add_read_currency", currency: "USD" },
      allowed: false,
      reasons: ["The read cohort applies in authoritative mode only."],
      direction: "widen",
    },
  ],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("BankingRolloutPanel", () => {
  it("shows the gate, disables refused changes with their reason, and posts an allowed one", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    global.fetch = vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === "POST") {
        return Promise.resolve(json({ ...snapshot, state: { mode: "off", readCurrencies: [] } }));
      }
      return Promise.resolve(json(snapshot));
    }) as unknown as typeof fetch;

    render(<BankingRolloutPanel />);
    await waitFor(() => expect(screen.getByText("Gate closed")).toBeTruthy());
    expect(screen.getByText("Private banking off")).toBeTruthy();

    const authoritative = screen.getByRole("button", {
      name: "Authoritative",
    }) as HTMLButtonElement;
    expect(authoritative.disabled).toBe(true);
    expect(authoritative.title).toMatch(/Gate closed/);

    const addUsd = screen.getByRole("button", { name: "Add to cohort" }) as HTMLButtonElement;
    expect(addUsd.disabled).toBe(true);
    expect(addUsd.title).toMatch(/authoritative mode only/);

    // The rollback condition offers the narrowest fix, which always applies.
    const dropToOff = screen.getByRole("button", { name: "Drop to off" });
    fireEvent.click(dropToOff);
    await waitFor(() => expect(calls.some((c) => c.init?.method === "POST")).toBe(true));
    const posted = calls.find((c) => c.init?.method === "POST")!;
    expect(JSON.parse(posted.init!.body as string)).toEqual({ kind: "mode", mode: "off" });
  });
});
