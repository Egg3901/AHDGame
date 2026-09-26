import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  consent: null as "accepted" | "rejected" | null,
  posthog: {
    init: vi.fn(),
    capture: vi.fn(),
    optIn: vi.fn(),
    optOut: vi.fn(),
    reset: vi.fn(),
    setConfig: vi.fn(),
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
    set_config: state.posthog.setConfig,
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

  it("still reaches PostHog when Amplitude has no key configured", async () => {
    // Amplitude is provisioned separately; a missing key must not suppress the
    // other destination, which is the whole point of the fan-out.
    const { captureProductEvent } = await import("./capture");
    vi.stubEnv("NEXT_PUBLIC_AMPLITUDE_API_KEY", "");
    vi.resetModules();
    const fresh = await import("./capture");
    state.consent = "accepted";
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
});
