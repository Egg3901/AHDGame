/**
 * Tests for the RU Supreme Soviet legislature page (spec §4).
 *
 * Focus: the two-chamber toggle (D8) and the Leadership tab — deputies must be
 * able to act on the Premier from the legislature page, and the sitting
 * Chairman of the Presidium (or its vacancy) must be surfaced.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const useLegislatureDataMock = vi.fn();
vi.mock("./components/shared/useLegislatureData", () => ({
  useLegislatureData: (countryId: string, chamber?: string) =>
    useLegislatureDataMock(countryId, chamber),
}));

vi.mock("@/app/country/[code]/executive/components/ParliamentaryGovernmentActions", () => ({
  ParliamentaryGovernmentActions: (props: {
    executiveTitle?: string;
    memberLabel?: string;
    governmentStatus: string | null;
  }) => (
    <div
      data-testid="ru-gov-actions"
      data-executive-title={props.executiveTitle}
      data-member-label={props.memberLabel}
      data-status={String(props.governmentStatus)}
    />
  ),
}));

import { RUSupremeSovietPage } from "./RUSupremeSovietPage";

const membersPayload = {
  totalSeats: 708,
  filledSeats: 1,
  vacantSeats: 707,
  composition: [
    {
      partyId: "1",
      partyName: "Communist Party of the Soviet Union",
      partyColor: "#CC0000",
      economicPosition: -4,
      seats: 1,
    },
  ],
  members: [],
};

const executivePayload = {
  government: {
    status: "formed",
    pmName: "Test Premier",
    formationType: "majority",
    hosName: null,
  },
  activeAppointmentVotes: [],
  activeNoConfidenceVote: null,
  viewerMayAppoint: false,
  viewerIsCommonsMp: true,
  viewerMayProposeNoConfidence: false,
  noConfidenceCooldownTurns: null,
  viewerVotes: {},
  viewerWhippedFrom: {},
};

describe("RUSupremeSovietPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLegislatureDataMock.mockReturnValue({
      members: membersPayload,
      bills: { bills: [], canPropose: false, adminOverride: false, total: 0, page: 1, limit: 20 },
      leaders: { primeMinister: null, oppositionLeader: null, speaker: null },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => executivePayload,
    })) as unknown as typeof fetch;
  });

  it("defaults to the Soviet of the Union and toggles to the Nationalities chamber (D8)", () => {
    render(<RUSupremeSovietPage countryId="RU" />);
    expect(useLegislatureDataMock).toHaveBeenLastCalledWith("RU", "sovietOfTheUnion");

    fireEvent.click(screen.getByRole("button", { name: "Nationalities" }));
    expect(useLegislatureDataMock).toHaveBeenLastCalledWith("RU", "sovietOfNationalities");
  });

  it("wires Premier / Supreme Soviet Deputy labels into the actions panel", async () => {
    render(<RUSupremeSovietPage countryId="RU" />);
    fireEvent.click(screen.getByRole("button", { name: "Leadership" }));

    const actions = await screen.findByTestId("ru-gov-actions");
    expect(actions.getAttribute("data-executive-title")).toBe("Premier");
    expect(actions.getAttribute("data-member-label")).toBe("Supreme Soviet Deputy");
    await waitFor(() => {
      expect(actions.getAttribute("data-status")).toBe("formed");
    });
  });

  it("surfaces the Chairman of the Presidium vacancy on the Leadership tab", async () => {
    render(<RUSupremeSovietPage countryId="RU" />);
    fireEvent.click(screen.getByRole("button", { name: "Leadership" }));

    expect(await screen.findByText("Chairman of the Presidium")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText(/Vacant — awaiting election/)).toBeTruthy();
    });
  });

  it("shows the seated Chairman by name when the office is filled", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ...executivePayload,
        government: { ...executivePayload.government, hosName: "Seated Chairman" },
      }),
    })) as unknown as typeof fetch;

    render(<RUSupremeSovietPage countryId="RU" />);
    fireEvent.click(screen.getByRole("button", { name: "Leadership" }));

    await waitFor(() => {
      expect(screen.getByText("Seated Chairman")).toBeTruthy();
    });
  });
});
