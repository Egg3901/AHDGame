/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/elections.json";
import { CreateProposalForm } from "./CreateProposalForm";
import { ProposalCard } from "./ProposalCard";
import type { ProposalView } from "@/lib/parties/dto/partyView";
import type { ReactNode } from "react";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const wrap = (children: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
const proposal: ProposalView = {
  id: "merge-1",
  type: "merge",
  status: "open",
  proposedBy: "chair",
  proposedByName: "Chair",
  createdAtTurn: 1,
  expiresAtTurn: 25,
  merge: { targetPartyId: "2", targetPartyName: "Surviving party" },
  proposingVoteSummary: { yes: 0, no: 0, notVoted: 3 },
  targetVoteSummary: { yes: 0, no: 0, notVoted: 3 },
};

function assertWarning() {
  const note = screen.getByRole("note");
  expect(note.textContent).toContain("permanently deleted");
  expect(note.textContent).toContain("keeps ALL of its existing NPPs");
  expect(note.textContent).toContain("5 NPPs per active player, up to 25");
  expect(note.textContent).toContain("2 qualifying game actions in the last 14 days");
  expect(note.textContent).toContain("2 below 30% Org");
  expect(note.textContent).toContain("ALL incoming active NPPs are deleted; existing NPPs stay");
  expect(note.textContent).toContain("Holding office does not protect");
}

describe("merger NPP deletion warning", () => {
  it("shows the warning before submitting a merger proposal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ parties: [] }) })
    );
    wrap(
      <CreateProposalForm
        country="UK"
        countryCode="uk"
        partyId="1"
        isChair
        currentTransactionApprovalMode="double"
        onCreated={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "+ New Proposal" }));
    expect(screen.queryByRole("note")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    await waitFor(() => expect(screen.queryByText("Loading parties…")).toBeNull());
    assertWarning();
    expect(screen.getByRole("button", { name: "Submit Proposal" })).toBeTruthy();
  });
  it.each(["proposing", "target"] as const)(
    "shows the same warning to the %s party before voting",
    (side) => {
      wrap(
        <ProposalCard
          proposal={proposal}
          country="UK"
          partyId={side === "target" ? "2" : "1"}
          canVote
          votingSide={side}
          onVoted={() => {}}
        />
      );
      assertWarning();
      expect(screen.getByRole("button", { name: "Yes" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "No" })).toBeTruthy();
    }
  );
  it("does not mislabel historical mergers or unrelated proposals with current rules", () => {
    const view = wrap(
      <ProposalCard
        proposal={{ ...proposal, status: "passed" }}
        country="UK"
        partyId="1"
        canVote={false}
        votingSide={null}
        onVoted={() => {}}
      />
    );
    expect(screen.queryByRole("note")).toBeNull();
    view.unmount();
    wrap(
      <ProposalCard
        proposal={{ ...proposal, type: "rename", rename: { newName: "New", newAbbreviation: "N" } }}
        country="UK"
        partyId="1"
        canVote
        votingSide="proposing"
        onVoted={() => {}}
      />
    );
    expect(screen.queryByRole("note")).toBeNull();
  });
});
