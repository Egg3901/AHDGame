/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UnionPoliticalContributionsPanel } from "./UnionPoliticalContributionsPanel";
import { MAX_POLITICAL_CONTRIBUTION_OF_FCF } from "@/lib/unions/unionPoliticalContributions";

afterEach(() => vi.restoreAllMocks());

function panel(
  overrides: Partial<React.ComponentProps<typeof UnionPoliticalContributionsPanel>> = {}
) {
  return (
    <UnionPoliticalContributionsPanel
      unionId="u1"
      countryId="US"
      members={100}
      duesPerWorkerAnnual={4.8}
      annualWage={10}
      activeServices={[]}
      politicalContributionPct={0}
      myInfluencePct={40}
      isHead
      suspended={false}
      onSaved={() => {}}
      {...overrides}
    />
  );
}

describe("UnionPoliticalContributionsPanel", () => {
  it("gives the head a 0-50 slider of remaining budget", () => {
    render(panel());

    const slider = screen.getByRole("slider", {
      name: /percent of remaining budget/i,
    });
    expect((slider as HTMLInputElement).disabled).toBe(false);
    expect(slider.getAttribute("max")).toBe(String(MAX_POLITICAL_CONTRIBUTION_OF_FCF * 100));
  });

  it("sends the rate as a 0-0.5 fraction", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(panel());

    fireEvent.change(screen.getByRole("slider", { name: /percent of remaining budget/i }), {
      target: { value: "40" },
    });
    fireEvent.click(screen.getByRole("button", { name: /set political contributions/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/unions/u1/political-contributions");
    expect(JSON.parse(init.body).politicalContributionPct).toBeCloseTo(0.4, 9);
  });

  it("shows a non-head the rate, not the slider", () => {
    render(panel({ isHead: false, politicalContributionPct: 0.4 }));

    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.queryByRole("button", { name: /set political contributions/i })).toBeNull();
    expect(screen.getByText(/sends 40% of remaining budget/i)).toBeTruthy();
  });
});
