import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/news", () => ({ createSystemNewsPost: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/wireEvent", () => ({ logWireEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/discordWebhooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/discordWebhooks")>();
  return {
    ...actual,
    sendNewsEvent: vi.fn().mockResolvedValue(undefined),
    sendCountryGameEvent: vi.fn().mockResolvedValue(undefined),
  };
});

import {
  announceVietnamMove,
  announceVietnamRung,
  buildVietnamEmbed,
  vietnamMoveHeadline,
  vietnamRungCopy,
  VIETNAM_RUNG_COPY,
  VIETNAM_WIRE_SOURCE,
} from "./vietnamWire";
import { createSystemNewsPost } from "@/lib/news";
import { logWireEvent } from "@/lib/wireEvent";
import { sendCountryGameEvent, sendNewsEvent, DISCORD_COLORS } from "@/lib/discordWebhooks";
import { emptyVietnamState, VIETNAM_RUNGS, type VietnamEscalationState } from "./vietnamEscalation";

function stateAt(level: number): VietnamEscalationState {
  return { ...emptyVietnamState(), hasOpened: true, level };
}

/** Every string a player can read, across every rung and every decision. */
function allPlayerCopy(): string[] {
  const copy: string[] = [];
  for (const set of Object.values(VIETNAM_RUNG_COPY)) {
    for (const headline of [set.global, set.US, set.RU]) {
      copy.push(headline.title, headline.body);
    }
  }
  for (const countryId of ["US", "RU"]) {
    for (const move of ["support", "hold", "deescalate"] as const) {
      const headline = vietnamMoveHeadline(countryId, move)!;
      copy.push(headline.title, headline.body);
    }
  }
  return copy;
}

beforeEach(() => vi.clearAllMocks());

describe("Vietnam wire copy", () => {
  it("has a global headline and one per capital for every rung", () => {
    for (const rung of VIETNAM_RUNGS) {
      const copy = VIETNAM_RUNG_COPY[rung.key];
      expect(copy, `no copy for rung ${rung.key}`).toBeDefined();
      for (const headline of [copy.global, copy.US, copy.RU]) {
        expect(headline.title.length).toBeGreaterThan(10);
        expect(headline.body.length).toBeGreaterThan(40);
      }
      // Washington and Moscow must not be handed the same story.
      expect(copy.US.title).not.toBe(copy.RU.title);
      expect(copy.US.body).not.toBe(copy.RU.body);
    }
  });

  it("resolves copy by level and reports nothing for an empty ladder", () => {
    for (const rung of VIETNAM_RUNGS) {
      expect(vietnamRungCopy(rung.level)).toBe(VIETNAM_RUNG_COPY[rung.key]);
    }
    expect(vietnamRungCopy(0)).toBeNull();
  });

  it("uses no em or en dashes anywhere a player can read", () => {
    const offenders = allPlayerCopy().filter((line) => /[–—]/.test(line));
    expect(offenders).toEqual([]);
  });

  it("avoids the stock phrasing the house style bans", () => {
    const banned = [/\bdelve\b/i, /it's not just .*, it's /i, /let's dive in/i];
    for (const line of allPlayerCopy()) {
      for (const pattern of banned) {
        expect(pattern.test(line), `banned phrasing in: ${line}`).toBe(false);
      }
    }
  });

  it("writes a distinct headline per capital and per decision", () => {
    const usSupport = vietnamMoveHeadline("US", "support")!;
    const ruSupport = vietnamMoveHeadline("RU", "support")!;
    expect(usSupport.title).toContain("Washington");
    expect(ruSupport.title).toContain("Moscow");
    expect(usSupport.body).not.toBe(ruSupport.body);

    const usBack = vietnamMoveHeadline("US", "deescalate")!;
    expect(usBack.title).not.toBe(usSupport.title);
  });

  it("has nothing to say about a country that is not on the ladder", () => {
    expect(vietnamMoveHeadline("UK", "support")).toBeNull();
  });
});

describe("Vietnam wire embeds", () => {
  it("builds an embed carrying the rung and the desk", () => {
    const embed = buildVietnamEmbed(VIETNAM_RUNG_COPY.air_campaign.global, 4);
    expect(embed.title).toBe(VIETNAM_RUNG_COPY.air_campaign.global.title);
    expect(embed.color).toBe(DISCORD_COLORS.warEscalation);
    expect(embed.footer?.text).toBe(VIETNAM_WIRE_SOURCE);
    expect(embed.fields?.some((f) => f.value.includes("Air campaign"))).toBe(true);
  });

  it("drops the rung fields when the ladder is empty", () => {
    expect(buildVietnamEmbed({ title: "t", body: "b" }, 0).fields).toBeUndefined();
  });
});

describe("Vietnam announcements", () => {
  it("posts a rung globally and to both capitals at once", async () => {
    await announceVietnamRung(4);

    expect(vi.mocked(createSystemNewsPost)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logWireEvent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendNewsEvent)).toHaveBeenCalledTimes(1);

    const countries = vi.mocked(sendCountryGameEvent).mock.calls.map((c) => c[0]);
    expect(countries.sort()).toEqual(["RU", "US"]);
  });

  it("says nothing when there is no rung to report", async () => {
    await announceVietnamRung(0);
    expect(vi.mocked(sendNewsEvent)).not.toHaveBeenCalled();
    expect(vi.mocked(createSystemNewsPost)).not.toHaveBeenCalled();
  });

  it("reports a decision to the acting capital only when the rung held", async () => {
    await announceVietnamMove("US", stateAt(2), stateAt(2), "support");

    const countries = vi.mocked(sendCountryGameEvent).mock.calls.map((c) => c[0]);
    expect(countries).toEqual(["US"]);
    // No rung change, so no global coverage.
    expect(vi.mocked(sendNewsEvent)).not.toHaveBeenCalled();
    expect(vi.mocked(createSystemNewsPost)).not.toHaveBeenCalled();
  });

  it("adds the full rung announcement when a decision moved the ladder", async () => {
    await announceVietnamMove("RU", stateAt(2), stateAt(3), "support");

    expect(vi.mocked(sendNewsEvent)).toHaveBeenCalledTimes(1);
    const countries = vi.mocked(sendCountryGameEvent).mock.calls.map((c) => c[0]);
    // The acting capital's own decision post, then both capitals' rung posts.
    expect(countries).toEqual(["RU", "US", "RU"]);
  });

  it("survives a webhook outage without throwing", async () => {
    vi.mocked(sendNewsEvent).mockRejectedValueOnce(new Error("discord down"));
    await expect(announceVietnamRung(5)).resolves.toBeUndefined();
  });
});
