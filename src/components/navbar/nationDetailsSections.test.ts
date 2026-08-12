import { describe, it, expect } from "vitest";
import { buildNationalDetailsSections } from "./nationDetailsSections";

describe("buildNationalDetailsSections", () => {
  it("groups the always-on links into four ordered sections", () => {
    const s = buildNationalDetailsSections("UK");
    // Section and item order is traffic-derived, not taxonomic — see the
    // share breakdown in nationDetailsSections.ts.
    expect(s.map((x) => x.title)).toEqual(["Politics", "Other", "Government", "Economy"]);
    // UK is a playable-pipeline country → the political registry entry is on,
    // and the legacy National Metrics entry is off (SP6: one metrics product).
    expect(s[0].items.map((i) => i.id)).toEqual([
      "elections",
      "parties",
      "politicians",
      "politicalMetrics",
    ]);
    expect(s[1].items.map((i) => i.id)).toEqual(["map"]);
    expect(s[2].items.map((i) => i.id)).toEqual(["legislature", "executive", "policy"]);
    expect(s[3].items.map((i) => i.id)).toEqual(["centralBank", "economy", "budget"]);
  });

  it("non-playables keep National Metrics and omit the registry entry", () => {
    const s = buildNationalDetailsSections("JP");
    const politics = s.find((x) => x.title === "Politics")!;
    expect(politics.items.map((i) => i.id)).toEqual(["elections", "parties", "politicians"]);
    const economy = s.find((x) => x.title === "Economy")!;
    expect(economy.items.map((i) => i.id)).toEqual(["centralBank", "economy", "budget", "metrics"]);
  });

  it("appends conditional Politics items in order when enabled", () => {
    const s = buildNationalDetailsSections("US", {
      activePresidentElection: { id: "e1", seatId: "US-president" },
      charters: { href: "/charters/c1", label: "Charter — X" },
      hasActiveReferendumCampaign: true,
    });
    const politics = s.find((x) => x.title === "Politics")!;
    // presidentialElection precedes politicalMetrics: it points at
    // /elections/[id], the #6 destination site-wide.
    expect(politics.items.map((i) => i.id)).toEqual([
      "elections",
      "parties",
      "politicians",
      "presidentialElection",
      "politicalMetrics",
      "charters",
      "referendums",
    ]);
    expect(politics.items.find((i) => i.id === "politicalMetrics")!.href).toBe(
      "/country/us/political-metrics"
    );
  });

  it("appends Supreme Court to the Government section for US only", () => {
    const us = buildNationalDetailsSections("US");
    const usGovernment = us.find((x) => x.title === "Government")!;
    expect(usGovernment.items.map((i) => i.id)).toEqual([
      "legislature",
      "executive",
      "policy",
      "scotus",
    ]);
    expect(usGovernment.items.find((i) => i.id === "scotus")!.href).toBe(
      "/country/us/executive/supreme-court"
    );

    const uk = buildNationalDetailsSections("UK");
    const ukGovernment = uk.find((x) => x.title === "Government")!;
    expect(ukGovernment.items.map((i) => i.id)).not.toContain("scotus");
  });

  it("uses the seatId for the presidential election href and the country code for referendums", () => {
    const s = buildNationalDetailsSections("US", {
      activePresidentElection: { id: "e1", seatId: "US-president" },
      hasActiveReferendumCampaign: true,
    });
    const politics = s.find((x) => x.title === "Politics")!;
    expect(politics.items.find((i) => i.id === "presidentialElection")!.href).toBe(
      "/elections/US-president"
    );
    expect(politics.items.find((i) => i.id === "referendums")!.href).toBe(
      "/country/us/referendums"
    );
  });

  it("replaces the nation Economy CB link with the banking hub", () => {
    const s = buildNationalDetailsSections("US");
    const economy = s.find((x) => x.title === "Economy")!;
    const banking = economy.items.find((i) => i.id === "centralBank")!;
    expect(banking.label).toBe("Banking");
    expect(banking.href).toBe("/banking");
  });
});
