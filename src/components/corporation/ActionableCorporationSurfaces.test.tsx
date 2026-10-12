// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import DealsTab from "./DealsTab";
import SponsoredFundPanel from "./SponsoredFundPanel";
import { fetchJson } from "@/lib/observability/fetchJson";
import { NationalizationStatusCard } from "./NationalizationStatusCard";

vi.mock("@/contexts/RegisteredCountriesContext", () => ({
  useCountryDisplayName: () => (id: string) => id,
}));
vi.mock("@/lib/observability/fetchJson", () => ({ fetchJson: vi.fn() }));
vi.mock("./MergerReviewPanel", () => ({ default: () => <p>Merger review</p> }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function respond(data: unknown) {
  vi.mocked(fetchJson).mockResolvedValue(data);
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => data });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("corporation action visibility", () => {
  it("does not mount acquisition controls or fetch management data for a spectator", () => {
    const fetch = respond({ enabled: true, incoming: [], outgoing: [] });
    const { container } = render(<DealsTab corpId="1" isCeo={false} />);
    expect(container.innerHTML).toBe("");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renders no dead-end acquisition panel when acquisitions are disabled", async () => {
    const fetch = respond({ enabled: false, incoming: [], outgoing: [] });
    const { container } = render(<DealsTab corpId="1" isCeo />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("keeps available acquisition controls", async () => {
    respond({ enabled: true, incoming: [], outgoing: [] });
    render(<DealsTab corpId="1" isCeo />);
    expect(await screen.findByRole("button", { name: "Send offer" })).toBeTruthy();
  });

  it("hides fund creation when the server denies capability", async () => {
    respond({ canCreate: false, funds: [] });
    const { container } = render(<SponsoredFundPanel corpId="1" />);
    await waitFor(() => expect(fetchJson).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector("form")).toBeNull());
    expect(container.innerHTML).toBe("");
  });

  it("reduces existing sponsored funds to linked context when creation is unavailable", async () => {
    respond({
      canCreate: false,
      funds: [
        {
          id: "fund",
          name: "Sample Fund",
          slug: "sample",
          scope: "global",
          ticker: "SAMP",
          status: "active",
          kind: "broad",
          countryId: null,
        },
      ],
    });
    const { container } = render(<SponsoredFundPanel corpId="1" />);
    expect(await screen.findByRole("link", { name: "Sample Fund" })).toBeTruthy();
    expect(container.textContent).toBe("This corporation sponsors Sample Fund.");
    expect(container.querySelector("form, input, select, button")).toBeNull();
  });

  it("mounts the creation form only after a positive server capability", async () => {
    respond({ canCreate: true, funds: [] });
    render(<SponsoredFundPanel corpId="1" />);
    expect(await screen.findByRole("textbox", { name: "Fund name" })).toBeTruthy();
  });

  it("gives an exposed nonbidder one plain nationalization sentence", async () => {
    const { fetchJson } = await import("@/lib/observability/fetchJson");
    vi.mocked(fetchJson).mockResolvedValue({
      hasStatus: true,
      canBid: false,
      pendingTaking: { deadlineTurn: 90 },
      billsInVoting: [],
      auction: { countryId: "US", auctionId: "auction" },
    });
    const { container } = render(<NationalizationStatusCard corpId="1" hasExposure />);
    expect(
      await screen.findByText("Nationalization is pending and is due on turn 90.")
    ).toBeTruthy();
    expect(container.querySelector("a, button, input, select")).toBeNull();
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("hides nationalization status for an unexposed spectator", async () => {
    const { fetchJson } = await import("@/lib/observability/fetchJson");
    vi.mocked(fetchJson).mockResolvedValue({
      hasStatus: true,
      canBid: false,
      pendingTaking: null,
      billsInVoting: [],
      auction: { countryId: "US", auctionId: "auction" },
    });
    const { container } = render(<NationalizationStatusCard corpId="1" />);
    await waitFor(() => expect(fetchJson).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("uses server exposure when private holdings are absent from the page", async () => {
    vi.mocked(fetchJson).mockResolvedValue({
      hasStatus: true,
      hasExposure: true,
      canBid: false,
      pendingTaking: null,
      billsInVoting: [],
      auction: { countryId: "US", auctionId: "auction" },
    });
    const { container } = render(<NationalizationStatusCard corpId="1" />);
    expect(
      await screen.findByText("This corporation is being sold at a privatization auction.")
    ).toBeTruthy();
    expect(container.querySelector("a, button")).toBeNull();
  });

  it("keeps the auction link for a viewer with bid capability", async () => {
    const { fetchJson } = await import("@/lib/observability/fetchJson");
    vi.mocked(fetchJson).mockResolvedValue({
      hasStatus: true,
      canBid: true,
      pendingTaking: null,
      billsInVoting: [],
      auction: { countryId: "US", auctionId: "auction" },
    });
    render(<NationalizationStatusCard corpId="1" />);
    expect(await screen.findByRole("link", { name: "Place a bid" })).toBeTruthy();
  });
});
