import { describe, expect, it } from "vitest";
import { generateBackground, generateOverview, typeLabel } from "./wikiElectionHelpers";
import type { ElectionDetail } from "./wikiElectionTypes";

describe("wiki election labels", () => {
  it("humanizes a valid chamber key that is not in the gameplay label registry", () => {
    expect(typeLabel("nationalrat")).toBe("Nationalrat");
  });
});

function snapCommons(overrides: Partial<ElectionDetail> = {}): ElectionDetail {
  return {
    id: "e1",
    electionType: "snap_commons",
    state: "LON",
    stateName: "London",
    senateClass: null,
    cycle: 6,
    totalSeats: 91,
    endTime: "2026-09-29T15:02:22.000Z",
    year: 1977,
    label: "1977 London Snap Commons",
    primaryResults: [],
    generalResults: {
      totalVotes: { a: 600, b: 400 },
      candidateNames: { a: "Candidate A", b: "Candidate B" },
      candidateParties: { a: "Labour Party", b: "Liberal Democrats" },
      finalized: true,
    },
    ...overrides,
  } as ElectionDetail;
}

describe("wiki election narrative", () => {
  it("dates the overview by game year, not the internal cycle or wall clock", () => {
    const text = generateOverview(snapCommons(), 1000);
    expect(text).toContain("held in 1977");
    expect(text).not.toMatch(/Cycle|2026/);
    expect(text).toContain("Candidate A of the Labour Party won with 60.0%");
  });

  it("describes a Commons race as the region's share of the national chamber", () => {
    const text = generateBackground(snapCommons());
    expect(text).toContain("snap election");
    expect(text).toContain("London returned 91 seats to the House of Commons");
    expect(text).not.toContain("State Senate");
  });

  it("keeps regional bodies described as regional", () => {
    const text = generateBackground(
      snapCommons({ electionType: "regionalCouncil", totalSeats: 32 })
    );
    expect(text).toContain("London's Regional Council");
    expect(text).not.toContain("snap");
  });
});
