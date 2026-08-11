import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listPatreonMembers,
  mapMemberTierId,
  PATREON_SUPPORTER_PLUS_PLUS_TIER_ID,
  PATREON_SUPPORTER_PLUS_TIER_ID,
  PATREON_SUPPORTER_TIER_ID,
  PATREON_FREE_TIER_ID,
} from "./members";

describe("mapMemberTierId", () => {
  it("maps the supporter-plus-plus tier id", () => {
    expect(mapMemberTierId(PATREON_SUPPORTER_PLUS_PLUS_TIER_ID)).toBe("supporter-plus-plus");
  });
  it("maps the supporter-plus tier id", () => {
    expect(mapMemberTierId(PATREON_SUPPORTER_PLUS_TIER_ID)).toBe("supporter-plus");
  });
  it("maps the supporter tier id", () => {
    expect(mapMemberTierId(PATREON_SUPPORTER_TIER_ID)).toBe("supporter");
  });
  it("maps the free tier id to null", () => {
    expect(mapMemberTierId(PATREON_FREE_TIER_ID)).toBeNull();
  });
  it("maps unknown / missing to null", () => {
    expect(mapMemberTierId(null)).toBeNull();
    expect(mapMemberTierId("999")).toBeNull();
  });
});

// ── listPatreonMembers with a mocked fetch ──

function memberPage(members: unknown[], included: unknown[], next?: string) {
  return {
    data: members,
    included,
    links: next ? { next } : {},
  };
}

const TIERS = [
  {
    type: "tier",
    id: PATREON_SUPPORTER_PLUS_TIER_ID,
    attributes: { title: "Supporter+", amount_cents: 999 },
  },
  {
    type: "tier",
    id: PATREON_SUPPORTER_TIER_ID,
    attributes: { title: "Supporter", amount_cents: 499 },
  },
  { type: "tier", id: PATREON_FREE_TIER_ID, attributes: { title: "Free", amount_cents: 0 } },
];

function member(id: string, email: string, status: string, tierIds: string[]) {
  return {
    type: "member",
    id: `m-${id}`,
    attributes: { patron_status: status, currently_entitled_amount_cents: 499, email },
    relationships: {
      user: { data: { type: "user", id } },
      currently_entitled_tiers: { data: tierIds.map((t) => ({ type: "tier", id: t })) },
    },
  };
}

describe("listPatreonMembers", () => {
  beforeEach(() => {
    process.env.PATREON_CREATOR_TOKEN = "test-token";
    process.env.PATREON_CAMPAIGN_ID = "camp-1";
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.PATREON_CREATOR_TOKEN;
    delete process.env.PATREON_CAMPAIGN_ID;
  });

  it("throws when the creator token is unset", async () => {
    delete process.env.PATREON_CREATOR_TOKEN;
    await expect(listPatreonMembers()).rejects.toThrow(/PATREON_CREATOR_TOKEN/);
  });

  it("normalizes tiers, active flag, and lowercases email", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        memberPage(
          [
            member("u1", "Plus@Example.com", "active_patron", [
              PATREON_SUPPORTER_PLUS_TIER_ID,
              PATREON_FREE_TIER_ID,
            ]),
            member("u2", "sup@example.com", "active_patron", [PATREON_SUPPORTER_TIER_ID]),
            member("u3", "free@example.com", "active_patron", [PATREON_FREE_TIER_ID]),
            member("u4", "former@example.com", "former_patron", [PATREON_SUPPORTER_TIER_ID]),
          ],
          TIERS
        ),
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await listPatreonMembers();
    expect(out).toEqual([
      { patreonUserId: "u1", email: "plus@example.com", tier: "supporter-plus", active: true },
      { patreonUserId: "u2", email: "sup@example.com", tier: "supporter", active: true },
      { patreonUserId: "u3", email: "free@example.com", tier: null, active: false },
      { patreonUserId: "u4", email: "former@example.com", tier: "supporter", active: false },
    ]);
  });

  it("follows pagination via links.next", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          memberPage(
            [member("u1", "a@example.com", "active_patron", [PATREON_SUPPORTER_TIER_ID])],
            TIERS,
            "https://www.patreon.com/api/oauth2/v2/campaigns/camp-1/members?page=2"
          ),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          memberPage(
            [member("u2", "b@example.com", "active_patron", [PATREON_SUPPORTER_PLUS_TIER_ID])],
            TIERS
          ),
      });
    vi.stubGlobal("fetch", fetchMock);

    const out = await listPatreonMembers();
    expect(out.map((m) => m.patreonUserId)).toEqual(["u1", "u2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
