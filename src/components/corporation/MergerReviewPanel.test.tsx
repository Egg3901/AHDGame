// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import MergerReviewPanel from "./MergerReviewPanel";

const involving = [
  {
    id: "r1",
    acquirerName: "Northern Steel",
    targetName: "Clyde Foundry",
    countryId: "UK",
    seatName: "Board of Trade",
    leadSectorType: "manufacturing",
    combinedSharePercent: 71,
    thresholdPercent: 60,
    status: "pending" as const,
    openedAtTurn: 10,
    decideByTurn: 18,
    defaultDecision: "clearedWithRemedy",
  },
];

function mockFetch(body: unknown) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => body });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MergerReviewPanel (corporation side)", () => {
  it("shows the CEO the referrals their own deals are caught in", async () => {
    vi.stubGlobal("fetch", mockFetch({ involving }));
    render(<MergerReviewPanel />);

    expect(await screen.findByText(/Northern Steel to Clyde Foundry/)).toBeTruthy();
    expect(screen.getByText(/Deals of yours that competition policy has touched/)).toBeTruthy();
  });

  it("never offers the officeholder's decision controls", async () => {
    vi.stubGlobal("fetch", mockFetch({ involving }));
    render(<MergerReviewPanel />);

    await screen.findByText(/Northern Steel to Clyde Foundry/);
    expect(screen.queryByRole("button", { name: /^Block$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Clear$/ })).toBeNull();
  });

  it("renders nothing when no deal of theirs has been referred", async () => {
    const fetchMock = mockFetch({ involving: [] });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<MergerReviewPanel />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/merger-reviews"));
    expect(container.textContent).toBe("");
  });
});
