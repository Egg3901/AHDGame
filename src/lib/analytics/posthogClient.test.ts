import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  consent: null as "accepted" | "rejected" | null,
  optedOut: true,
  init: vi.fn(),
  capture: vi.fn(),
  optIn: vi.fn(),
  optOut: vi.fn(),
  reset: vi.fn(),
  identify: vi.fn(),
  setConfig: vi.fn(),
}));

vi.mock("@/components/CookieConsent", () => ({
  getStoredConsent: () => state.consent,
}));
vi.mock("posthog-js", () => ({
  default: {
    init: state.init,
    capture: state.capture,
    opt_in_capturing: state.optIn.mockImplementation(() => {
      state.optedOut = false;
    }),
    opt_out_capturing: state.optOut.mockImplementation(() => {
      state.optedOut = true;
    }),
    has_opted_out_capturing: () => state.optedOut,
    reset: state.reset,
    identify: state.identify,
    set_config: state.setConfig,
    on: vi.fn(),
  },
}));

describe("PostHog consent boundary", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    state.consent = null;
    state.optedOut = true;
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    const { setProductEventContext } = await import("./capture");
    setProductEventContext({ iteration_id: "alpha-1", turn_number: 8, nation_id: "US" });
  });

  it("does not initialize or capture before consent", async () => {
    const { captureProductEvent } = await import("./capture");
    await captureProductEvent("account_created");
    expect(state.init).not.toHaveBeenCalled();
    expect(state.capture).not.toHaveBeenCalled();
  });

  it("keeps surveys disabled before an authenticated user is identified", async () => {
    const { getPostHogClient } = await import("./posthogClient");
    state.consent = "accepted";
    await getPostHogClient();
    expect(state.init).toHaveBeenCalledWith(
      "phc_test",
      expect.objectContaining({
        api_host: "https://us.i.posthog.com",
        disable_surveys: true,
      })
    );
    expect(state.setConfig).not.toHaveBeenCalledWith({ disable_surveys: false });
  });

  it("enables surveys only after identifying the stable user ID", async () => {
    const { getPostHogClient, identifyPostHogUser } = await import("./posthogClient");
    state.consent = "accepted";
    const client = await getPostHogClient();
    expect(client).not.toBeNull();
    identifyPostHogUser(client!, "stable-user-id");
    expect(state.identify).toHaveBeenCalledWith("stable-user-id", { is_player: true });
    expect(state.setConfig).toHaveBeenCalledWith({ disable_surveys: false });
    expect(state.identify.mock.invocationCallOrder[0]).toBeLessThan(
      state.setConfig.mock.invocationCallOrder[0]
    );
  });

  it("queues an early product event until the stable account ID is known", async () => {
    const { captureProductEvent } = await import("./capture");
    const { getPostHogClient, identifyPostHogUser } = await import("./posthogClient");
    state.consent = "accepted";
    await captureProductEvent("bill_drafted");
    expect(state.capture).not.toHaveBeenCalled();
    identifyPostHogUser((await getPostHogClient())!, "stable-user-id", {
      signup_date: "2026-09-29",
      nation: "US",
      party: "1",
    });
    expect(state.identify).toHaveBeenCalledWith("stable-user-id", {
      is_player: true,
      signup_date: "2026-09-29",
      nation: "US",
      party: "1",
    });
    expect(state.capture).toHaveBeenCalledWith(
      "bill_drafted",
      expect.objectContaining({ iteration_id: "alpha-1", turn_number: 8, nation_id: "US" })
    );
  });

  it("enables sampled, masked session recording with sensitive screens blocked", async () => {
    const { getPostHogClient } = await import("./posthogClient");
    state.consent = "accepted";
    await getPostHogClient();
    expect(state.init).toHaveBeenCalledTimes(1);
    const config = state.init.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(config.disable_session_recording).toBeUndefined();
    expect(config.session_recording).toMatchObject({
      sampleRate: 0.1,
      maskAllInputs: true,
      recordHeaders: false,
      recordBody: false,
      blockSelector: "[data-replay-block]",
    });
  });

  it("stops capture after rejection and resumes only after another opt in", async () => {
    const { captureProductEvent } = await import("./capture");
    const { stopPostHogCapture, getPostHogClient, identifyPostHogUser } =
      await import("./posthogClient");
    state.consent = "accepted";
    identifyPostHogUser((await getPostHogClient())!, "stable-user-id");
    await captureProductEvent("account_created");
    expect(state.capture).toHaveBeenCalledTimes(1);

    state.consent = "rejected";
    await stopPostHogCapture();
    await captureProductEvent("character_created");
    expect(state.optOut).toHaveBeenCalledTimes(1);
    expect(state.capture).toHaveBeenCalledTimes(1);

    state.consent = "accepted";
    identifyPostHogUser((await getPostHogClient())!, "stable-user-id");
    await captureProductEvent("character_created");
    expect(state.optIn).toHaveBeenCalledTimes(2);
    expect(state.capture).toHaveBeenCalledTimes(2);
  });

  it("records the first completed turn once for the newly created character", async () => {
    const { rememberNewCharacter, captureFirstTurnIfReady } = await import("./capture");
    const { getPostHogClient, identifyPostHogUser } = await import("./posthogClient");
    state.consent = "accepted";
    identifyPostHogUser((await getPostHogClient())!, "stable-user-id");
    rememberNewCharacter("char1", 10);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ currentTurn: 11, isProcessing: true }),
        })
        .mockResolvedValue({
          ok: true,
          json: async () => ({ currentTurn: 11, isProcessing: false }),
        })
    );

    await captureFirstTurnIfReady("char1");
    expect(state.capture).not.toHaveBeenCalled();
    await Promise.all([captureFirstTurnIfReady("char1"), captureFirstTurnIfReady("char1")]);
    await captureFirstTurnIfReady("char1");
    expect(state.capture).toHaveBeenCalledTimes(2);
    expect(state.capture).toHaveBeenCalledWith(
      "character_created",
      expect.objectContaining({ iteration_id: "alpha-1", turn_number: 8, nation_id: "US" })
    );
    expect(state.capture).toHaveBeenCalledWith(
      "first_turn_completed",
      expect.objectContaining({ iteration_id: "alpha-1", turn_number: 8, nation_id: "US" })
    );
  });

  it("carries successful signup across a full navigation and captures it once", async () => {
    const { rememberAccountCreated, capturePendingAccountCreated } = await import("./capture");
    const { getPostHogClient, identifyPostHogUser } = await import("./posthogClient");
    state.consent = "accepted";
    identifyPostHogUser((await getPostHogClient())!, "stable-user-id");
    rememberAccountCreated();
    await Promise.all([capturePendingAccountCreated(), capturePendingAccountCreated()]);
    await capturePendingAccountCreated();
    expect(state.capture).toHaveBeenCalledTimes(1);
    expect(state.capture).toHaveBeenCalledWith(
      "account_created",
      expect.objectContaining({ iteration_id: "alpha-1", turn_number: 8, nation_id: "US" })
    );
  });

  it("discards pending milestones when consent is withdrawn", async () => {
    const {
      rememberAccountCreated,
      rememberNewCharacter,
      capturePendingAccountCreated,
      capturePendingCharacterCreated,
    } = await import("./capture");
    const { stopPostHogCapture } = await import("./posthogClient");
    state.consent = "accepted";
    rememberAccountCreated();
    rememberNewCharacter("char1", 10);
    state.consent = "rejected";
    await stopPostHogCapture();
    state.consent = "accepted";
    await capturePendingAccountCreated();
    await capturePendingCharacterCreated("char1");
    expect(state.capture).not.toHaveBeenCalled();
  });
});

afterAll(() => vi.unstubAllEnvs());
