/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MAX_DUES_FRACTION_OF_WAGE } from "@/lib/unions/unionDues";
import { UnionDuesPanel } from "./UnionDuesPanel";

afterEach(() => vi.restoreAllMocks());

/**
 * A member's annual wage in this economy is single digits, which is exactly the
 * scale that broke the old cash slider: the 10% ceiling came out near 1 and the
 * control rounded its whole range to "0" or "1".
 */
const ANNUAL_WAGE = 9.55;

function panel(overrides: Partial<React.ComponentProps<typeof UnionDuesPanel>> = {}) {
  return (
    <UnionDuesPanel
      unionId="u1"
      countryId="US"
      members={251_023}
      duesPerWorkerAnnual={0}
      annualWage={ANNUAL_WAGE}
      activeServices={[]}
      isHead
      suspended={false}
      onSaved={() => {}}
      {...overrides}
    />
  );
}

describe("UnionDuesPanel", () => {
  it("gives the head a usable range on a single-digit wage, not two positions", () => {
    render(panel());

    const slider = screen.getByRole("slider", { name: /percent of member wages/i });
    expect((slider as HTMLInputElement).disabled).toBe(false);
    // Percent of wage, so the range is 0-10 in 0.1 steps regardless of how small
    // the cash figure is: ~100 reachable rates instead of the old 0-or-1.
    expect(slider.getAttribute("max")).toBe(String(MAX_DUES_FRACTION_OF_WAGE * 100));
    expect(slider.getAttribute("step")).toBe("0.1");
  });

  it("sends an absolute annual rate derived from the percent, so the API is unchanged", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(panel());

    fireEvent.change(screen.getByRole("slider", { name: /percent of member wages/i }), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /set dues/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/unions/u1/dues");
    expect(JSON.parse(init.body).duesPerWorkerAnnual).toBeCloseTo(ANNUAL_WAGE * 0.02, 9);
  });

  it("shows the cash equivalent with enough precision to tell two rates apart", () => {
    render(panel({ duesPerWorkerAnnual: ANNUAL_WAGE * 0.02 }));

    // 0.19 a year, which the old whole-unit readout rendered as "0".
    expect(screen.getAllByText(/0\.19/).length).toBeGreaterThan(0);
  });

  it("explains what the treasury is for, which is what ticket 1112 asked", () => {
    render(panel());

    expect(screen.getByText(/funds services, organizing drives and bargaining/i)).toBeTruthy();
  });

  it("locks the slider and says why when the union represents no paid workforce", () => {
    render(panel({ annualWage: 0 }));

    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.getByText(/waiting on wage data/i)).toBeTruthy();
  });

  it("shows a member a read-only summary with no controls", () => {
    render(panel({ isHead: false, duesPerWorkerAnnual: ANNUAL_WAGE * 0.02 }));

    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.queryByRole("button", { name: /set dues/i })).toBeNull();
    expect(screen.getByText(/members pay/i)).toBeTruthy();
  });
});
