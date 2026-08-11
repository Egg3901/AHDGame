/**
 * @vitest-environment happy-dom
 */
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ElectionDropdown, type CandidacyLike } from "./LeadershipShared";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/Avatar", () => ({
  Avatar: ({ name }: { name: string }) => <div>{name}</div>,
}));

vi.mock("@/app/congress/bills/[id]/components/VoteTallyTable", () => ({
  VoteTallyTable: () => <div>Vote tally</div>,
}));

describe("ElectionDropdown", () => {
  const baseCandidacy: CandidacyLike = {
    id: "nom-1",
    nomineeId: "char-1",
    nomineeSequentialId: 1,
    nomineeName: "Rashi Sanok",
    nomineeParty: "democrats",
    nomineePartyName: "Democrats",
    nomineePartyColor: "#123456",
    nomineeState: "CA",
    votesFor: 0,
    isMyVote: false,
    isMyCandidate: true,
  };

  it("lets candidates cast a vote for themselves", () => {
    const onVote = vi.fn();

    render(
      <ElectionDropdown
        roleLabel="Speaker"
        candidacies={[baseCandidacy]}
        partySeats={210}
        canVote
        myVoteId={null}
        onVote={onVote}
        onWithdraw={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Vote" }));

    expect(onVote).toHaveBeenCalledWith("nom-1");
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeDefined();
  });

  it("shows the voted state on your own candidacy after voting", () => {
    render(
      <ElectionDropdown
        roleLabel="Speaker"
        candidacies={[baseCandidacy]}
        partySeats={210}
        canVote
        myVoteId="nom-1"
        onVote={vi.fn()}
        onWithdraw={vi.fn()}
      />
    );

    const votedButton = screen.getByRole("button", { name: /voted/i });
    expect(votedButton.getAttribute("disabled")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeDefined();
  });
});
