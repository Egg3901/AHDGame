/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatMasthead } from "./StatMasthead";
import { getStatsIdentity } from "@/lib/constants/nationalStatsIdentity";

describe("StatMasthead", () => {
  const identity = getStatsIdentity("UK");
  const tiles = [
    { label: "GDP", value: "£2.70T", sub: "nominal" },
    { label: "Population", value: "46.0M" },
  ];

  it("renders the title, office line, and all tiles", () => {
    render(
      <StatMasthead
        identity={identity}
        scopeLabel="National rollup"
        title={identity.title}
        subtitle={identity.office}
        tiles={tiles}
      />
    );
    expect(screen.getByText("National Statistics")).toBeTruthy();
    // Exact match resolves to the subtitle (the registry line has a country prefix).
    expect(screen.getByText("Office for National Statistics")).toBeTruthy();
    expect(screen.getByText("GDP")).toBeTruthy();
    expect(screen.getByText("£2.70T")).toBeTruthy();
    expect(screen.getByText("Population")).toBeTruthy();
    expect(screen.getByText("46.0M")).toBeTruthy();
  });

  it("scopes the accent gradient var to the masthead container", () => {
    render(
      <StatMasthead
        identity={identity}
        scopeLabel="National rollup"
        title={identity.title}
        subtitle={identity.office}
        tiles={tiles}
      />
    );
    const root = screen.getByTestId("stat-masthead");
    expect(root.getAttribute("style") ?? "").toContain("--stat");
  });

  it("renders an optional region control slot", () => {
    render(
      <StatMasthead
        identity={identity}
        scopeLabel="Region view"
        title="Scotland"
        subtitle={identity.office}
        tiles={tiles}
        regionControl={<button>pick region</button>}
      />
    );
    expect(screen.getByText("pick region")).toBeTruthy();
  });
});
