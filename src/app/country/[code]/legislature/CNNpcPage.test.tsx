/**
 * Tests for the CN NPC legislature page.
 *
 * Focus: the Leadership tab — NPC delegates must be able to vote for / propose
 * the Premier from the legislature page (parity with the JP/IE Leadership tabs).
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Control the legislature data hook so we can assert leader-card rendering.
vi.mock("./components/shared/useLegislatureData", () => ({
  useLegislatureData: () => ({
    members: {
      totalSeats: 2980,
      filledSeats: 1,
      vacantSeats: 2979,
      composition: [
        {
          partyId: "1",
          partyName: "Chinese Communist Party",
          partyColor: "#DE2910",
          economicPosition: -3,
          seats: 1,
        },
      ],
      members: [],
    },
    bills: { bills: [], canPropose: false, adminOverride: false, total: 0, page: 1, limit: 20 },
    leaders: {
      primeMinister: {
        characterId: "premier-char",
        sequentialId: 42,
        characterName: "Li Qiang",
        party: "1",
        since: null,
        avatarUrl: null,
      },
      oppositionLeader: null,
      speaker: null,
    },
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// Stub the shared government-actions component. The component itself is covered
// by the executive-hub tests; here we only assert the CN page mounts it with the
// CN-specific labels (Premier / NPC Delegate) and the live government status.
vi.mock("@/app/country/[code]/executive/components/ParliamentaryGovernmentActions", () => ({
  ParliamentaryGovernmentActions: (props: {
    executiveTitle?: string;
    memberLabel?: string;
    governmentStatus: string | null;
  }) => (
    <div
      data-testid="cn-gov-actions"
      data-executive-title={props.executiveTitle}
      data-member-label={props.memberLabel}
      data-status={String(props.governmentStatus)}
    />
  ),
}));

import { CNNpcPage } from "./CNNpcPage";

const executivePayload = {
  government: { status: "pending", pmName: null, formationType: null },
  activeAppointmentVotes: [],
  activeNoConfidenceVote: null,
  viewerMayAppoint: true,
  viewerIsCommonsMp: true,
  viewerMayProposeNoConfidence: false,
  noConfidenceCooldownTurns: null,
  viewerVotes: {},
  viewerWhippedFrom: {},
};

describe("CNNpcPage Leadership tab", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => executivePayload,
    })) as unknown as typeof fetch;
  });

  it("renders a Leadership tab in the tab bar", () => {
    render(<CNNpcPage countryId="CN" />);
    expect(screen.getByRole("button", { name: "Leadership" })).toBeTruthy();
  });

  it("wires Premier / NPC Delegate labels and live government status into the actions panel", async () => {
    render(<CNNpcPage countryId="CN" />);
    fireEvent.click(screen.getByRole("button", { name: "Leadership" }));

    const actions = await screen.findByTestId("cn-gov-actions");
    expect(actions.getAttribute("data-executive-title")).toBe("Premier");
    expect(actions.getAttribute("data-member-label")).toBe("NPC Delegate");
    await waitFor(() => {
      expect(actions.getAttribute("data-status")).toBe("pending");
    });
  });

  it("shows the seated Premier on a leader card", () => {
    render(<CNNpcPage countryId="CN" />);
    fireEvent.click(screen.getByRole("button", { name: "Leadership" }));

    // "Premier" appears in both the header stat strip and the leadership card.
    expect(screen.getAllByText("Premier").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Li Qiang").length).toBeGreaterThan(0);
  });

  it("labels the head of government 'Premier', not 'President', in the header", () => {
    // Regression guard: `leaders.primeMinister` is the Premier (head of
    // government), so the header must not mislabel it as the ceremonial
    // President of the PRC.
    render(<CNNpcPage countryId="CN" />);
    expect(screen.getAllByText("Premier").length).toBeGreaterThan(0);
    expect(screen.queryByText("President")).toBeNull();
  });
});
