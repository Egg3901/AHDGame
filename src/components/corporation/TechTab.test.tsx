/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import TechTab from "./TechTab";

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    toInternalFrom: (amount: number) => amount,
    formatFull: (amount: number) => `$${Math.round(amount).toLocaleString("en-US")}`,
    formatAmount: (amount: number) => `$${Math.round(amount).toLocaleString("en-US")}`,
  }),
}));

function makeNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "corp-2019-1",
    name: "Corporate research foundation",
    description: "A shared starting technology.",
    slot: 1,
    parentSlot: null,
    prereqSlots: [],
    exclusiveGroup: null,
    cost: 8,
    cashCost: 0,
    effects: [{ category: "growth", label: "+1% growth" }],
    unlocksStrategy: null,
    owned: false,
    autoGranted: false,
    laneLocked: false,
    prereqMet: true,
    pathLocked: false,
    affordable: true,
    image: "https://cdn.ahousedividedgame.com/static/tech/corp/2019.webp",
    ...overrides,
  };
}

function responseWithTree(
  committedLane: "generic" | "sector" | null = null,
  rivalSpecializationLocked = false
) {
  return {
    enabled: true,
    sectorLabel: "Energy",
    currencyCode: "USD",
    currentDecadeId: "2019",
    isCeo: true,
    redacted: false,
    rdScore: 10,
    liquidCapital: 1_000_000,
    cashPricing: {
      dailyGrossOperatingScale: 2_635_025_294,
      defaultRevenueFraction: 0.15,
      capacityFloorApplied: true,
    },
    decades: [
      {
        id: "2009",
        label: "2009–2019",
        reached: true,
        autoGrantedDecade: true,
        committedLane: null,
        lanes: {
          generic: [
            makeNode({
              id: "corp-2009-1",
              name: "Past corporate baseline",
              autoGranted: true,
              owned: true,
              affordable: false,
              image: "https://cdn.ahousedividedgame.com/static/tech/corp/2009.webp",
            }),
          ],
          sector: [
            makeNode({
              id: "energy-2009-1",
              name: "Past sector baseline",
              autoGranted: true,
              owned: true,
              affordable: false,
              image: "https://cdn.ahousedividedgame.com/static/tech/sector/energy/2009.webp",
            }),
          ],
        },
      },
      {
        id: "2019",
        label: "2019–2029",
        reached: true,
        autoGrantedDecade: false,
        committedLane,
        lanes: {
          generic: [
            makeNode({ laneLocked: committedLane === "sector" }),
            makeNode({
              id: "corp-2019-2",
              name: "Corporate branch step",
              slot: 2,
              parentSlot: 1,
              prereqSlots: [1],
              laneLocked: committedLane === "sector",
              affordable: false,
              cost: 14,
              cashCost: 100,
            }),
          ],
          sector: [
            makeNode({
              id: "energy-2019-1",
              name: "Sector research foundation",
              image: "https://cdn.ahousedividedgame.com/static/tech/sector/energy/2019.webp",
            }),
            makeNode({
              id: "energy-2019-2",
              name: "Fuel Economy Fleets",
              slot: 2,
              parentSlot: 1,
              prereqSlots: [1],
              cost: 28,
              cashCost: 18_000_000,
              affordable: false,
            }),
            makeNode({
              id: "energy-2019-3",
              name: "Slurry and Bulk Systems",
              slot: 3,
              parentSlot: 1,
              prereqSlots: [1],
              prereqMet: false,
              affordable: false,
            }),
            makeNode({
              id: "energy-2019-10",
              name: "Premium Service Network",
              slot: 10,
              exclusiveGroup: "specialization",
              prereqSlots: [8, 9],
              prereqMet: true,
              affordable: true,
            }),
            makeNode({
              id: "energy-2019-11",
              name: "Resilience Specialization",
              slot: 11,
              exclusiveGroup: "specialization",
              prereqSlots: [8, 9],
              prereqMet: true,
              pathLocked: rivalSpecializationLocked,
              affordable: true,
            }),
          ],
        },
      },
    ],
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        enabled: true,
        sectorLabel: "Corporate",
        currencyCode: "USD",
        currentDecadeId: "1953",
        isCeo: true,
        redacted: false,
        rdScore: 10,
        liquidCapital: 61_413_924,
        cashPricing: {
          dailyGrossOperatingScale: 2_635_025_294,
          defaultRevenueFraction: 0.15,
          capacityFloorApplied: true,
        },
        decades: [],
      }),
    })
  );
});

describe("TechTab cash pricing", () => {
  it("names the inputs that can move a technology's cash price", async () => {
    render(<TechTab corporationId="624" isCeo />);

    await waitFor(() => expect(screen.getByText("How cash prices work")).toBeTruthy());
    expect(screen.getByText(/15% of the corporation's \$2,635,025,294 daily gross/)).toBeTruthy();
    expect(screen.getByText(/Market cap and profit do not set the price/)).toBeTruthy();
    expect(screen.getByText(/Owned plant capacity is the minimum pricing basis/)).toBeTruthy();
    expect(screen.getByText(/Exchange rates can move the converted total/)).toBeTruthy();
  });
});

describe("TechTab research tree", () => {
  it("restores tech illustrations and explains baseline grants, prerequisites, and funding gaps", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => responseWithTree(),
    } as Response);

    const { container } = render(<TechTab corporationId="624" isCeo />);

    expect(await screen.findByRole("heading", { name: "Corporate track" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Sector track" })).toBeTruthy();
    expect(container.querySelector("img")?.getAttribute("src")).toContain("/corp/2019.webp");
    fireEvent.click(screen.getByRole("button", { name: /Earlier decades/ }));
    expect(screen.getByText(/Both tracks are granted as baseline research/)).toBeTruthy();
    expect(screen.getByText("Needs 18 more R&D and $17,000,000 more cash")).toBeTruthy();
    expect(screen.getByText("Unlock Sector research foundation first")).toBeTruthy();
    expect(screen.getAllByText("Baseline, no cost")).toHaveLength(2);
  });

  it("explains track commitment before confirming the first research choice", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => responseWithTree(),
    } as Response);

    render(<TechTab corporationId="624" isCeo />);

    const unlockButtons = await screen.findAllByRole("button", { name: "Unlock" });
    fireEvent.click(unlockButtons[0]);

    expect(await screen.findByText(/This is your first research in the decade/)).toBeTruthy();
    expect(
      screen.getByText(/The other track stays locked unless you abandon this decade/)
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unlock technology" })).toBeTruthy();
  });

  it("shows the selected track and specialization lock from the research graph", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => responseWithTree("sector", true),
    } as Response);

    render(<TechTab corporationId="624" isCeo />);

    expect(await screen.findByText(/Committed to the Sector track/)).toBeTruthy();
    expect(screen.getAllByText("Locked by Sector track").length).toBeGreaterThan(0);
    expect(screen.getByText("Another specialization is selected")).toBeTruthy();

    const specialization = screen
      .getByRole("heading", { name: "Premium Service Network" })
      .closest("article");
    fireEvent.click(within(specialization!).getByRole("button", { name: "Unlock" }));
    expect(
      await screen.findByText(/locks the other choices in this group for the decade/)
    ).toBeTruthy();
  });
});
