/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReferendumPanel, type ReferendumPanelData } from "./ReferendumPanel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

function renderPanel(data: ReferendumPanelData, viewerCanManage = true) {
  return render(
    <ReferendumPanel
      countryId="UK"
      stateId="SCO"
      currentTurn={100}
      viewerCanManage={viewerCanManage}
      data={data}
    />
  );
}

function requestBtn(name: RegExp): HTMLButtonElement {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

describe("ReferendumPanel", () => {
  it("shows the request button enabled when eligible and no referendum exists", () => {
    renderPanel({ referendum: null, eligible: true });
    expect(requestBtn(/Request Independence Referendum/i).disabled).toBe(false);
  });

  it("disables the request button and shows the reason when ineligible", () => {
    renderPanel({
      referendum: null,
      eligible: false,
      eligibilityReason: "Independence desire must reach 60 to request a referendum.",
    });
    expect(requestBtn(/Request Independence Referendum/i).disabled).toBe(true);
    expect(screen.getByText(/must reach 60/i)).toBeTruthy();
  });

  it("disables the request button for non-managers", () => {
    renderPanel({ referendum: null, eligible: true }, false);
    expect(requestBtn(/Request Independence Referendum/i).disabled).toBe(true);
    expect(screen.getByText(/Only the office-holder/i)).toBeTruthy();
  });

  it("renders a Yes/No support bar while campaigning", () => {
    renderPanel({
      referendum: {
        id: "r1",
        status: "campaigning",
        kind: "independence",
        yesShare: 57,
        campaignCloseTurn: 158,
        cooldownReadyAtTurn: null,
      },
      eligible: false,
    });
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("57");
    expect(screen.getByText(/Yes 57%/)).toBeTruthy();
    expect(screen.getByText(/vote is held on turn 158/)).toBeTruthy();
  });

  it("shows the remaining cooldown in turns after a decline", () => {
    renderPanel({
      referendum: {
        id: "r1",
        status: "declined",
        kind: "reunification",
        yesShare: 0,
        campaignCloseTurn: null,
        cooldownReadyAtTurn: 124, // currentTurn is 100 → 24 turns left
      },
      eligible: false,
    });
    expect(screen.getByText(/Cooldown Remaining: 24 turns/i)).toBeTruthy();
    expect(screen.queryByText(/fresh request may be made/i)).toBeNull();
  });

  it("hides the cooldown line once it has elapsed", () => {
    renderPanel({
      referendum: {
        id: "r1",
        status: "declined",
        kind: "reunification",
        yesShare: 0,
        campaignCloseTurn: null,
        cooldownReadyAtTurn: 90, // already past currentTurn 100
      },
      eligible: true,
    });
    expect(screen.queryByText(/Cooldown Remaining/i)).toBeNull();
  });

  it("re-enables the request button after a terminal referendum once eligible again", () => {
    // A declined referendum with the cooldown cleared (eligible) must still
    // offer the request button — the regression: the button was hidden whenever
    // any referendum row existed.
    renderPanel({
      referendum: {
        id: "r1",
        status: "declined",
        kind: "independence",
        yesShare: 0,
        campaignCloseTurn: null,
        cooldownReadyAtTurn: null,
      },
      eligible: true,
    });
    expect(requestBtn(/Request Independence Referendum/i).disabled).toBe(false);
  });

  it("hides the request button while a referendum is active", () => {
    renderPanel({
      referendum: {
        id: "r1",
        status: "campaigning",
        kind: "independence",
        yesShare: 50,
        campaignCloseTurn: 158,
        cooldownReadyAtTurn: null,
      },
      eligible: false,
    });
    expect(screen.queryByRole("button", { name: /Request Independence Referendum/i })).toBeNull();
  });

  it("uses Reunification wording for Northern Ireland", () => {
    render(
      <ReferendumPanel
        countryId="UK"
        stateId="NIR"
        currentTurn={100}
        viewerCanManage
        data={{ referendum: null, eligible: true }}
      />
    );
    expect(requestBtn(/Request Reunification Referendum/i)).toBeTruthy();
  });
});
