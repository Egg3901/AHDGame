/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ParliamentaryGovernmentActions } from "./ParliamentaryGovernmentActions";
import type { NoConfidenceVotePayload } from "@/types/parliamentaryGovernment";

vi.mock("@/components/uk/GovernmentVotePanel", () => ({
  default: () => null,
}));

vi.mock("@/components/uk/AppointPMModal", () => ({
  default: () => null,
}));

const VONC: NoConfidenceVotePayload = {
  type: "noConfidence",
  _id: "vonc-1",
  proposedByName: "Proposer",
  targetPmName: "Sitting PM",
  votesFor: 0,
  votesAgainst: 0,
  voteByParty: [],
  status: "active",
  closesAt: new Date(Date.now() + 3_600_000).toISOString(),
  closesOnTurn: null,
};

function renderActions(
  overrides: Partial<Parameters<typeof ParliamentaryGovernmentActions>[0]> = {}
) {
  return render(
    <ParliamentaryGovernmentActions
      countryCode="UK"
      governmentStatus="pending"
      activeAppointmentVotes={[]}
      activeNoConfidenceVote={null}
      viewerMayAppoint={false}
      viewerIsCommonsMp={false}
      viewerMayProposeNoConfidence={false}
      noConfidenceCooldownTurns={null}
      viewerVotes={{}}
      {...overrides}
    />
  );
}

const APPOINT_BUTTON = "Appoint Prime Minister";

describe("ParliamentaryGovernmentActions appoint CTA", () => {
  it("shows the nominate CTA to an eligible chair while pending", () => {
    renderActions({ governmentStatus: "pending", viewerMayAppoint: true });
    expect(screen.getByText("Government pending formation")).toBeTruthy();
    expect(screen.getByRole("button", { name: APPOINT_BUTTON })).toBeTruthy();
  });

  it("hides the nominate CTA while pending when the viewer is not eligible", () => {
    renderActions({ governmentStatus: "pending", viewerMayAppoint: false });
    expect(screen.queryByRole("button", { name: APPOINT_BUTTON })).toBeNull();
  });

  it("shows the nominate CTA to an eligible chair during an active VONC on a formed government", () => {
    renderActions({
      governmentStatus: "formed",
      activeNoConfidenceVote: VONC,
      viewerMayAppoint: true,
    });
    expect(screen.getByText("Confidence vote in progress")).toBeTruthy();
    expect(screen.getByRole("button", { name: APPOINT_BUTTON })).toBeTruthy();
  });

  it("hides the nominate CTA during an active VONC when the viewer is not eligible", () => {
    renderActions({
      governmentStatus: "formed",
      activeNoConfidenceVote: VONC,
      viewerMayAppoint: false,
    });
    expect(screen.queryByRole("button", { name: APPOINT_BUTTON })).toBeNull();
  });

  it("hides the nominate CTA on a formed government with no active VONC", () => {
    renderActions({
      governmentStatus: "formed",
      activeNoConfidenceVote: null,
      viewerMayAppoint: true,
    });
    expect(screen.queryByRole("button", { name: APPOINT_BUTTON })).toBeNull();
  });
});
