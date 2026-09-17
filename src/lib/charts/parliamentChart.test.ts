import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/charts/westminsterParliament", () => ({
  westminsterParliamentSvgString: vi.fn(
    () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1,-12,38,24" />'
  ),
}));

import { westminsterParliamentSvgString } from "@/lib/charts/westminsterParliament";
import { generateChamberDiagramSVG, type PartySeatsData } from "./parliamentChart";

describe("generateChamberDiagramSVG", () => {
  it("uses the bot command's government, opposition, and crossbench assignment for the UK", () => {
    const seats: PartySeatsData[] = [
      { party: "minor", partyName: "Minor", partyColor: "#f0c000", economicPosition: 0, seats: 20 },
      {
        party: "government",
        partyName: "Government",
        partyColor: "#e4003b",
        economicPosition: -3,
        seats: 310,
      },
      { party: "third", partyName: "Third", partyColor: "#faa61a", economicPosition: 4, seats: 45 },
      {
        party: "opposition",
        partyName: "Opposition",
        partyColor: "#0087dc",
        economicPosition: 2,
        seats: 230,
      },
    ];

    const svg = generateChamberDiagramSVG(seats, 650, "UK", 950);

    expect(westminsterParliamentSvgString).toHaveBeenCalledWith(expect.any(Array), 650, "#3b3d4d", {
      governingParties: new Set(["government"]),
      officialOpposition: "opposition",
      additionalOpposition: ["third"],
    });
    expect(svg).toContain('width="950" height="600"');
  });
});
