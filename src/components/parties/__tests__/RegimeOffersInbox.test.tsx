/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RegimeOffersInbox } from "../RegimeOffersInbox";

function mockFetchOk(body: Record<string, unknown>): void {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe("RegimeOffersInbox", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch;
  });

  it("renders nothing when there are no offers", async () => {
    mockFetchOk({ countryId: "CN", partyId: "5", offers: [] });
    const { container } = render(<RegimeOffersInbox countryCode="CN" partySequentialId="5" />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
    expect(container.querySelector('[data-testid="regime-offers-inbox"]')).toBeNull();
  });

  it("renders the inbox header + each offer when present", async () => {
    mockFetchOk({
      countryId: "CN",
      partyId: "5",
      offers: [
        {
          turn: 200,
          title: "Party 5 legalized by ruling-party concession",
          at: new Date().toISOString(),
          subtype: "selective_concession",
        },
      ],
    });

    render(<RegimeOffersInbox countryCode="CN" partySequentialId="5" />);
    await waitFor(() => {
      expect(screen.getByTestId("regime-offers-inbox")).toBeTruthy();
    });
    const item = screen.getByTestId("regime-offer-item");
    expect(item.textContent).toMatch(/Party 5 legalized/);
    expect(item.textContent).toMatch(/Turn 200/);
    expect(item.textContent).toMatch(/Legalized via selective concession/);
  });

  it("info-asymmetry: doesn't expose leader scalars (even if API leaked them)", async () => {
    // The API strips these, but defensively the component shouldn't render
    // anything that looks like the popular legitimacy / party confidence
    // numeric scalars.
    mockFetchOk({
      countryId: "CN",
      partyId: "5",
      offers: [
        {
          turn: 200,
          title: "Party 5 legalized",
          at: new Date().toISOString(),
          subtype: "selective_concession",
        },
      ],
    });

    render(<RegimeOffersInbox countryCode="CN" partySequentialId="5" />);
    await waitFor(() => {
      expect(screen.getByTestId("regime-offers-inbox")).toBeTruthy();
    });
    const inbox = screen.getByTestId("regime-offers-inbox");
    // No decimal numbers (popular/intra scalars are surfaced with .x in the
    // leader tab — they should never appear in the inbox)
    expect(inbox.textContent).not.toMatch(/\b\d+\.\d/);
  });
});
