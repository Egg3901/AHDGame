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

let worldFlags: Record<string, unknown> = { loaded: true, preset: "2019-default" };
vi.mock("@/hooks/useWorldFlags", () => ({
  useWorldFlags: () => worldFlags,
}));

import { NextIntlClientProvider } from "next-intl";
import { TutorialCoach } from "./TutorialCoach";
import enCatalog from "../../../messages/en/tutorial.json";

const CHARACTER = { countryId: "US" as const, homeState: "CA" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
  );
  window.localStorage.clear();
  worldFlags = { loaded: true, preset: "2019-default" };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  push.mockClear();
});

/** Auto-start, then run past the 450ms arming delay so the card is on screen. */
function startTour() {
  render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={enCatalog}>
      <TutorialCoach character={CHARACTER} autoStart />
    </NextIntlClientProvider>
  );
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

  it("closes the widget on Close and keeps the resume point", () => {
    startTour();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
    });

    expect(screen.queryByRole("dialog", { name: "Tutorial" })).toBeNull();
    expect(window.localStorage.getItem("ahd-tutorial-done-v2")).toBe("1");
    // Closing is not finishing: the server resume point must survive, or
    // "Resume the tour" on the tutorial page would start from the top.
    const cleared = fetchMock.mock.calls.some(
      ([, init]) => typeof init?.body === "string" && init.body.includes('"progress":null')
    );
    expect(cleared).toBe(false);
  });

  it("does not save progress before the saved resume point has been read", () => {
    // The resume read never answers: a progress write now could only be the
    // step-0 write that used to overwrite the player's saved place.
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) =>
        url === "/api/tutorial/plan" && !init?.method
          ? new Promise(() => {})
          : Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
      )
    );
    startTour();
    const progressWrites = vi
      .mocked(fetch)
      .mock.calls.filter(
        ([, init]) => typeof init?.body === "string" && init.body.includes('"progress"')
      );
    expect(progressWrites).toHaveLength(0);
  });

  it("waits for the world flags before showing the card", () => {
    worldFlags = { loaded: false, preset: "2019-default" };
    startTour();
    expect(screen.queryByRole("dialog", { name: "Tutorial" })).toBeNull();
  });

  it("leads a returning player in a 1991 world with the 1991 edition", () => {
    worldFlags = {
      loaded: true,
      preset: "1991-default",
      startingPartiesMode: "none",
      foundingRound: { primaryEndTurn: 25, generalEndTurn: 49 },
    };
    render(
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={enCatalog}>
        <TutorialCoach
          character={CHARACTER}
          plan={{ experience: "returning", interests: ["office"] }}
          autoStart
        />
      </NextIntlClientProvider>
    );
    act(() => {
      vi.advanceTimersByTime(600);
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    // A returning player in 1991 leads with the 1991 edition of what changed.
    expect(screen.getByText("What is different in 1991")).toBeTruthy();
  });
});
