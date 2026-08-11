/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RegionReferendumCampaign } from "./RegionReferendumCampaign";

function campaignRef(over: Record<string, unknown> = {}) {
  return {
    id: "r1",
    regionId: "NIR",
    kind: "reunification",
    status: "campaigning",
    campaignCloseTurn: 50,
    yesShare: 57,
    ...over,
  };
}

function mockReferendums(referendums: unknown[], currentTurn = 26) {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: async () => ({ referendums, currentTurn }),
  });
}

describe("RegionReferendumCampaign", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders nothing when this region has no campaigning referendum", async () => {
    mockReferendums([campaignRef({ regionId: "SCO" }), campaignRef({ status: "requested" })]);
    const { container } = render(<RegionReferendumCampaign countryId="UK" regionId="NIR" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it("shows the read-only bar and links to the campaign detail page (no inline spend)", async () => {
    mockReferendums([campaignRef()]);
    render(<RegionReferendumCampaign countryId="UK" regionId="NIR" />);
    await waitFor(() => expect(screen.getByText(/Yes 57%/)).toBeTruthy());
    expect(screen.getByText(/Public Campaign/i)).toBeTruthy();
    expect(screen.getByText(/vote is held on turn 50/)).toBeTruthy();
    const link = screen.getByRole("link", { name: /View Campaign/i });
    expect(link.getAttribute("href")).toBe("/country/uk/referendums/nir");
    // Spending lives on the detail page now — no buttons here.
    expect(screen.queryByRole("button", { name: /Campaign for/i })).toBeNull();
  });
});
