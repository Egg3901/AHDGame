// @vitest-environment happy-dom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostHogTracker } from "./PostHogTracker";
import { refreshGameTurnStatus } from "@/hooks/useGameEvents";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  consent: "accepted",
  client: {},
  auth: { user: { id: "test-account" }, navData: {} },
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/profile" }));
vi.mock("@/contexts/AuthDataContext", () => ({ useAuthMe: () => mocks.auth }));
vi.mock("@/components/CookieConsent", () => ({
  CONSENT_EVENT: "consent",
  CONSENT_RESET_EVENT: "consent-reset",
  getStoredConsent: () => mocks.consent,
}));
vi.mock("@/lib/analytics/posthogClient", () => ({
  getPostHogClient: async () => mocks.client,
  identifyPostHogUser: vi.fn(),
  resetPostHogUser: vi.fn(),
}));
vi.mock("@/lib/analytics/capture", () => ({
  captureProductEvent: mocks.capture,
  captureFirstTurnIfReady: vi.fn(),
  capturePendingAccountCreated: vi.fn(),
  capturePendingCharacterCreated: vi.fn(),
  capturePendingWarDeclaration: vi.fn(),
  setProductEventContext: vi.fn(),
  stopAnalyticsCapture: vi.fn(),
}));
vi.mock("@/lib/analytics/playerActionAnalytics", () => ({
  installPlayerActionAnalytics: () => () => {},
  setPlayerActionContext: vi.fn(),
}));
vi.mock("@/lib/analytics/usePostHogVariant", () => ({
  usePostHogVariant: () => ({ variant: "control" }),
}));

beforeEach(() => {
  mocks.consent = "accepted";
  mocks.capture.mockClear();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("turn completion analytics through the shared clock", () => {
  it("captures the observed committed turn once and not initial or unchanged status", async () => {
    let turn = 41;
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        currentTurn: turn,
        isActive: true,
        isProcessing: false,
        nextScheduledTurn: null,
      }),
    }));
    vi.stubGlobal("fetch", fetcher);
    render(<PostHogTracker />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    await act(async () => {
      await refreshGameTurnStatus();
    });
    const completions = () =>
      mocks.capture.mock.calls.filter(([event]) => event === "turn_completed");
    expect(completions()).toHaveLength(0);
    turn = 42;
    await act(async () => {
      await refreshGameTurnStatus();
    });
    expect(completions()).toEqual([
      ["turn_completed", expect.objectContaining({ turn_number: 42 })],
    ]);
    await act(async () => {
      await refreshGameTurnStatus();
    });
    expect(completions()).toHaveLength(1);
  });

  it("does not subscribe or capture without analytics consent", async () => {
    mocks.consent = "rejected";
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(<PostHogTracker />);
    await act(async () => {
      await refreshGameTurnStatus();
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });
});
