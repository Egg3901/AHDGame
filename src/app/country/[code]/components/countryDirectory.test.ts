import { describe, expect, it } from "vitest";
import type { OverviewCounts } from "@/lib/country/overviewCounts";
import {
  budgetFigure,
  buildCountryDirectory,
  countFigure,
  defconFigure,
  electionsFigure,
} from "./countryDirectory";

const EMPTY: OverviewCounts = {
  parties: null,
  politicians: null,
  activeElections: null,
  upcomingElections: null,
  bills: null,
  regions: null,
  primeRate: null,
};

function labelsIn(groups: ReturnType<typeof buildCountryDirectory>, group: string): string[] {
  return groups.find((g) => g.label === group)?.rows.map((r) => r.label) ?? [];
}

function allLabels(groups: ReturnType<typeof buildCountryDirectory>): string[] {
  return groups.flatMap((g) => g.rows.map((r) => r.label));
}

describe("countFigure", () => {
  it("pluralizes and drops empty counts", () => {
    expect(countFigure(1, "bill")).toBe("1 bill");
    expect(countFigure(4, "bill")).toBe("4 bills");
    expect(countFigure(0, "bill")).toBeNull();
    expect(countFigure(null, "bill")).toBeNull();
  });
});

describe("electionsFigure", () => {
  it("prefers live races and flags them", () => {
    expect(electionsFigure({ ...EMPTY, activeElections: 3, upcomingElections: 9 })).toEqual({
      figure: "3 live",
      tone: "warning",
    });
  });

  it("falls back to upcoming, then to nothing", () => {
    expect(electionsFigure({ ...EMPTY, upcomingElections: 2 })).toEqual({
      figure: "2 upcoming",
      tone: "default",
    });
    expect(electionsFigure(EMPTY).figure).toBeNull();
    expect(electionsFigure(null).figure).toBeNull();
  });
});

describe("budgetFigure", () => {
  it("signs a surplus and warns only on a deep deficit", () => {
    expect(budgetFigure({ ...EMPTY, budgetBalancePctGdp: 1.24 })).toEqual({
      figure: "+1.2% GDP",
      tone: "default",
    });
    expect(budgetFigure({ ...EMPTY, budgetBalancePctGdp: -1.5 })).toEqual({
      figure: "-1.5% GDP",
      tone: "default",
    });
    expect(budgetFigure({ ...EMPTY, budgetBalancePctGdp: -6 }).tone).toBe("warning");
  });

  it("shows no figure when the budget is missing", () => {
    expect(budgetFigure(EMPTY).figure).toBeNull();
    expect(budgetFigure(null).figure).toBeNull();
  });
});

describe("defconFigure", () => {
  it("warns at DEFCON 2 and below", () => {
    expect(defconFigure({ ...EMPTY, coldWarDefcon: 5 })).toEqual({
      figure: "DEFCON 5",
      tone: "default",
    });
    expect(defconFigure({ ...EMPTY, coldWarDefcon: 2 }).tone).toBe("warning");
  });

  it("is absent when the subsystem is off", () => {
    expect(defconFigure(EMPTY).figure).toBeNull();
  });
});

