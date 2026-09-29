import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  consent: null as "accepted" | "rejected" | null,
  posthog: {
    init: vi.fn(),
    capture: vi.fn(),
    optIn: vi.fn(),
    optOut: vi.fn(),
    reset: vi.fn(),
    identify: vi.fn(),
    setConfig: vi.fn(),
    on: vi.fn(),
  },
  amplitude: { init: vi.fn(), track: vi.fn(), setOptOut: vi.fn(), reset: vi.fn() },
}));

vi.mock("@/components/CookieConsent", () => ({
  getStoredConsent: () => state.consent,
}));

vi.mock("posthog-js", () => ({
  default: {
    init: state.posthog.init,
    capture: state.posthog.capture,
    opt_in_capturing: state.posthog.optIn,
    opt_out_capturing: state.posthog.optOut,
    has_opted_out_capturing: () => false,
    reset: state.posthog.reset,
    identify: state.posthog.identify,
    set_config: state.posthog.setConfig,
    on: state.posthog.on,
  },
}));

vi.mock("@amplitude/analytics-browser", () => ({
  init: state.amplitude.init,
  track: state.amplitude.track,
  setOptOut: state.amplitude.setOptOut,
  reset: state.amplitude.reset,
}));

function stubWindow() {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
}

async function identifyPlayer() {
  const { getPostHogClient, identifyPostHogUser } = await import("./posthogClient");
  const client = await getPostHogClient();
  identifyPostHogUser(client!, "stable-account-id");
}

describe("analytics fan-out", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    stubWindow();
    state.consent = null;
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    vi.stubEnv("NEXT_PUBLIC_AMPLITUDE_API_KEY", "amp_test");
  });

  it("sends one product event to both destinations", async () => {
    const { captureProductEvent } = await import("./capture");
    state.consent = "accepted";
    await identifyPlayer();
    await captureProductEvent("character_created", { area: "profile" });

    expect(state.posthog.capture).toHaveBeenCalledWith("character_created", { area: "profile" });
    expect(state.amplitude.track).toHaveBeenCalledWith("character_created", { area: "profile" });
  });

  it("sends nothing to either destination before consent", async () => {
    const { captureProductEvent } = await import("./capture");
    await captureProductEvent("character_created");

    expect(state.posthog.capture).not.toHaveBeenCalled();
    expect(state.amplitude.track).not.toHaveBeenCalled();
  });

  it("mirrors a widget dismissal to both destinations without survey answers", async () => {
    state.consent = "accepted";
    const { getPostHogClient } = await import("./posthogClient");
    await getPostHogClient();
    await identifyPlayer();
    const listener = state.posthog.on.mock.calls[0]?.[1] as
      ((event: { event: string; properties: Record<string, unknown> }) => void) | undefined;
    expect(listener).toBeDefined();
    listener?.({
      event: "survey dismissed",
      properties: { $survey_questions: [{ response: "private" }, { response: null }] },
    });
    await vi.waitFor(() => expect(state.amplitude.track).toHaveBeenCalled());
    expect(state.posthog.capture).toHaveBeenCalledWith("survey_dismissed", { question_index: 1 });
    expect(state.amplitude.track).toHaveBeenCalledWith("survey_dismissed", { question_index: 1 });
  });

  it("still reaches PostHog when Amplitude has no key configured", async () => {
    // Amplitude is provisioned separately; a missing key must not suppress the
    // other destination, which is the whole point of the fan-out.
    const { captureProductEvent } = await import("./capture");
    vi.stubEnv("NEXT_PUBLIC_AMPLITUDE_API_KEY", "");
    vi.resetModules();
    const fresh = await import("./capture");
    state.consent = "accepted";
    await identifyPlayer();
    await fresh.captureProductEvent("message_sent");

    expect(state.posthog.capture).toHaveBeenCalledWith("message_sent");
    expect(state.amplitude.track).not.toHaveBeenCalled();
  });

  it("withdraws consent from both destinations at once", async () => {
    const { captureProductEvent, stopAnalyticsCapture } = await import("./capture");
    state.consent = "accepted";
    await captureProductEvent("party_joined");

    await stopAnalyticsCapture();
    expect(state.posthog.setConfig).toHaveBeenCalledWith({ disable_surveys: true });
    expect(state.posthog.optOut).toHaveBeenCalled();
    expect(state.amplitude.setOptOut).toHaveBeenCalledWith(true);
  });

  it("records a filed war only after its declaration bill creates a conflict", async () => {
    const { capturePendingWarDeclaration } = await import("./capture");
    state.consent = "accepted";
    await identifyPlayer();
    window.localStorage.setItem(
      "ahd:pending-war-declaration",
      JSON.stringify({
        accountId: "stable-account-id",
        billId: "bill-1",
        declarer: "US",
        defender: "CN",
      })
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ conflicts: [] }) })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ conflicts: [{ declaredByBillId: "bill-1" }] }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await capturePendingWarDeclaration("stable-account-id");
    expect(state.posthog.capture).not.toHaveBeenCalledWith("war_declared", expect.anything());
    await capturePendingWarDeclaration("stable-account-id", true);
    await capturePendingWarDeclaration("stable-account-id");
    expect(state.posthog.capture).toHaveBeenCalledWith("war_declared", {
      attacker_nation: "US",
      defender_nation: "CN",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
