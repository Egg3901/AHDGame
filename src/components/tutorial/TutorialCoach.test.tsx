/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/",
}));
vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

import { TutorialCoach } from "./TutorialCoach";

const CHARACTER = { countryId: "US" as const, homeState: "CA" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
  );
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  push.mockClear();
});

/** Auto-start, then run past the 450ms arming delay so the card is on screen. */
function startTour() {
  render(<TutorialCoach character={CHARACTER} autoStart />);
  // Two passes: the first fires the deferred auto-start, the second the 450ms
  // arming timer that the auto-start's effects schedule.
  act(() => {
    vi.advanceTimersByTime(600);
  });
  act(() => {
    vi.advanceTimersByTime(600);
  });
}

describe("TutorialCoach step transitions", () => {
  it("shows the card after the initial arming delay", () => {
    startTour();
    expect(screen.getByRole("dialog", { name: "Tutorial" })).toBeTruthy();
    expect(screen.getByText(/Step 1 of /)).toBeTruthy();
  });

  // Regression: pressing Next used to re-run the arming effect, whose cleanup
  // set `armed` false. The card render was gated on `armed`, so the whole
  // widget unmounted for 450ms on every Next press — a visible flicker
  // (reported by a player, 2026-07-28). The card must stay mounted across a
  // same-page step change, with no timer advance needed.
  it("keeps the widget mounted through a same-page Next press", () => {
    startTour();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Show me" }));
    });

    // No timers advanced: the widget is still there, already on the next step.
    expect(screen.queryByRole("dialog", { name: "Tutorial" })).not.toBeNull();
    expect(screen.getByText(/Step 2 of /)).toBeTruthy();
  });

  it("keeps the widget mounted when stepping back", () => {
    startTour();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Show me" }));
    });

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
    });

    expect(screen.queryByRole("dialog", { name: "Tutorial" })).not.toBeNull();
    expect(screen.getByText(/Step 1 of /)).toBeTruthy();
  });

  it("keeps the widget mounted when jumping chapters from the rail", () => {
    startTour();
    const rail = screen.getAllByRole("button", { name: /^Go to / });
    expect(rail.length).toBeGreaterThan(1);

    act(() => {
      fireEvent.click(rail[1]);
    });

    expect(screen.queryByRole("dialog", { name: "Tutorial" })).not.toBeNull();
  });

  it("still closes the widget on Skip", () => {
    startTour();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    });

    expect(screen.queryByRole("dialog", { name: "Tutorial" })).toBeNull();
    expect(window.localStorage.getItem("ahd-tutorial-done-v2")).toBe("1");
  });
});
