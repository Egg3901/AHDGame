/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProductStudio } from "./ProductStudio";
import type { StudioView, VentureView } from "@/lib/products/venture/studio";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const tiers = [
  { id: "lean", label: "Lean", multiple: 0.5 },
  { id: "standard", label: "Standard", multiple: 1 },
  { id: "heavy", label: "Heavy", multiple: 1.5 },
  { id: "all_in", label: "All in", multiple: 2 },
].map((t, i) => ({
  ...t,
  fundingPerTurnAnchor: 100 * t.multiple,
  hitChance: [0.26, 0.43, 0.52, 0.58][i]!,
  boostFraction: 0.15,
}));

function studio(overrides: Partial<StudioView["domains"][number]> = {}, isCeo = true): StudioView {
  return {
    isCeo,
    currentTurn: 120,
    developmentTurns: 72,
    boostTurns: 72,
    boostRange: [0.1, 0.2],
    liquidCurrencyCode: null,
    domains: [
      {
        domain: "manufacturing",
        enabled: true,
        hasSectors: true,
        lines: [
          {
            id: "passenger_car",
            label: "Passenger car",
            available: true,
            liftedSectorCount: 2,
            baselineRevenueAnchor: 7200,
            targetAnchor: 5400,
            referenceFundingPerTurnAnchor: 75,
            oddsByTier: tiers,
          },
          {
            id: "home_appliance",
            label: "Home appliances",
            available: false,
            reason: "Needs a plant that produces electronics.",
            liftedSectorCount: 0,
            baselineRevenueAnchor: 0,
            targetAnchor: 1000,
            referenceFundingPerTurnAnchor: 14,
            oddsByTier: tiers,
          },
        ],
        active: null,
        recent: [],
        ...overrides,
      },
      {
        domain: "media",
        enabled: true,
        hasSectors: false,
        lines: [],
        active: null,
        recent: [],
      },
    ],
  };
}

function stub(view: StudioView) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      });
      return { ok: true, json: async () => view };
    })
  );
  return calls;
}

const active: VentureView = {
  id: "v1",
  domain: "manufacturing",
  lineId: "passenger_car",
  lineLabel: "Passenger car",
  name: "Falcon",
  stage: "development",
  startedTurn: 100,
  endTurn: 172,
  turnsRemaining: 52,
  fundingPerTurnAnchor: 75,
  referenceFundingPerTurnAnchor: 75,
  targetAnchor: 5400,
  investedAnchor: 1500,
  spentAnchor: 1600,
  pendingChargeAnchor: 0,
  currentQuality: 55.1,
  odds: {
    projectedQuality: 68,
    hitLow: 0.31,
    hitHigh: 0.52,
    boostLow: 0.13,
    boostHigh: 0.18,
    remainingTurns: 52,
  },
  pendingEvents: [
    {
      eventId: "mfg_supplier_defect",
      title: "A supplier ships defective parts",
      body: "A batch of inputs failed inspection.",
      deadlineTurn: 140,
      choices: [
        { id: "reject", label: "Reject and reorder", detail: "Costs 8%.", isDefault: false },
        { id: "rework", label: "Rework in house", detail: "Costs 4%.", isDefault: true },
      ],
    },
  ],
  resolvedEvents: [],
  liftedSectorCount: 2,
};

describe("ProductStudio", () => {
  it("renders nothing for domains that are off or have no matching sectors", async () => {
    const view = studio();
    view.domains = view.domains.map((d) => ({ ...d, enabled: false }));
    stub(view);
    const { container } = render(<ProductStudio corporationId="c1" />);
    await waitFor(() => expect(screen.queryByText("Loading product studio")).toBeNull());
    expect(container.textContent).toBe("");
  });

  it("explains the product in plain language with labeled fields and real numbers", async () => {
    stub(studio());
    render(<ProductStudio corporationId="c1" />);
    expect(await screen.findByLabelText("Product line")).toBeTruthy();
    expect(screen.getByLabelText("Product name")).toBeTruthy();
    expect(screen.getByText(/10 to 20 percent of revenue/i)).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Chance of a hit" })).toBeTruthy();
    expect(screen.getByText("43%")).toBeTruthy();
    expect(screen.queryByPlaceholderText(/corporation id/i)).toBeNull();
    expect(document.body.textContent).toMatch(/earn \S*7(\.2K|,200)\S* per turn now/);
    expect(screen.getByText(/Name your product to start/)).toBeTruthy();
  });

  it("lists lines the plants cannot make with the reason, never in the picker", async () => {
    stub(studio());
    render(<ProductStudio corporationId="c1" />);
    const picker = (await screen.findByLabelText("Product line")) as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual(["Passenger car"]);
    expect(screen.getByText(/Needs a plant that produces electronics/)).toBeTruthy();
  });

  it("starts development at the chosen funding level", async () => {
    const calls = stub(studio());
    render(<ProductStudio corporationId="c1" />);
    const start = await screen.findByRole("button", { name: "Start development" });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Product name"), { target: { value: "Falcon" } });
    fireEvent.click(screen.getByLabelText(/Heavy/));
    fireEvent.click(screen.getByRole("button", { name: "Start development" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")).toMatchObject({
      url: "/api/corporations/c1/ventures",
      body: {
        domain: "manufacturing",
        lineId: "passenger_car",
        name: "Falcon",
        fundingPerTurnAnchor: 150,
      },
    });
  });

  it("shows progress, an honest odds band and answers a decision", async () => {
    const calls = stub(studio({ active }));
    render(<ProductStudio corporationId="c1" />);
    expect(await screen.findByText("Falcon")).toBeTruthy();
    expect(screen.getByText("31% to 52%")).toBeTruthy();
    expect(screen.getByText(/13% to 18%/)).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Development progress" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Reject and reorder/ }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({
      url: "/api/corporations/c1/ventures/v1",
      body: { action: "answer_event", eventId: "mfg_supplier_defect", choiceId: "reject" },
    });
  });

  it("shows real revenue uplift, time left and lifetime return for a hit", async () => {
    render(<span />);
    cleanup();
    stub(
      studio({
        recent: [
          {
            ...active,
            stage: "released",
            outcome: "hit",
            pendingEvents: [],
            odds: null,
            finalQuality: 71.2,
            boostFraction: 0.16,
            boostTurnsRemaining: 48,
            upliftPerTurnAnchor: 1150,
            upliftToDateAnchor: 27600,
            netReturnAnchor: 26000,
          },
        ],
      })
    );
    render(<ProductStudio corporationId="c1" />);
    const item = await screen.findByText("Falcon");
    const text = item.closest("tr")!.textContent!;
    expect(text).toMatch(/16%, about \S*1\S* per turn, 2 days left/);
    expect(text).toMatch(/\+\S*26\S*/);
  });

  it("tells a flop there is no ongoing penalty", async () => {
    stub(
      studio({
        recent: [{ ...active, stage: "flopped", outcome: "flop", pendingEvents: [], odds: null }],
      })
    );
    render(<ProductStudio corporationId="c1" />);
    expect(await screen.findByText(/Money spent is not recovered/)).toBeTruthy();
  });

  it("hides start and answer controls from non-CEOs", async () => {
    stub(studio({ active }, false));
    render(<ProductStudio corporationId="c1" />);
    await screen.findByText("Falcon");
    expect(screen.queryByRole("button", { name: "Cancel development" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Reject and reorder/ })).toBeNull();
    expect(screen.getByText(/The CEO answers by turn/)).toBeTruthy();
  });
});
