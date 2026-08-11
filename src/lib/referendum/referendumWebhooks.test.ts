import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Referendum } from "@/lib/db/types/referendum";

// Keep the real DISCORD_COLORS (builders use them); stub only the senders.
vi.mock("@/lib/discordWebhooks", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/discordWebhooks")>();
  return {
    ...actual,
    sendCountryGameEvent: vi.fn().mockResolvedValue(undefined),
    sendMultiCountryGameEvent: vi.fn().mockResolvedValue(undefined),
  };
});

import {
  buildReferendumRequestedEmbed,
  buildReferendumDecisionEmbed,
  buildReferendumVoteResultEmbed,
  buildConsentBillEmbed,
  buildIndependenceConsentBillEmbed,
  buildReunificationCompleteEmbed,
  buildSecessionCompleteEmbed,
  announceReferendumRequested,
  announceReferendumDecision,
  announceReferendumVoteResult,
  announceConsentBillResolved,
  announceReunificationComplete,
  announceSecessionComplete,
} from "./referendumWebhooks";
import { sendCountryGameEvent, sendMultiCountryGameEvent } from "@/lib/discordWebhooks";

const nirRef = {
  countryId: "UK",
  regionId: "NIR",
  kind: "reunification",
  targetCountryId: "IE",
} as unknown as Referendum;

const scoRef = {
  countryId: "UK",
  regionId: "SCO",
  kind: "independence",
  targetCountryId: null,
} as unknown as Referendum;

describe("referendum webhook builders", () => {
  it("FM request names the region and step", () => {
    const e = buildReferendumRequestedEmbed({ region: "Northern Ireland", kind: "reunification" });
    expect(e.title).toContain("Northern Ireland");
    expect(e.title).toContain("Referendum Requested");
  });

  it("grant vs decline differ in wording and color", () => {
    const grant = buildReferendumDecisionEmbed({
      region: "Scotland",
      kind: "independence",
      action: "grant",
    });
    const decline = buildReferendumDecisionEmbed({
      region: "Scotland",
      kind: "independence",
      action: "decline",
    });
    expect(grant.title).toContain("Granted");
    expect(decline.title).toContain("Declined");
    expect(grant.color).not.toBe(decline.color);
  });

  it("vote result reflects pass/fail and the dual-consent requirement for reunification", () => {
    const pass = buildReferendumVoteResultEmbed({
      region: "Northern Ireland",
      kind: "reunification",
      passed: true,
      finalYesShare: 57.4,
    });
    expect(pass.title).toMatch(/Rejoin Ireland/i);
    expect(pass.description).toMatch(/57% Yes/);
    expect(pass.description).toMatch(/Westminster and the Dáil/);

    const indyPass = buildReferendumVoteResultEmbed({
      region: "Scotland",
      kind: "independence",
      passed: true,
      finalYesShare: 82,
    });
    expect(indyPass.title).toMatch(/Votes for Independence/i);
    expect(indyPass.description).toMatch(/82% Yes/);
    expect(indyPass.description).toMatch(/Westminster must now consent/i);

    const fail = buildReferendumVoteResultEmbed({
      region: "Scotland",
      kind: "independence",
      passed: false,
      finalYesShare: 44,
    });
    expect(fail.title).toMatch(/Rejects Independence/i);
  });

  it("consent bill embeds distinguish Commons vs Dáil and pass vs fail", () => {
    expect(buildConsentBillEmbed({ chamber: "commons", passed: true }).title).toMatch(
      /Westminster Consents/i
    );
    expect(buildConsentBillEmbed({ chamber: "commons", passed: false }).title).toMatch(
      /Westminster Rejects/i
    );
    expect(buildConsentBillEmbed({ chamber: "dail", passed: true }).title).toMatch(
      /Dáil Consents/i
    );
    expect(buildConsentBillEmbed({ chamber: "dail", passed: false }).title).toMatch(
      /Dáil Rejects/i
    );
  });

  it("completion embed announces the rejoin", () => {
    const e = buildReunificationCompleteEmbed({ region: "Northern Ireland" });
    expect(e.title).toMatch(/Rejoins Ireland/i);
  });

  it("independence consent embed names the region's Independence Bill and pass/fail", () => {
    const pass = buildIndependenceConsentBillEmbed({ region: "Scotland", passed: true });
    expect(pass.title).toMatch(/Westminster Consents/i);
    expect(pass.title).toMatch(/Scotland \(Independence\) Bill/);
    const fail = buildIndependenceConsentBillEmbed({ region: "Wales", passed: false });
    expect(fail.title).toMatch(/Westminster Rejects/i);
    expect(fail.title).toMatch(/Wales \(Independence\) Bill/);
  });

  it("secession completion embed announces independence with a region-specific accent", () => {
    const sco = buildSecessionCompleteEmbed({ region: "Scotland", regionId: "SCO" });
    expect(sco.title).toMatch(/Scotland Becomes Independent/i);
    const wal = buildSecessionCompleteEmbed({ region: "Wales", regionId: "WAL" });
    expect(wal.color).not.toBe(sco.color);
  });
});

