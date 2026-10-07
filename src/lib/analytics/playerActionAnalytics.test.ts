import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  consent: "accepted" as "accepted" | "rejected" | null,
  captureProductEvent: vi.fn().mockResolvedValue(undefined),
  captureFirstMeaningfulAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/components/CookieConsent", () => ({
  getStoredConsent: () => state.consent,
}));
vi.mock("./capture", () => ({
  captureProductEvent: state.captureProductEvent,
  captureFirstMeaningfulAction: state.captureFirstMeaningfulAction,
}));

function makeWindow(fetch: typeof window.fetch) {
  return {
    fetch,
    location: { origin: "https://game.test" },
  };
}

describe("player action analytics", () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    state.consent = "accepted";
    vi.stubGlobal("window", makeWindow(vi.fn()));
  });

  it("does not reassign a delayed action response after switching accounts", async () => {
    let release!: (response: Response) => void;
    const delegate = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        })
    );
    vi.stubGlobal("window", makeWindow(delegate));
    const { installPlayerActionAnalytics, setPlayerActionContext } =
      await import("./playerActionAnalytics");
    const { setAnalyticsAccount } = await import("./accountContext");
    setAnalyticsAccount({ id: "first" });
    setPlayerActionContext({ userId: "first", characterId: "first-character" });
    const uninstall = installPlayerActionAnalytics();
    const pending = window.fetch("/api/parties/0123456789abcdef01234567/join", { method: "POST" });
    setAnalyticsAccount({ id: "second" });
    setPlayerActionContext({ userId: "second", characterId: "second-character" });
    release(new Response(JSON.stringify({ success: true }), { status: 200 }));
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.captureProductEvent).not.toHaveBeenCalled();
    expect(state.captureFirstMeaningfulAction).not.toHaveBeenCalled();
    uninstall();
  });

  it("captures successful election actions with allowlisted scalar props only", async () => {
    const electionId = "0123456789abcdef01234567";
    const delegate = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ electionType: "president", message: "private response" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("window", makeWindow(delegate));
    const { installPlayerActionAnalytics, setPlayerActionContext } =
      await import("./playerActionAnalytics");
    setPlayerActionContext({
      userId: "opaque-account-id",
      characterId: "opaque-character-id",
      nationId: "US",
      partyId: "3",
    });
    const uninstall = installPlayerActionAnalytics();

    await window.fetch(`/api/elections/${electionId}/primary-campaign`, {
      method: "POST",
      body: JSON.stringify({
        fundsSpent: 25,
        regionId: "CA",
        biography: "private request content",
      }),
    });

    await vi.waitFor(() =>
      expect(state.captureProductEvent).toHaveBeenCalledWith(
        "election_action_succeeded",
        expect.any(Object)
      )
    );
    expect(state.captureProductEvent).toHaveBeenCalledWith(
      "player_action_succeeded",
      expect.objectContaining({
        action_domain: "election",
        action_type: "primary_campaign",
        scope: "entity",
        entity_type: "election",
        entity_id: electionId,
        nation_id: "US",
        resource_type: "funds",
        resource_amount: 25,
      })
    );
    expect(state.captureProductEvent).toHaveBeenCalledWith(
      "election_action_succeeded",
      expect.objectContaining({
        election_id: electionId,
        election_type: "president",
        phase: "primary",
        action_type: "primary_campaign",
        party_id: "3",
        target_region_id: "CA",
        cost_type: "funds",
        cost_amount: 25,
      })
    );
    expect(state.captureFirstMeaningfulAction).toHaveBeenCalledWith("opaque-character-id", {
      action_domain: "election",
      action_type: "primary_campaign",
    });
    expect(JSON.stringify(state.captureProductEvent.mock.calls)).not.toContain(
      "private request content"
    );
    expect(JSON.stringify(state.captureProductEvent.mock.calls)).not.toContain("private response");
    uninstall();
  });

  it("uses controlled body actions and ignores returned balances as spending", async () => {
    const delegate = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true, funds: 9000 }), { status: 200 })
      );
    vi.stubGlobal("window", makeWindow(delegate));
    const { installPlayerActionAnalytics, setPlayerActionContext } =
      await import("./playerActionAnalytics");
    setPlayerActionContext({ userId: "opaque-account-id", characterId: "character-id" });
    const uninstall = installPlayerActionAnalytics();
    await window.fetch("/api/congress/bills/0123456789abcdef01234567", {
      method: "POST",
      body: JSON.stringify({ action: "vote", vote: "for" }),
    });
    await vi.waitFor(() =>
      expect(state.captureProductEvent).toHaveBeenCalledWith(
        "player_action_succeeded",
        expect.objectContaining({ action_type: "vote", resource_type: "none", resource_amount: 0 })
      )
    );
    uninstall();
  });

  it("maps rejected responses to stable failure codes without forwarding response text", async () => {
    const delegate = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "private server detail" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("window", makeWindow(delegate));
    const { installPlayerActionAnalytics, setPlayerActionContext } =
      await import("./playerActionAnalytics");
    setPlayerActionContext({ userId: "opaque-account-id", characterId: "character-id" });
    const uninstall = installPlayerActionAnalytics();

    await window.fetch("/api/congress/bills", { method: "POST", body: "{}" });

    await vi.waitFor(() =>
      expect(state.captureProductEvent).toHaveBeenCalledWith(
        "player_action_rejected",
        expect.any(Object)
      )
    );
    expect(state.captureProductEvent).toHaveBeenCalledWith(
      "player_action_rejected",
      expect.objectContaining({ failure_code: "forbidden" })
    );
    expect(JSON.stringify(state.captureProductEvent.mock.calls)).not.toContain(
      "private server detail"
    );
    uninstall();
  });

  it("reports campaign manager mutations as election actions using scalar race metadata", async () => {
    const campaignId = "0123456789abcdef01234567";
    const electionId = "abcdef0123456789abcdef01";
    const delegate = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            campaign: {
              electionId,
              party: "7",
              countryId: "US",
              electionInfo: { electionType: "president", phase: "general" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    vi.stubGlobal("window", makeWindow(delegate));
    const { installPlayerActionAnalytics, setPlayerActionContext } =
      await import("./playerActionAnalytics");
    setPlayerActionContext({ userId: "opaque-account-id", characterId: "character-id" });
    const uninstall = installPlayerActionAnalytics();

    await window.fetch(`/api/campaigns/${campaignId}/donate`, {
      method: "POST",
      body: JSON.stringify({ amount: 500, donorName: "private request content" }),
    });

    await vi.waitFor(() =>
      expect(state.captureProductEvent).toHaveBeenCalledWith(
        "election_action_succeeded",
        expect.any(Object)
      )
    );
    expect(state.captureProductEvent).toHaveBeenCalledWith(
      "election_action_succeeded",
      expect.objectContaining({
        election_id: electionId,
        election_type: "president",
        phase: "general",
        action_type: "donate",
        party_id: "7",
        target_region_id: "unknown",
        cost_type: "funds",
        cost_amount: 500,
        nation_id: "US",
      })
    );
    expect(JSON.stringify(state.captureProductEvent.mock.calls)).not.toContain(
      "private request content"
    );
    uninstall();
  });

  it("enriches a campaign acknowledgement that includes an election id but no race metadata", async () => {
    const campaignId = "0123456789abcdef01234567";
    const electionId = "abcdef0123456789abcdef01";
    const delegate = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ campaign: { electionId } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            campaign: {
              electionId,
              party: "7",
              countryId: "US",
              electionInfo: { electionType: "senate", phase: "primary" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    vi.stubGlobal("window", makeWindow(delegate));
    const { installPlayerActionAnalytics, setPlayerActionContext } =
      await import("./playerActionAnalytics");
    setPlayerActionContext({ userId: "opaque-account-id", characterId: "character-id" });
    const uninstall = installPlayerActionAnalytics();

    await window.fetch(`/api/campaigns/${campaignId}/donate`, {
      method: "POST",
      body: JSON.stringify({ amount: 100 }),
    });

    await vi.waitFor(() =>
      expect(state.captureProductEvent).toHaveBeenCalledWith(
        "election_action_succeeded",
        expect.objectContaining({
          election_id: electionId,
          election_type: "senate",
          phase: "primary",
        })
      )
    );
    uninstall();
  });

  it("keeps response truth when the caller consumes it before request inspection finishes", async () => {
    const delegate = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: "private text" }), { status: 200 })
      );
    vi.stubGlobal("window", makeWindow(delegate));
    const { installPlayerActionAnalytics, setPlayerActionContext } =
      await import("./playerActionAnalytics");
    setPlayerActionContext({ userId: "opaque-account-id", characterId: "character-id" });
    const uninstall = installPlayerActionAnalytics();
    const request = new Request("https://game.test/api/congress/bills", {
      method: "POST",
      body: "{}",
    });
    const clonedRequest = request.clone();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(clonedRequest, "json").mockImplementation(async () => {
      await gate;
      return {};
    });
    vi.spyOn(request, "clone").mockReturnValue(clonedRequest);
    const response = await window.fetch(request);
    await response.json();
    release();
    await vi.waitFor(() =>
      expect(state.captureProductEvent).toHaveBeenCalledWith(
        "player_action_rejected",
        expect.objectContaining({ failure_code: "action_rejected" })
      )
    );
    expect(state.captureProductEvent).not.toHaveBeenCalledWith(
      "player_action_succeeded",
      expect.anything()
    );
    uninstall();
  });

  it("ignores mutations sent to another origin", async () => {
    const delegate = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("window", makeWindow(delegate));
    const { installPlayerActionAnalytics, setPlayerActionContext } =
      await import("./playerActionAnalytics");
    setPlayerActionContext({ userId: "opaque-account-id", characterId: "character-id" });
    const uninstall = installPlayerActionAnalytics();
    await window.fetch("https://example.org/api/congress/bills", { method: "POST", body: "{}" });
    await Promise.resolve();
    expect(state.captureProductEvent).not.toHaveBeenCalled();
    uninstall();
  });

  it("ignores reads, admin, public, bot, and unconsented requests", async () => {
    const delegate = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("window", makeWindow(delegate));
    const { classifyPlayerActionRoute, installPlayerActionAnalytics, setPlayerActionContext } =
      await import("./playerActionAnalytics");
    expect(
      classifyPlayerActionRoute("/api/elections/0123456789abcdef01234567/results", "GET")
    ).toBeNull();
    expect(classifyPlayerActionRoute("/api/admin/users", "POST")).toBeNull();
    expect(
      classifyPlayerActionRoute("/api/country/UK/coalitions/42/admin/chair", "POST")
    ).toBeNull();
    expect(classifyPlayerActionRoute("/api/country/US/regime/public", "POST")).toBeNull();
    expect(classifyPlayerActionRoute("/api/world/bot/actions", "POST")).toBeNull();
    expect(classifyPlayerActionRoute("/api/public/v1/world", "POST")).toBeNull();
    expect(classifyPlayerActionRoute("/api/discord-bot/action", "POST")).toBeNull();
    expect(classifyPlayerActionRoute("/api/settings/theme", "PATCH")).toBeNull();
    expect(classifyPlayerActionRoute("/api/settings/resign", "POST")?.action_type).toBe("resign");
    expect(
      classifyPlayerActionRoute("/api/campaigns/0123456789abcdef01234567/donate", "POST")?.campaign
    ).toEqual({ campaign_id: "0123456789abcdef01234567" });
    expect(classifyPlayerActionRoute("/api/parties/us_democrat/election/enter", "POST")).toEqual(
      expect.objectContaining({ action_domain: "election", action_type: "enter" })
    );
    expect(
      classifyPlayerActionRoute("/api/elections/0123456789abcdef01234567/state-operations", "GET")
    ).toBeNull();
    expect(
      classifyPlayerActionRoute("/api/elections/0123456789abcdef01234567/home-state-surge", "POST")
        ?.election
    ).toEqual({
      election_id: "0123456789abcdef01234567",
      action_type: "home_state_surge",
      phase: "primary",
    });

    setPlayerActionContext({ userId: "opaque-account-id", characterId: "character-id" });
    const uninstall = installPlayerActionAnalytics();
    state.consent = "rejected";
    await window.fetch("/api/congress/bills", { method: "POST", body: "{}" });
    expect(state.captureProductEvent).not.toHaveBeenCalled();
    uninstall();
  });
  it.each([
    ["/api/country/US/parties/2/registration-drive", "party", "registration_drive"],
    [
      "/api/corporations/0123456789abcdef01234567/capital-injection",
      "corporation",
      "capital_injection",
    ],
    ["/api/corporations/0123456789abcdef01234567/shares/orders", "market", "orders"],
    ["/api/forex/orders", "market", "orders"],
    ["/api/country/US/executive/cabinet/defense/battle/auto-join", "battle", "auto_join"],
    ["/api/country/US/executive/peace/0123456789abcdef01234567", "diplomacy", "post"],
    ["/api/world/trade/embargoes", "diplomacy", "embargoes"],
    ["/api/crises/0123456789abcdef01234567/interact", "crisis", "interact"],
  ])("classifies the depth family of %s", async (path, family, action) => {
    const { classifyPlayerActionRoute } = await import("./playerActionAnalytics");
    expect(classifyPlayerActionRoute(path, "POST")).toEqual(
      expect.objectContaining({ depth_family: family, action_type: action })
    );
  });

  it.each([
    ["/api/country/US/parties/2/donate", "party"],
    ["/api/corporations/0123456789abcdef01234567/capital-injection", "corporation"],
    ["/api/forex/orders", "market"],
    ["/api/country/US/executive/cabinet/defense/battle/declare", "battle"],
    ["/api/world/trade/embargoes", "diplomacy"],
    ["/api/crises/0123456789abcdef01234567/interact", "crisis"],
  ])("captures a successful %s without request or response content", async (path, family) => {
    const delegate = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          message: "private response",
          funds: 9000,
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("window", makeWindow(delegate));
    const { installPlayerActionAnalytics, setPlayerActionContext } =
      await import("./playerActionAnalytics");
    setPlayerActionContext({
      userId: "opaque-account-id",
      characterId: "character-id",
      nationId: "US",
      partyId: "2",
    });
    const uninstall = installPlayerActionAnalytics();
    await window.fetch(path, {
      method: "POST",
      body: JSON.stringify({
        amount: 25,
        type: "buy",
        text: "private request",
        optionId: "private option text",
        theaterId: "abcdef0123456789abcdef01",
        targetCountry: "DE",
      }),
    });
    await vi.waitFor(() =>
      expect(state.captureProductEvent).toHaveBeenCalledWith(
        `${family}_action_succeeded`,
        expect.objectContaining({
          resource_type: "funds",
          resource_amount: 25,
          nation_id: "US",
          party_id: "2",
        })
      )
    );
    const serialized = JSON.stringify(state.captureProductEvent.mock.calls);
    expect(serialized).not.toContain("private request");
    expect(serialized).not.toContain("private response");
    expect(serialized).not.toContain("private option text");
    if (family === "market")
      expect(state.captureProductEvent).toHaveBeenCalledWith(
        "market_action_succeeded",
        expect.objectContaining({ order_side: "buy" })
      );
    uninstall();
  });

  it("does not report a rejection as a successful depth action or capture forecast reads", async () => {
    const delegate = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: "private text" }), { status: 200 })
      );
    vi.stubGlobal("window", makeWindow(delegate));
    const { classifyPlayerActionRoute, installPlayerActionAnalytics, setPlayerActionContext } =
      await import("./playerActionAnalytics");
    expect(
      classifyPlayerActionRoute("/api/country/US/executive/cabinet/defense/battle/forecast", "POST")
    ).toBeNull();
    setPlayerActionContext({ userId: "opaque-account-id", characterId: "character-id" });
    const uninstall = installPlayerActionAnalytics();
    await window.fetch("/api/forex/orders", { method: "POST", body: "{}" });
    await vi.waitFor(() =>
      expect(state.captureProductEvent).toHaveBeenCalledWith(
        "player_action_rejected",
        expect.objectContaining({ failure_code: "action_rejected" })
      )
    );
    expect(state.captureProductEvent.mock.calls.map(([event]) => event)).not.toContain(
      "market_action_succeeded"
    );
    uninstall();
  });
  it("tracks ordinary player actions by privileged accounts but excludes telemetry and admin endpoints", async () => {
    const delegate = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("window", makeWindow(delegate));
    const { classifyPlayerActionRoute, installPlayerActionAnalytics, setPlayerActionContext } =
      await import("./playerActionAnalytics");
    expect(classifyPlayerActionRoute("/api/analytics/first-meaningful-action", "POST")).toBeNull();
    expect(classifyPlayerActionRoute("/api/admin/users", "POST")).toBeNull();
    setPlayerActionContext({
      userId: "opaque-account-id",
      characterId: "character-id",
      isPrivileged: true,
    });
    const uninstall = installPlayerActionAnalytics();
    await window.fetch("/api/country/US/parties/2/donate", { method: "POST", body: "{}" });
    await vi.waitFor(() =>
      expect(state.captureProductEvent).toHaveBeenCalledWith(
        "party_action_succeeded",
        expect.any(Object)
      )
    );
    uninstall();
  });

  it.each(["/api/character/appearance", "/api/character/biography", "/api/onboarding/complete"])(
    "does not count %s as meaningful activation",
    async (path) => {
      const delegate = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
      vi.stubGlobal("window", makeWindow(delegate));
      const { installPlayerActionAnalytics, setPlayerActionContext } =
        await import("./playerActionAnalytics");
      setPlayerActionContext({ userId: "opaque-account-id", characterId: "character-id" });
      const uninstall = installPlayerActionAnalytics();
      await window.fetch(path, { method: "POST", body: "{}" });
      await vi.waitFor(() =>
        expect(state.captureProductEvent).toHaveBeenCalledWith(
          "player_action_succeeded",
          expect.any(Object)
        )
      );
      expect(state.captureFirstMeaningfulAction).not.toHaveBeenCalled();
      uninstall();
    }
  );
  it("uses the created order identifier instead of the parent corporation identifier", async () => {
    const corporationId = "0123456789abcdef01234567";
    const orderId = "abcdef0123456789abcdef01";
    const delegate = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ orderId }), { status: 200 }));
    vi.stubGlobal("window", makeWindow(delegate));
    const { installPlayerActionAnalytics, setPlayerActionContext } =
      await import("./playerActionAnalytics");
    setPlayerActionContext({ userId: "opaque-account-id", characterId: "character-id" });
    const uninstall = installPlayerActionAnalytics();
    await window.fetch(`/api/corporations/${corporationId}/shares/orders`, {
      method: "POST",
      body: "{}",
    });
    await vi.waitFor(() =>
      expect(state.captureProductEvent).toHaveBeenCalledWith(
        "market_action_succeeded",
        expect.objectContaining({ entity_type: "order", entity_id: orderId })
      )
    );
    uninstall();
  });
});
