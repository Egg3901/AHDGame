/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OfficePlaques } from "./OfficePlaques";
import { InstrumentStrip } from "./InstrumentStrip";
import { ActsLedger, type LedgerAct } from "./ActsLedger";
import { ExecutiveRoster } from "./ExecutiveRoster";
import { getExecutiveIdentity } from "@/lib/constants/institutionIdentity";
import { getExecutiveSurface } from "@/lib/constants/executiveSurface";

describe("OfficePlaques", () => {
  it("renders holders with party chips and vacancies with succession copy", () => {
    render(
      <OfficePlaques
        countryId="US"
        identity={getExecutiveIdentity("US")}
        plaques={[
          {
            title: "President",
            sealGlyph: "P",
            holder: {
              name: "Abigail Whitmore",
              partyId: "1",
              partyName: "Democratic Party",
              partyColor: "#3b82f6",
            },
            tenureLine: "since Jan 2026",
          },
          {
            title: "Chief of Staff",
            sealGlyph: "CS",
            holder: null,
            vacancyNote: "Appointed by the President — serves at their pleasure.",
          },
        ]}
      />
    );
    expect(screen.getByText("Abigail Whitmore")).toBeTruthy();
    expect(screen.getByText("since Jan 2026")).toBeTruthy();
    expect(screen.getByText("Vacant")).toBeTruthy();
    expect(screen.getByText(/serves at their pleasure/)).toBeTruthy();
  });
});

describe("InstrumentStrip", () => {
  it("renders badges, progress, sparklines, and sublines per tile", () => {
    const { container } = render(
      <InstrumentStrip
        tiles={[
          {
            label: "Term Clock",
            value: "62%",
            badge: "TERM 1 OF 2",
            progressPct: 62,
            subline: "election in 10 turns · eligible to run again",
          },
          { label: "Mandate", value: "52%", spark: [48, 50, 49, 52] },
          { label: "The Desk", value: "2 bills" },
          { label: "Cabinet", value: "13/15", subline: "2 vacancies" },
        ]}
      />
    );
    expect(screen.getByText("TERM 1 OF 2")).toBeTruthy();
    expect(screen.getByText(/eligible to run again/)).toBeTruthy();
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    expect(screen.getByText("13/15")).toBeTruthy();
  });
});

describe("ActsLedger", () => {
  const acts: LedgerAct[] = [
    {
      kind: "signed",
      title: "Rural Broadband Investment Act",
      at: "2026-03-01T00:00:00.000Z",
      refId: "b1",
    },
    {
      kind: "order",
      title: "Federal Hiring Policy",
      detail: "by A. Whitmore",
      at: "2026-02-15T00:00:00.000Z",
      turn: 1279,
      refId: "o1",
    },
  ];

  it("renders chip labels from config and turn stamps when a real turn exists", () => {
    render(
      <ActsLedger
        acts={acts}
        actLabels={getExecutiveSurface("US").actLabels}
        ordersFilterLabel="Orders"
        footer={{ href: "/congress", label: "Congress page" }}
      />
    );
    expect(screen.getByText("SIGNED")).toBeTruthy();
    expect(screen.getByText("EX. ORDER")).toBeTruthy();
    expect(screen.getByText("T 1279")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Congress page/ })).toBeTruthy();
  });

  it("filters by act group via the pills", () => {
    render(
      <ActsLedger
        acts={acts}
        actLabels={getExecutiveSurface("US").actLabels}
        ordersFilterLabel="Orders"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Orders" }));
    expect(screen.queryByText("Rural Broadband Investment Act")).toBeNull();
    expect(screen.getByText("Federal Hiring Policy")).toBeTruthy();
  });

  it("shows an empty state instead of a bare panel", () => {
    render(
      <ActsLedger
        acts={[]}
        actLabels={getExecutiveSurface("US").actLabels}
        ordersFilterLabel="Orders"
      />
    );
    expect(screen.getByText(/No recorded acts/)).toBeTruthy();
  });
});

describe("ExecutiveRoster", () => {
  it("renders holders, vacancies, pending badges, and the fill counter", () => {
    render(
      <ExecutiveRoster
        title="Cabinet"
        filled={13}
        total={15}
        rows={[
          { role: "Treasury", holder: { name: "M. Ruiz" } },
          { role: "Defense", holder: { name: "T. Okafor" }, pending: true },
          { role: "Attorney General", holder: null },
        ]}
        footer={{ href: "/country/us/executive/cabinet", label: "All 15 positions" }}
      />
    );
    expect(screen.getByText("13 / 15")).toBeTruthy();
    expect(screen.getByText("PENDING")).toBeTruthy();
    expect(screen.getByText("Vacant")).toBeTruthy();
    expect(screen.getByRole("link", { name: /All 15 positions/ })).toBeTruthy();
  });
});