describe("referendum webhook targeting", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Commons consent posts to the UK webhook; Dáil consent posts to IE", async () => {
    await announceConsentBillResolved(nirRef, "commons", true);
    expect(sendCountryGameEvent).toHaveBeenCalledWith(
      "UK",
      expect.objectContaining({ title: expect.any(String) })
    );

    await announceConsentBillResolved(nirRef, "dail", false);
    expect(sendCountryGameEvent).toHaveBeenLastCalledWith(
      "IE",
      expect.objectContaining({ title: expect.stringMatching(/Dáil Rejects/i) })
    );
  });

  it("reunification completion posts to BOTH the UK and IE webhooks", async () => {
    await announceReunificationComplete(nirRef);
    expect(sendMultiCountryGameEvent).toHaveBeenCalledWith(
      ["UK", "IE"],
      expect.objectContaining({ title: expect.stringMatching(/Rejoins Ireland/i) })
    );
  });

  it("reunification request/decision/vote cross-post to BOTH UK and IE", async () => {
    await announceReferendumRequested(nirRef);
    await announceReferendumDecision(nirRef, "grant");
    await announceReferendumVoteResult(nirRef, { passed: true, finalYesShare: 55 });
    // All three reunification steps fan out to both parliaments.
    expect(sendMultiCountryGameEvent).toHaveBeenCalledTimes(3);
    for (const call of (sendMultiCountryGameEvent as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[0]).toEqual(["UK", "IE"]);
    }
    expect(sendCountryGameEvent).not.toHaveBeenCalled();
  });

  it("independence request/decision/vote stay UK-only (no IE cross-post)", async () => {
    await announceReferendumRequested(scoRef);
    await announceReferendumDecision(scoRef, "decline");
    await announceReferendumVoteResult(scoRef, { passed: false, finalYesShare: 40 });
    expect(sendMultiCountryGameEvent).not.toHaveBeenCalled();
    for (const call of (sendCountryGameEvent as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[0]).toBe("UK");
    }
  });

  it("independence Commons consent posts to the UK webhook with Independence-Bill wording", async () => {
    await announceConsentBillResolved(scoRef, "commons", true);
    expect(sendCountryGameEvent).toHaveBeenCalledWith(
      "UK",
      expect.objectContaining({ title: expect.stringMatching(/Scotland \(Independence\) Bill/) })
    );
  });

  it("secession completion cross-posts to the UK and the new nation's webhook", async () => {
    await announceSecessionComplete(scoRef);
    expect(sendMultiCountryGameEvent).toHaveBeenCalledWith(
      ["UK", "SCO"],
      expect.objectContaining({ title: expect.stringMatching(/Scotland Becomes Independent/i) })
    );
  });
});
