// @vitest-environment happy-dom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostHogTracker } from "./PostHogTracker";
import { captureProductEvent } from "@/lib/analytics/capture";
import { getAnalyticsAccount, setAnalyticsAccount } from "@/lib/analytics/accountContext";

const state = vi.hoisted(() => ({
  consent: "accepted",
  user: null as null | {
    id: string;
    signupDate: string;
    isAdmin: boolean;
    isModerator: boolean;
    character?: { id: string };
  },
  init: vi.fn(() => ({ promise: Promise.resolve() })),
  track: vi.fn(),
  setUserId: vi.fn(),
  reset: vi.fn(),
  setOptOut: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/profile" }));
vi.mock("@/contexts/AuthDataContext", () => ({
  useAuthMe: () => ({ user: state.user, navData: {} }),
}));
vi.mock("@/components/CookieConsent", () => ({
  CONSENT_EVENT: "consent",
  CONSENT_RESET_EVENT: "consent-reset",
  getStoredConsent: () => state.consent,
}));
vi.mock("@/hooks/useGameEvents", () => ({ useGameEvents: vi.fn() }));
vi.mock("@/lib/analytics/usePostHogVariant", () => ({
  usePostHogVariant: () => ({ variant: "control" }),
}));
vi.mock("@amplitude/analytics-browser", () => ({
  init: state.init,
  track: state.track,
  reset: state.reset,
  setUserId: state.setUserId,
  setOptOut: state.setOptOut,
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  setAnalyticsAccount(null);
  state.consent = "accepted";
  state.user = { id: "account-one", signupDate: "2026-01-01", isAdmin: false, isModerator: false };
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_AMPLITUDE_API_KEY", "test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ iterationId: "alpha-1", currentTurn: 8 })))
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("account tracker lifecycle", () => {
  it("sends account metadata to Amplitude with PostHog unconfigured, resets on switching and logout", async () => {
    const view = render(<PostHogTracker />);
    await waitFor(() =>
      expect(state.track).toHaveBeenCalledWith(
        "game_visit",
        expect.objectContaining({ account_created_date: "2026-01-01", account_role: "player" })
      )
    );
    expect(state.setUserId).toHaveBeenLastCalledWith("account-one");
    const previousResetCount = state.reset.mock.calls.length;
    state.user = { id: "account-two", signupDate: "2025-01-01", isAdmin: true, isModerator: true };
    view.rerender(<PostHogTracker />);
    await waitFor(() => expect(state.setUserId).toHaveBeenLastCalledWith("account-two"));
    expect(state.reset.mock.calls.length).toBeGreaterThan(previousResetCount);
    expect(state.track).toHaveBeenCalledWith(
      "game_visit",
      expect.objectContaining({ account_created_date: "2025-01-01", account_role: "admin" })
    );
    state.user = null;
    view.rerender(<PostHogTracker />);
    await act(async () => {
      await captureProductEvent("after_logout");
    });
    expect(getAnalyticsAccount().account).toBeNull();
    expect(state.track).not.toHaveBeenCalledWith("after_logout", expect.anything());
  });

  it("does not continue an old character milestone chain after switching accounts", async () => {
    state.user = {
      id: "account-one",
      signupDate: "2026-01-01",
      isAdmin: false,
      isModerator: false,
      character: { id: "old-character" },
    };
    window.localStorage.setItem(
      "ahd-posthog-first-turn",
      JSON.stringify({ characterId: "old-character", createdTurn: 7, creationCaptured: false })
    );
    let release!: (response: Response) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          })
      )
      .mockResolvedValue(new Response(JSON.stringify({ iterationId: "alpha-1", currentTurn: 8 })));
    vi.stubGlobal("fetch", fetcher);
    // Expire the shared clock cache without changing identity.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
    const view = render(<PostHogTracker />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    state.user = {
      id: "account-two",
      signupDate: "2025-01-01",
      isAdmin: false,
      isModerator: false,
    };
    view.rerender(<PostHogTracker />);
    await act(async () => {
      release(new Response(JSON.stringify({ iterationId: "alpha-1", currentTurn: 8 })));
    });
    await waitFor(() => expect(state.track).toHaveBeenCalledWith("game_visit", expect.anything()));
    expect(state.track).not.toHaveBeenCalledWith("first_turn_completed", expect.anything());
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("withdraws consent immediately and identifies again only after opt-in", async () => {
    render(<PostHogTracker />);
    await waitFor(() => expect(state.track).toHaveBeenCalled());
    await act(async () => {
      state.consent = "rejected";
      window.dispatchEvent(new Event("consent"));
      await captureProductEvent("after_withdrawal");
    });
    expect(getAnalyticsAccount().account).toBeNull();
    expect(state.setOptOut).toHaveBeenCalledWith(true);
    expect(state.track).not.toHaveBeenCalledWith("after_withdrawal", expect.anything());
    state.track.mockClear();
    await act(async () => {
      state.consent = "accepted";
      window.dispatchEvent(new Event("consent"));
    });
    await waitFor(() => expect(state.track).toHaveBeenCalledWith("game_visit", expect.anything()));
    expect(state.setUserId).toHaveBeenLastCalledWith("account-one");
  });
});
