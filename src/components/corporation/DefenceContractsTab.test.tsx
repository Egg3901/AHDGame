/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import DefenceContractsTab from "./DefenceContractsTab";
import type { CorporationContractView, CorporationDefenceView } from "./CorporationPageTypes";

afterEach(cleanup);

// The panel formats money through the currency context; the identity stub keeps the
// assertions about the panel's own arithmetic rather than the formatter's.
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatAmount: (v: number) => `$${Math.round(v).toLocaleString("en-US")}` }),
}));

const contract = (over: Partial<CorporationContractView> = {}): CorporationContractView => ({
  _id: "c1",
  countryId: "RU",
  component: "ground",
  lotsOrdered: 100,
  lotsDelivered: 40,
  pricePerLot: 1_000,
  status: "active",
  projectedLotsPerTurn: 20,
  earned: 40_000,
  ...over,
});

const defence = (over: Partial<CorporationDefenceView> = {}): CorporationDefenceView => ({
  contracts: [contract()],
  pendingCount: 0,
  gradeCeiling: 2,
  totalEarned: 40_000,
  ...over,
});

function setup(over: Partial<React.ComponentProps<typeof DefenceContractsTab>> = {}) {
  return render(<DefenceContractsTab corpId="corp1" defence={defence()} isCeo {...over} />);
}

describe("DefenceContractsTab", () => {
  it("summarises the order book a CEO acts on", () => {
    setup();
    // 100 ordered - 40 delivered.
    expect(screen.getByText("60")).toBeTruthy();
    expect(screen.getByText("20")).toBeTruthy();
    expect(screen.getByText("$40,000")).toBeTruthy();
  });

  it("names the delivery grade rather than printing a bare number", () => {
    setup({ defence: defence({ gradeCeiling: 2 }) });
    expect(screen.getByText("Modernised")).toBeTruthy();
  });

  it("calls out a live contract that is delivering nothing", () => {
    setup({ defence: defence({ contracts: [contract({ projectedLotsPerTurn: 0 })] }) });
    expect(screen.getByText(/re-tooled off ground/)).toBeTruthy();
  });

  it("does not count a cancelled contract as outstanding work", () => {
    setup({
      defence: defence({
        contracts: [contract({ status: "cancelled", projectedLotsPerTurn: 0 })],
      }),
    });
    expect(screen.getByText("withdrawn")).toBeTruthy();
    expect(screen.queryByText(/will not advance until that changes/)).toBeNull();
  });

  it("tells a CEO with no contracts how one is offered", () => {
    setup({ defence: defence({ contracts: [], totalEarned: 0 }) });
    expect(screen.getByText(/Defence ministers award them/)).toBeTruthy();
  });

  it("gives a non-CEO viewer the plain fact instead", () => {
    setup({ defence: defence({ contracts: [], totalEarned: 0 }), isCeo: false });
    expect(screen.getByText(/holds no government procurement contracts/)).toBeTruthy();
    expect(screen.queryByText(/Defence ministers award them/)).toBeNull();
  });

  it("renders with no defence payload at all", () => {
    setup({ defence: undefined });
    expect(screen.getByText("Order book")).toBeTruthy();
    expect(screen.getByText("None")).toBeTruthy();
  });
});

describe("DefenceContractsTab — answering an offer", () => {
  const pending = () =>
    defence({
      contracts: [contract({ status: "pending", lotsDelivered: 0, earned: 0 })],
      pendingCount: 1,
    });

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }))
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("accepts an offer through the corporation's own route", async () => {
    const onUpdate = vi.fn();
    setup({ defence: pending(), onUpdate });

    fireEvent.click(screen.getByText("Accept"));

    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/corporations/corp1/defence-contracts/c1");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ action: "accept" });
  });

  it("declines through the same route", async () => {
    const onUpdate = vi.fn();
    setup({ defence: pending(), onUpdate });

    fireEvent.click(screen.getByText("Decline"));

    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    const [, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ action: "decline" });
  });

  // The minister can withdraw the offer between render and click; silence would read as a
  // dead button.
  it("surfaces the route's refusal rather than failing silently", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: "That offer has already been answered or withdrawn." }),
      }))
    );
    const onUpdate = vi.fn();
    setup({ defence: pending(), onUpdate });

    fireEvent.click(screen.getByText("Accept"));

    await waitFor(() =>
      expect(screen.getByText(/already been answered or withdrawn/)).toBeTruthy()
    );
    expect(onUpdate).not.toHaveBeenCalled();
  });

  // A pending offer is not work in progress — counting it would tell the CEO they have
  // throughput committed that nobody has agreed to.
  it("keeps an unanswered offer out of outstanding and throughput", () => {
    setup({ defence: pending() });
    expect(screen.getByText("Offers awaiting you")).toBeTruthy();
    expect(screen.getByText("awaiting your answer")).toBeTruthy();
    // Outstanding and per-turn are both 0 while nothing is accepted.
    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(2);
  });

  it("shows a non-CEO viewer the offer without the buttons", () => {
    setup({ defence: pending(), isCeo: false });
    expect(screen.getByText("Offers awaiting you")).toBeTruthy();
    expect(screen.queryByText("Accept")).toBeNull();
    expect(screen.queryByText("Decline")).toBeNull();
  });

  // Accepting a dead plant starts nothing — worth knowing before agreeing to build.
  it("warns when the offered plant is producing nothing", () => {
    setup({
      defence: defence({
        contracts: [
          contract({ status: "pending", lotsDelivered: 0, earned: 0, projectedLotsPerTurn: 0 }),
        ],
        pendingCount: 1,
      }),
    });
    expect(screen.getByText(/would not start deliveries/)).toBeTruthy();
  });
});
