/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ObjectId } from "mongodb";
import { VoteRoster } from "./VoteRoster";
import type { ProposalVoteRecord } from "@/lib/db/types/internationalOrganization";
import type { CountryId } from "@/lib/constants/countries";

afterEach(cleanup);

const vote = (countryId: CountryId, v: "yes" | "no" | "abstain"): ProposalVoteRecord => ({
  countryId,
  characterId: new ObjectId(),
  characterName: `${countryId} FM`,
  vote: v,
  castAt: new Date(),
  castOnTurn: 1,
});

describe("VoteRoster", () => {
  it("shows a country that voted twice once, on its latest vote", () => {
    // Historical duplicate rows would otherwise render the same country twice
    // with contradictory votes, and collide on the React key.
    render(<VoteRoster votes={[vote("US", "yes"), vote("US", "no")]} expectedVoters={["US"]} />);

    expect(screen.getAllByText("United States")).toHaveLength(1);
    expect(screen.getByText("No")).toBeTruthy();
    expect(screen.queryByText("Yes")).toBeNull();
  });

  it("still lists an expected voter that has not voted", () => {
    render(<VoteRoster votes={[vote("US", "yes")]} expectedVoters={["US", "UK"]} />);

    expect(screen.getByText("United Kingdom")).toBeTruthy();
    expect(screen.getByText("no vote yet")).toBeTruthy();
  });
});
