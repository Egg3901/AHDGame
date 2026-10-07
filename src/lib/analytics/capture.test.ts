import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

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
  amplitude: {
    setUserId: vi.fn(),
    init: vi.fn(),
    track: vi.fn(),
    setOptOut: vi.fn(),
    reset: vi.fn(),
  },
}));

const accountProperties = {
  account_created_date: "unknown",
  account_age_days: "unknown",
  account_age_band: "unknown",
  account_role: "unknown",
};
const envelope = { ...accountProperties, iteration_id: "alpha-1", turn_number: 8, nation_id: "US" };

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
  setUserId: state.amplitude.setUserId,
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
  const { setAnalyticsAccount } = await import("./accountContext");
  setAnalyticsAccount({ id: "stable-account-id" });
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
    state.amplitude.init.mockReturnValue({ promise: Promise.resolve() });
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
      ...accountProperties,
      area: "profile",
      iteration_id: "alpha-1",
      turn_number: 8,
      nation_id: "US",
    });
    expect(state.amplitude.track).toHaveBeenCalledWith("character_created", {
      ...accountProperties,
      area: "profile",
      iteration_id: "alpha-1",
      turn_number: 8,
      nation_id: "US",
    });
  });

  it("loads the clock for initial events when only nation context has been supplied", async () => {
    vi.resetModules();
    const { captureProductEvent, setProductEventContext } = await import("./capture");
    state.consent = "accepted";
    await identifyPlayer();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ iterationId: "beta-3", currentTurn: 22 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    setProductEventContext({ nation_id: "US" });
    await captureProductEvent("game_visit");
    expect(fetchMock).toHaveBeenCalledWith("/api/game/turn/status", { cache: "no-store" });
    expect(state.posthog.capture).toHaveBeenCalledWith("game_visit", {
      ...accountProperties,
      iteration_id: "beta-3",
      turn_number: 22,
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
      ...accountProperties,
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
      ...accountProperties,
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
    await identifyPlayer();
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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          activation: {
            ...envelope,
            turns_since_character_creation: 3,
            starting_nation_id: "US",
            creation_path: "character_creator",
            character_count: 1,
          },
        }),
      })
    );
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
        creation_path: "character_creator",
        character_count: 1,
      })
    );
    expect(JSON.stringify(state.posthog.capture.mock.calls)).not.toContain("opaque-character-id");
  });

  it("captures a durable claim even if optional browser storage fails", async () => {
    const { captureFirstMeaningfulAction, rememberNewCharacter } = await import("./capture");
    state.consent = "accepted";
    await identifyPlayer();
    rememberNewCharacter("storage-failure-character", 5);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          activation: {
            ...envelope,
            turn_number: 99,
            turns_since_character_creation: 94,
            starting_nation_id: "US",
            creation_path: "character_creator",
            character_count: 1,
          },
        }),
      })
    );
    const write = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("Storage blocked");
    });
    await captureFirstMeaningfulAction("storage-failure-character", {
      action_domain: "politics",
      action_type: "join",
    });
    expect(state.posthog.capture).toHaveBeenCalledWith(
      "first_meaningful_action",
      expect.objectContaining({ turn_number: 99 })
    );
    write.mockRestore();
  });

  it("claims a newly created character from another browser without a local anchor", async () => {
    const { captureFirstMeaningfulAction } = await import("./capture");
    state.consent = "accepted";
    await identifyPlayer();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        activation: {
          ...envelope,
          turns_since_character_creation: 2,
          starting_nation_id: "US",
          creation_path: "character_creator",
          character_count: 1,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await captureFirstMeaningfulAction("other-browser-character", {
      action_domain: "politics",
      action_type: "join",
    });
    await captureFirstMeaningfulAction("other-browser-character", {
      action_domain: "politics",
      action_type: "join",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.posthog.capture).toHaveBeenCalledWith(
      "first_meaningful_action",
      expect.objectContaining({ turns_since_character_creation: 2 })
    );
  });

  it("keeps first-action anchors for multiple new characters independently", async () => {
    const { captureFirstMeaningfulAction, rememberNewCharacter } = await import("./capture");
    state.consent = "accepted";
    await identifyPlayer();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url, options) => ({
        ok: true,
        json: async () => ({
          activation: {
            ...envelope,
            turns_since_character_creation: 3,
            starting_nation_id:
              JSON.parse(options.body).characterId === "character-one" ? "US" : "UK",
            creation_path: "character_creator",
            character_count: JSON.parse(options.body).characterId === "character-one" ? 1 : 2,
          },
        }),
      }))
    );
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
  it("identifies both destinations before the first same-account event during SDK hydration", async () => {
    state.consent = "accepted";
    const { setAnalyticsAccount } = await import("./accountContext");
    const { captureProductEvent } = await import("./capture");
    setAnalyticsAccount({
      id: "hydrating-account",
      signupDate: "2026-01-01",
      isAdmin: false,
      isModerator: false,
    });
    await captureProductEvent("player_action_succeeded");
    expect(state.posthog.identify).toHaveBeenCalledWith("hydrating-account", { is_player: true });
    expect(state.amplitude.setUserId).toHaveBeenCalledWith("hydrating-account");
    expect(state.amplitude.setUserId.mock.invocationCallOrder[0]).toBeLessThan(
      state.amplitude.track.mock.invocationCallOrder[0]
    );
    expect(state.posthog.capture).toHaveBeenCalledWith(
      "player_action_succeeded",
      expect.objectContaining({ account_created_date: "2026-01-01", account_role: "player" })
    );
  });

  it("drops old captures waiting for the clock when the account changes", async () => {
    state.consent = "accepted";
    vi.resetModules();
    const { setAnalyticsAccount } = await import("./accountContext");
    const { captureProductEvent } = await import("./capture");
    let release!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      )
    );
    setAnalyticsAccount({ id: "first" });
    const pending = captureProductEvent("old_action");
    setAnalyticsAccount({ id: "second" });
    release({ ok: true, json: async () => ({ iterationId: "alpha-1", currentTurn: 8 }) });
    await pending;
    expect(state.posthog.capture).not.toHaveBeenCalled();
    expect(state.amplitude.track).not.toHaveBeenCalled();
    await captureProductEvent("new_action");
    expect(state.amplitude.setUserId).toHaveBeenCalledWith("second");
    expect(state.amplitude.track).toHaveBeenCalledTimes(1);
  });

  it("drops in-flight transport work on a switch and resets SDK histories before the new identity", async () => {
    state.consent = "accepted";
    await identifyPlayer();
    const { setAnalyticsAccount } = await import("./accountContext");
    const { captureAmplitudeEvent } = await import("./amplitudeClient");
    const { capturePostHogEvent } = await import("./posthogClient");
    const pending = [captureAmplitudeEvent("old_action"), capturePostHogEvent("old_action")];
    setAnalyticsAccount({ id: "second" });
    await Promise.all(pending);
    expect(state.amplitude.track).not.toHaveBeenCalled();
    expect(state.posthog.capture).not.toHaveBeenCalled();
    await Promise.all([captureAmplitudeEvent("new_action"), capturePostHogEvent("new_action")]);
    expect(state.amplitude.reset).toHaveBeenCalled();
    expect(state.amplitude.setUserId).toHaveBeenCalledWith("second");
    expect(state.posthog.identify).toHaveBeenLastCalledWith("second", { is_player: true });
  });

  it("does not consume a durable activation claim or pending signup without account context", async () => {
    state.consent = "accepted";
    const { captureFirstMeaningfulAction, rememberAccountCreated, capturePendingAccountCreated } =
      await import("./capture");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    rememberAccountCreated("stable-account-id");
    await captureFirstMeaningfulAction("character", {
      action_domain: "politics",
      action_type: "join",
    });
    await capturePendingAccountCreated();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.amplitude.track).not.toHaveBeenCalled();
    await identifyPlayer();
    await capturePendingAccountCreated();
    expect(state.amplitude.track).toHaveBeenCalledWith("account_created", expect.any(Object));
  });

  it.each(["another-account", "1"])(
    "discards an unowned or other-account signup marker %s",
    async (marker) => {
      state.consent = "accepted";
      await identifyPlayer();
      const { rememberAccountCreated, capturePendingAccountCreated } = await import("./capture");
      rememberAccountCreated(marker);
      await capturePendingAccountCreated();
      expect(state.amplitude.track).not.toHaveBeenCalled();
      expect(state.posthog.capture).not.toHaveBeenCalled();
    }
  );

  it("resets Amplitude on logout and captures nothing until a fresh account is known", async () => {
    state.consent = "accepted";
    await identifyPlayer();
    const { captureProductEvent } = await import("./capture");
    const { setAnalyticsAccount } = await import("./accountContext");
    const { resetAmplitudeUser } = await import("./amplitudeClient");
    await captureProductEvent("before_logout");
    state.amplitude.reset.mockClear();
    setAnalyticsAccount(null);
    await resetAmplitudeUser();
    await captureProductEvent("after_logout");
    expect(state.amplitude.reset).toHaveBeenCalledOnce();
    expect(state.amplitude.track).toHaveBeenCalledOnce();
  });
});

afterAll(() => vi.unstubAllEnvs());
