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
  it("drops a vote from a country that is not on the ballot", () => {
    // Ticket #1257. An autonomous government casts ballots on instruments it
    // holds no vote in, and old rows survive a member losing its vote. Every
    // tally beside this roster ignores them, so the roster must too — showing
    // them is what put three "yes" rows above a "1 / 2 yes" tally.
    render(
      <VoteRoster
        votes={[vote("US" as CountryId, "yes"), vote("PL" as CountryId, "yes")]}
        expectedVoters={["US"]}
      />
    );

    expect(screen.getAllByText("United States")).toHaveLength(1);
    expect(screen.queryByText("Poland")).toBeNull();
  });

  it("still shows every vote when no ballot is supplied", () => {
    // No `expectedVoters` means the caller is not telling us who may vote, so
    // filtering to an empty ballot would blank the roster entirely.
    render(<VoteRoster votes={[vote("US" as CountryId, "yes"), vote("PL" as CountryId, "yes")]} />);

    expect(screen.getAllByText("United States")).toHaveLength(1);
    expect(screen.getAllByText("Poland")).toHaveLength(1);
  });

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
