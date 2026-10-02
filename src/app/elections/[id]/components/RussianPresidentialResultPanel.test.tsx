/** @vitest-environment happy-dom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/elections.json";
import { RussianPresidentialResultPanel } from "./RussianPresidentialResultPanel";
import type { GeneralVotes } from "./ElectionDetailTypes";
const candidates = [
  { id: "a", characterName: "Leader", partyName: "First", runningMateName: "Vice nominee" },
  { id: "b", characterName: "Other", partyName: "Second" },
];
function panel(outcome: "won" | "runoff" | "repeat", actions = {}) {
  const tally: GeneralVotes = {
    totalVotes: { a: 35, b: 25 },
    candidateNames: { a: "Leader", b: "Other" },
    candidateParties: { a: "1", b: "2" },
    candidateColors: {},
    finalized: true,
    seatsEstimate: null,
    turnSnapshots: [],
    russianPresidentialResult: {
      outcome,
      round: 1,
      registeredVoters: 100,
      participants: 60,
      ...(outcome === "won" ? { winnerCandidateId: "a" } : {}),
    },
  };
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <RussianPresidentialResultPanel candidates={candidates} tally={tally} {...actions} />
    </NextIntlClientProvider>
  );
}
describe("Russian direct ballot display", () => {
  it("keeps endorsement available on the direct ballot", () => {
    const onEndorse = vi.fn();
    panel("runoff", { canEndorse: true, onEndorse });
    screen.getAllByRole("button", { name: "Endorse" })[0].click();
    expect(onEndorse).toHaveBeenCalledWith("a");
  });
  it("reports a certified winner and participation without an electoral college", () => {
    panel("won");
    expect(screen.getByText("Leader wins the certified ballot.")).toBeTruthy();
    expect(screen.getByText("Vice-presidential nominee: Vice nominee")).toBeTruthy();
    expect(screen.getByText("60 participants out of 100 registered voters.")).toBeTruthy();
    expect(screen.queryByText(/electoral college/i)).toBeNull();
  });
  it("does not call the leading candidate the winner when a fresh runoff is required", () => {
    panel("runoff");
    expect(screen.getByText(/fresh ballot decides/)).toBeTruthy();
    expect(screen.queryByText(/wins the certified/)).toBeNull();
  });
});
