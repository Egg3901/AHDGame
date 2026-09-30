import { beforeEach, describe, expect, it, vi } from "vitest";

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
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    state.consent = "accepted";
    vi.stubGlobal("window", makeWindow(vi.fn()));
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
});
