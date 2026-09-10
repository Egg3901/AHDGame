/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PrimaryCampaignControls } from "./PrimaryCampaignControls";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/observability/actionBreadcrumb", () => ({ trackAction: vi.fn() }));

function props(over: Partial<Parameters<typeof PrimaryCampaignControls>[0]> = {}) {
  return {
    electionId: "e1",
    currentCampaignState: "IA",
    currentTicks: 3,
    tickCap: 5,
    homeState: "IA",
    surgeUsed: false,
    playerActions: 25,
    playerFunds: 250_000,
    surgeCostFunds: 25_000,
    surgeCostActions: 3,
    surgeBoost: 15,
    states: [
      { id: "IA", name: "Iowa", actionCost: 3 },
      { id: "OH", name: "Ohio", actionCost: 7 },
    ],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: "Camped." }) })
  );
});

describe("PrimaryCampaignControls", () => {
  it("finds a state by its name, not only by its code", () => {
    // The panel filters on the state's name. It used to be handed the
    // two-letter code as the name, so searching "Ohio" matched nothing.
    render(<PrimaryCampaignControls {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: /Change state/ }));
    fireEvent.change(screen.getByPlaceholderText(/Search by name/), {
      target: { value: "Ohio" },
    });
    expect(screen.getByText("Ohio")).toBeTruthy();
    expect(screen.queryByText("Iowa")).toBeNull();
  });

  it("tells a host that keeps this data in client state to reload after camping", async () => {
    // router.refresh() only re-runs the server render. The Blend primary screen
    // fetches this panel's data itself, so without the callback it would keep
    // showing the state from before the action.
    const onChanged = vi.fn();
    render(<PrimaryCampaignControls {...props()} onChanged={onChanged} />);

    fireEvent.click(screen.getByRole("button", { name: /Change state/ }));
    fireEvent.click(screen.getByRole("button", { name: /Ohio/ }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(refresh).toHaveBeenCalled();
  });

  it("does not tell the host to reload when the action was refused", async () => {
    const onChanged = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Not enough actions." }) })
    );
    render(<PrimaryCampaignControls {...props()} onChanged={onChanged} />);

    fireEvent.click(screen.getByRole("button", { name: /Change state/ }));
    fireEvent.click(screen.getByRole("button", { name: /Ohio/ }));

    await waitFor(() => expect(screen.getByText(/Not enough actions/)).toBeTruthy());
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("quotes the surge as a vote share, which is what the action grants", () => {
    render(<PrimaryCampaignControls {...props()} />);
    expect(screen.getByText(/Add \+15% to your vote in/)).toBeTruthy();
  });

  it("offers no surge to a candidate with no home state", () => {
    render(<PrimaryCampaignControls {...props({ homeState: null })} />);
    expect(screen.queryByRole("button", { name: /Surge home state/ })).toBeNull();
  });

  it("will not offer a surge the player cannot pay for", () => {
    render(<PrimaryCampaignControls {...props({ playerFunds: 10 })} />);
    expect(
      (screen.getByRole("button", { name: /Surge home state/ }) as HTMLButtonElement).disabled
    ).toBe(true);
  });
});