describe("buildCountryDirectory", () => {
  it("orders the groups politics, government, economy, nation", () => {
    const groups = buildCountryDirectory({ countryId: "US", counts: EMPTY });
    expect(groups.map((g) => g.label)).toEqual(["Politics", "Government", "Economy", "Nation"]);
  });

  it("gives every row a link and never renders an empty group", () => {
    const groups = buildCountryDirectory({ countryId: "UK", counts: EMPTY });
    for (const group of groups) {
      expect(group.rows.length).toBeGreaterThan(0);
      for (const row of group.rows) expect(row.href).toBeTruthy();
    }
  });

  it("pins an active presidential race to the top of Politics", () => {
    const groups = buildCountryDirectory({
      countryId: "US",
      counts: EMPTY,
      activePresidentElection: { id: "abc", seatId: "us-pres", status: "active" },
    });
    const politics = groups.find((g) => g.label === "Politics")!;
    expect(politics.rows[0].label).toBe("Presidential Election");
    expect(politics.rows[0].highlight).toBe(true);
    expect(politics.rows[0].href).toBe("/elections/us-pres");
  });

  it("hides referendums until the country has run one", () => {
    expect(
      labelsIn(buildCountryDirectory({ countryId: "UK", counts: EMPTY }), "Politics")
    ).not.toContain("Referendums");
    const withPast = buildCountryDirectory({
      countryId: "UK",
      counts: { ...EMPTY, totalReferendums: 3 },
    });
    expect(labelsIn(withPast, "Politics")).toContain("Referendums");
  });

  it("keeps the Supreme Court to the US", () => {
    expect(
      labelsIn(buildCountryDirectory({ countryId: "US", counts: EMPTY }), "Government")
    ).toContain("Supreme Court");
    expect(
      labelsIn(buildCountryDirectory({ countryId: "UK", counts: EMPTY }), "Government")
    ).not.toContain("Supreme Court");
  });

  it("shows the Command Economy dashboard only for a flag-on planned economy", () => {
    expect(allLabels(buildCountryDirectory({ countryId: "RU", counts: EMPTY }))).not.toContain(
      "Command Economy"
    );
    const planned = buildCountryDirectory({
      countryId: "RU",
      counts: { ...EMPTY, commandEconomy: true },
    });
    expect(labelsIn(planned, "Economy")).toContain("Command Economy");
  });

  it("shows the Cold War entry only when a DEFCON is served", () => {
    expect(allLabels(buildCountryDirectory({ countryId: "US", counts: EMPTY }))).not.toContain(
      "Cold War"
    );
    const atWar = buildCountryDirectory({
      countryId: "US",
      counts: { ...EMPTY, coldWarDefcon: 3 },
    });
    const nation = groupRows(atWar, "Nation").find((r) => r.label === "Cold War");
    expect(nation?.href).toBe("/world/conflicts");
    expect(nation?.figure).toBe("DEFCON 3");
  });

  it("covers every country sub-surface a player can reach", () => {
    const labels = allLabels(buildCountryDirectory({ countryId: "US", counts: EMPTY }));
    for (const expected of [
      "Elections",
      "Parties",
      "Politicians",
      "Approval",
      "National Budget",
      "National Policy",
      "Economy",
      "Stock Market",
      "Foreign Exchange",
      "Unions",
      "Nationalization",
      "Map",
      "Wiki",
    ]) {
      expect(labels).toContain(expected);
    }
  });

  it("offers exactly one metrics surface per country", () => {
    const us = allLabels(buildCountryDirectory({ countryId: "US", counts: EMPTY }));
    expect(us).toContain("Political Metrics");
    expect(us).not.toContain("National Metrics");
  });

  it("never repeats a label or a destination", () => {
    for (const countryId of ["US", "UK", "RU"] as const) {
      const rows = buildCountryDirectory({
        countryId,
        counts: { ...EMPTY, totalReferendums: 1, commandEconomy: true, coldWarDefcon: 4 },
      }).flatMap((g) => g.rows);
      expect(new Set(rows.map((r) => r.label)).size).toBe(rows.length);
      expect(new Set(rows.map((r) => r.href)).size).toBe(rows.length);
    }
  });

  it("carries live figures through to the rows", () => {
    const groups = buildCountryDirectory({
      countryId: "US",
      counts: { ...EMPTY, bills: 1, parties: 6, primeRate: 4.25, unions: 12, regions: 50 },
      lawCount: 2,
      approval: 47.4,
    });
    const byLabel = new Map(
      groups.flatMap((g) => g.rows).map((r) => [r.label, r.figure ?? null] as const)
    );
    expect(byLabel.get("National Policy")).toBe("2 laws");
    expect(byLabel.get("Parties")).toBe("6 active");
    expect(byLabel.get("Approval")).toBe("47%");
    expect(byLabel.get("Unions")).toBe("12 unions");
  });
});

function groupRows(groups: ReturnType<typeof buildCountryDirectory>, group: string) {
  return groups.find((g) => g.label === group)?.rows ?? [];
}
