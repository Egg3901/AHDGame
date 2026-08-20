/**
 * @vitest-environment happy-dom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VoteTallyTable } from "./VoteTallyTable";

const EAST_GERMAN_PARTIES = [
  {
    party: "sed",
    partyName: "Sozialistische Einheitspartei Deutschlands",
    partyColor: "#cc0000",
    for: 127,
    against: 0,
    abstain: 0,
    total: 127,
  },
  {
    party: "cdu-ost",
    partyName: "Christlich-Demokratische Union (Ost)",
    partyColor: "#1e3a8a",
    for: 52,
    against: 0,
    abstain: 0,
    total: 52,
  },
];

describe("VoteTallyTable (ticket #1151)", () => {
  it("renders every tally column even when party names are long", () => {
    render(<VoteTallyTable voteByParty={EAST_GERMAN_PARTIES} chamberLabel="Volkskammer" />);

    expect(screen.getByRole("columnheader", { name: "Party" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "For" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Against" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Abstain" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Total" })).toBeTruthy();
    expect(
      screen.getAllByText("Sozialistische Einheitspartei Deutschlands").length
    ).toBeGreaterThan(0);
  });

  it("stacks For/Against/Abstain/Total under each party on the mobile layout", () => {
    render(<VoteTallyTable voteByParty={EAST_GERMAN_PARTIES} chamberLabel="Volkskammer" />);

    const againstTerms = screen.getAllByText("Against");
    expect(againstTerms.some((el) => el.tagName === "DT")).toBe(true);
    expect(screen.getByRole("table").parentElement?.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["hidden", "overflow-x-auto", "min-w-0"])
    );
  });

  it("returns nothing when there are no party rows", () => {
    const { container } = render(<VoteTallyTable voteByParty={[]} chamberLabel="Volkskammer" />);
    expect(container.querySelector("table")).toBeNull();
  });
});
