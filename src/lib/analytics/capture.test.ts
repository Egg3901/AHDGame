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

const envelope = { iteration_id: "alpha-1", turn_number: 8, nation_id: "US" };

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
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    stubWindow();
    state.consent = null;
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    vi.stubEnv("NEXT_PUBLIC_AMPLITUDE_API_KEY", "amp_test");
    const { setProductEventContext } = await import("./capture");
    setProductEventContext({ iteration_id: "alpha-1", turn_number: 8, nation_id: "US" });
  });

  it("sends one product event to both destinations", async () => {
    const { captureProductEvent } = await import("./capture");
    state.consent = "accepted";
    await identifyPlayer();
    await captureProductEvent("character_created", { area: "profile" });

    expect(state.posthog.capture).toHaveBeenCalledWith("character_created", {
      area: "profile",
      iteration_id: "alpha-1",
      turn_number: 8,
      nation_id: "US",
    });
    expect(state.amplitude.track).toHaveBeenCalledWith("character_created", {
      area: "profile",
      iteration_id: "alpha-1",
      turn_number: 8,
      nation_id: "US",
    });
  });

  it("sends nothing to either destination before consent", async () => {
    const { captureProductEvent } = await import("./capture");
    await captureProductEvent("character_created");

    expect(state.posthog.capture).not.toHaveBeenCalled();
    expect(state.amplitude.track).not.toHaveBeenCalled();
  });

  it("adds nation_id only when the event has a known nation context", async () => {
    const { captureProductEvent, setProductEventContext } = await import("./capture");
    state.consent = "accepted";
    await identifyPlayer();
    setProductEventContext({ iteration_id: "alpha-1", turn_number: 8, nation_id: null });

    await captureProductEvent("game_visit");

    expect(state.posthog.capture).toHaveBeenCalledWith("game_visit", {
      iteration_id: "alpha-1",
      turn_number: 8,
    });
  });

  it("keeps the shared envelope authoritative and accepts only scalar nation codes", async () => {
    const { captureProductEvent } = await import("./capture");
    state.consent = "accepted";
    await identifyPlayer();

    await captureProductEvent("game_visit", {
      iteration_id: "untrusted-iteration",
      turn_number: 999,
      nation_id: "not a nation name",
    });

    expect(state.posthog.capture).toHaveBeenCalledWith("game_visit", {
      iteration_id: "alpha-1",
      turn_number: 8,
      nation_id: "US",
    });
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
    expect(state.posthog.capture).toHaveBeenCalledWith(
      "survey_dismissed",
      expect.objectContaining({ ...envelope, question_index: 1 })
    );
    expect(state.amplitude.track).toHaveBeenCalledWith(
      "survey_dismissed",
      expect.objectContaining({ ...envelope, question_index: 1 })
    );
  });

  it("still reaches PostHog when Amplitude has no key configured", async () => {
    // Amplitude is provisioned separately; a missing key must not suppress the
    // other destination, which is the whole point of the fan-out.
    vi.stubEnv("NEXT_PUBLIC_AMPLITUDE_API_KEY", "");
    vi.resetModules();
    const fresh = await import("./capture");
    fresh.setProductEventContext({ iteration_id: "alpha-1", turn_number: 8, nation_id: "US" });
    state.consent = "accepted";
    await identifyPlayer();
    await fresh.captureProductEvent("message_sent");

    expect(state.posthog.capture).toHaveBeenCalledWith(
      "message_sent",
      expect.objectContaining(envelope)
    );
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
      ...envelope,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("captures the first successful action once with safe character creation context", async () => {
    const { captureFirstMeaningfulAction, rememberNewCharacter } = await import("./capture");
    state.consent = "accepted";
    await identifyPlayer();
    rememberNewCharacter("opaque-character-id", 5, {
      startingNationId: "US",
      creationPath: "character_creation_flow",
      characterCount: 1,
    });

    await captureFirstMeaningfulAction("opaque-character-id", {
      action_domain: "legislation",
      action_type: "propose",
    });
    await captureFirstMeaningfulAction("opaque-character-id", {
      action_domain: "legislation",
      action_type: "propose",
    });

    expect(state.posthog.capture).toHaveBeenCalledTimes(1);
    expect(state.posthog.capture).toHaveBeenCalledWith(
      "first_meaningful_action",
      expect.objectContaining({
        ...envelope,
        action_domain: "legislation",
        action_type: "propose",
        turns_since_character_creation: 3,
        starting_nation_id: "US",
        creation_path: "character_creation_flow",
        character_count: 1,
      })
    );
    expect(JSON.stringify(state.posthog.capture.mock.calls)).not.toContain("opaque-character-id");
  });

  it("keeps first-action anchors for multiple new characters independently", async () => {
    const { captureFirstMeaningfulAction, rememberNewCharacter } = await import("./capture");
    state.consent = "accepted";
    await identifyPlayer();
    rememberNewCharacter("character-one", 5, { startingNationId: "US", characterCount: 1 });
    rememberNewCharacter("character-two", 6, { startingNationId: "UK", characterCount: 2 });

    await captureFirstMeaningfulAction("character-one", {
      action_domain: "politics",
      action_type: "join",
    });
    await captureFirstMeaningfulAction("character-two", {
      action_domain: "legislation",
      action_type: "propose",
    });
    await captureFirstMeaningfulAction("character-one", {
      action_domain: "politics",
      action_type: "join",
    });

    expect(state.posthog.capture).toHaveBeenCalledTimes(2);
    expect(state.posthog.capture).toHaveBeenNthCalledWith(
      1,
      "first_meaningful_action",
      expect.objectContaining({ starting_nation_id: "US", character_count: 1 })
    );
    expect(state.posthog.capture).toHaveBeenNthCalledWith(
      2,
      "first_meaningful_action",
      expect.objectContaining({ starting_nation_id: "UK", character_count: 2 })
    );
  });
});
