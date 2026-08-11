/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateMacroHeader } from "./StateMacroHeader";

describe("StateMacroHeader", () => {
  it("renders the region label, GSP, growth and vs-national chips, and top sector", () => {
    render(
      <StateMacroHeader
        countryId="US"
        stateName="Texas"
        gdpDisplay="$1.82T"
        stateGdpGrowth={1.9}
        nationalGdpGrowth={2.1}
        topSectorLabel="Energy"
      />
    );
    expect(screen.getByText(/State Economy · Texas/)).toBeTruthy();
    expect(screen.getByText("$1.82T")).toBeTruthy();
    expect(screen.getByText(/\+1\.9%/)).toBeTruthy();
    // 1.9 − 2.1 = −0.2pp underperforming → down glyph
    expect(screen.getByText(/-0\.2pp/)).toBeTruthy();
    expect(screen.getByText(/▼/)).toBeTruthy();
    expect(screen.getByText("Energy")).toBeTruthy();
  });

  it("links to the national Economic Outlook", () => {
    render(
      <StateMacroHeader
        countryId="CN"
        stateName="Guangdong"
        gdpDisplay="¥13.6T"
        stateGdpGrowth={3.4}
        nationalGdpGrowth={2.8}
        topSectorLabel="Technology"
      />
    );
    const link = screen.getByRole("link", { name: /National Economic Outlook/ });
    expect(link.getAttribute("href")).toBe("/country/cn/economy");
    // CN regions are provinces, not states
    expect(screen.getByText(/Province Economy · Guangdong/)).toBeTruthy();
    // outperforming → up glyph on the vs-national chip
    expect(screen.getByText(/\+0\.6pp/)).toBeTruthy();
  });

  it("omits growth chips when macro data is unavailable", () => {
    render(
      <StateMacroHeader
        countryId="US"
        stateName="Texas"
        gdpDisplay="$1.82T"
        stateGdpGrowth={null}
        nationalGdpGrowth={null}
        topSectorLabel={null}
      />
    );
    expect(screen.getByText("$1.82T")).toBeTruthy();
    expect(screen.queryByText(/pp/)).toBeNull();
    expect(screen.queryByText(/growth \/yr/)).toBeNull();
  });
});
