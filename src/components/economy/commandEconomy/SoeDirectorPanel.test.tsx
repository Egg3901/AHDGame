/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SoeDirectorPanel } from "./SoeDirectorPanel";
import type { CommandEconomyDashboard, SoeView } from "@/lib/economy/commandEconomyDashboard";

const soe: SoeView = {
  corpId: "corp-1072",
  corpName: "East German Manufacturing Enterprise",
  sector: "manufacturing",
  sectorLabel: "Manufacturing",
  output: 500,
  planTarget: 500,
  capacity: 10_000,
  planFulfillment: 1,
  efficiency: 0.27,
  cumulativeLosses: 4_000_000,
  directorId: "director-1",
  directorName: "Erich Lindner",
  vacant: false,
  viewerIsDirector: true,
  laborQuality: 0.5,
  investmentRequest: 10_000_000,
  directedCreditLastTurn: null,
};

const dashboard = {
  countryId: "DD",
  countryName: "East Germany",
  soes: [soe],
} as CommandEconomyDashboard;

describe("SoeDirectorPanel", () => {
  it("surfaces excess-capacity guidance beside an active investment request", () => {
    render(<SoeDirectorPanel dashboard={dashboard} soe={soe} onSaved={() => {}} />);

    expect(screen.getByText("Excess capacity")).toBeTruthy();
    expect(screen.getByText(/using 5% of capacity/)).toBeTruthy();
    expect(screen.getByText(/Set the investment request to 0/)).toBeTruthy();
    const link = screen.getByRole("link", { name: "Open enterprise plants" });
    expect(link.getAttribute("href")).toBe("/corporation/corp-1072");
  });
});
