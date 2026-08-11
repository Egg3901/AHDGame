/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import RestrictionsView from "./RestrictionsView";
import type { WorldTradeLedger } from "@/lib/trade/queries/worldTradeLedger";

const ledger = {
  nations: [
    { code: "US", name: "United States", hue: "#b9933f" },
    { code: "UK", name: "United Kingdom", hue: "#4f7fd8" },
    { code: "DE", name: "Germany", hue: "#d8b25e" },
  ],
  meta: { countries: [] },
} as unknown as WorldTradeLedger;

// RestrictionsView fetches two independent endpoints (embargoes + tariffs);
// route the mock by URL so each returns its own payload.
function mockRestrictions({
  items = [],
  pending = [],
  tariffs = [],
}: {
  items?: unknown[];
  pending?: unknown[];
  tariffs?: unknown[];
} = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () => (url.includes("/tariffs") ? { items: tariffs } : { items, pending }),
      })
    )
  );
}

function mockEmbargoes(items: unknown[], pending: unknown[] = []) {
  mockRestrictions({ items, pending });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RestrictionsView", () => {
  it("groups active embargoes by the imposing nation with a readable summary", async () => {
    mockEmbargoes([
      {
        id: "1",
        sourceCountry: "US",
        targetCountry: "UK",
        commodity: "all",
        direction: "both",
        mode: "block",
        cap: null,
        origin: "minister",
        expiresTurn: 98,
      },
      {
        id: "2",
        sourceCountry: "DE",
        targetCountry: "US",
        commodity: "steel",
        direction: "import",
        mode: "cap",
        cap: 5000,
        origin: "legislation",
        expiresTurn: null,
      },
    ]);

    render(<RestrictionsView ledger={ledger} />);

    expect(await screen.findByText("Block all goods traded with the United Kingdom")).toBeTruthy();
    expect(screen.getByText(/expires turn 98/)).toBeTruthy();
    expect(screen.getByText(/until repealed/)).toBeTruthy();
    expect(screen.getByText("2 active")).toBeTruthy();
  });

  it("shows pending embargo legislation that isn't yet in force", async () => {
    mockEmbargoes(
      [],
      [
        {
          billId: "b1",
          billTitle: "Steel Embargo Act",
          status: "floor_vote",
          action: "embargo",
          sourceCountry: "US",
          targetCountry: "DE",
          commodity: "steel",
          direction: "both",
          mode: "block",
          cap: null,
        },
      ]
    );
    render(<RestrictionsView ledger={ledger} />);
    expect(await screen.findByText(/Pending in legislation/)).toBeTruthy();
    expect(screen.getByText("Block Steel & Metals traded with Germany")).toBeTruthy();
    expect(screen.getByText(/Steel Embargo Act/)).toBeTruthy();
    expect(screen.getByText("Floor vote")).toBeTruthy();
    expect(screen.getByText(/1 pending/)).toBeTruthy();
  });

  it("shows an empty state when no embargoes or tariffs are in force", async () => {
    mockEmbargoes([], []);
    render(<RestrictionsView ledger={ledger} />);
    expect(await screen.findByText(/No embargoes or tariffs are in force/)).toBeTruthy();
  });

  it("groups active tariffs by the imposing nation with a readable scope summary", async () => {
    mockRestrictions({
      tariffs: [
        {
          id: "t1",
          countryId: "US",
          scopeType: "economy_wide",
          targetSectorType: null,
          targetOriginCountryId: null,
          targetCorporationName: null,
          rate: 12,
        },
        {
          id: "t2",
          countryId: "US",
          scopeType: "origin_country",
          targetSectorType: null,
          targetOriginCountryId: "DE",
          targetCorporationName: null,
          rate: 25,
        },
      ],
    });

    render(<RestrictionsView ledger={ledger} />);

    expect(await screen.findByText("All imported goods")).toBeTruthy();
    expect(screen.getByText("Goods from Germany")).toBeTruthy();
    expect(screen.getByText("12%")).toBeTruthy();
    expect(screen.getByText("25%")).toBeTruthy();
    // Two tariffs, no embargoes → still counts in the active total.
    expect(screen.getByText("2 active")).toBeTruthy();
  });

  it("renders embargoes and tariffs together when both are in force", async () => {
    mockRestrictions({
      items: [
        {
          id: "1",
          sourceCountry: "US",
          targetCountry: "UK",
          commodity: "all",
          direction: "both",
          mode: "block",
          cap: null,
          origin: "minister",
          expiresTurn: 98,
        },
      ],
      tariffs: [
        {
          id: "t1",
          countryId: "UK",
          scopeType: "sector",
          targetSectorType: "manufacturing",
          targetOriginCountryId: null,
          targetCorporationName: null,
          rate: 8,
        },
      ],
    });

    render(<RestrictionsView ledger={ledger} />);

    expect(await screen.findByText("Embargoes")).toBeTruthy();
    expect(screen.getByText("Tariffs")).toBeTruthy();
    expect(screen.getByText("Block all goods traded with the United Kingdom")).toBeTruthy();
    expect(screen.getByText("8%")).toBeTruthy();
    expect(screen.getByText("2 active")).toBeTruthy();
  });
});
