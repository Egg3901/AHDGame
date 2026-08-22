/**
 * Tests for the DD Volkskammer legislature page.
 *
 * Focus: the unicameral data scope (every fetch keys on "volkskammer") and
 * the Leadership tab — deputies must be able to act on the General Secretary
 * from the legislature page, and the sitting Chairman of the Council of State
 * (or its vacancy) must be surfaced.
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
      data-testid="dd-gov-actions"
      data-executive-title={props.executiveTitle}
      data-member-label={props.memberLabel}
      data-status={String(props.governmentStatus)}
    />
  ),
}));

import { DDVolkskammerPage } from "./DDVolkskammerPage";

const membersPayload = {
  totalSeats: 500,
  filledSeats: 1,
  vacantSeats: 499,
  composition: [
    {
      partyId: "1",
      partyName: "Socialist Unity Party",
      partyColor: "#CC0000",
      economicPosition: -4,
      seats: 1,
    },
  ],
  members: [],
};

const executivePayload = {
  headOfState: null,
  government: {
    status: "formed",
    pmName: "Test Secretary",
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

describe("DDVolkskammerPage", () => {
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

  it("scopes every data fetch to the unicameral volkskammer chamber", () => {
    render(<DDVolkskammerPage countryId="DD" />);
    expect(useLegislatureDataMock).toHaveBeenLastCalledWith("DD", "volkskammer");
  });

  it("wires General Secretary / Volkskammer Deputy labels into the actions panel", async () => {
    render(<DDVolkskammerPage countryId="DD" />);
    fireEvent.click(screen.getByRole("button", { name: "Leadership" }));

    const actions = await screen.findByTestId("dd-gov-actions");
    expect(actions.getAttribute("data-executive-title")).toBe("General Secretary");
    expect(actions.getAttribute("data-member-label")).toBe("Volkskammer Deputy");
    await waitFor(() => {
      expect(actions.getAttribute("data-status")).toBe("formed");
    });
  });

  it("surfaces the Council of State chairman vacancy on the Leadership tab", async () => {
    render(<DDVolkskammerPage countryId="DD" />);
    fireEvent.click(screen.getByRole("button", { name: "Leadership" }));

    expect(await screen.findByText("Chairman of the Council of State")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText(/Vacant because the SED chair is not seated/)).toBeTruthy();
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

    render(<DDVolkskammerPage countryId="DD" />);
    fireEvent.click(screen.getByRole("button", { name: "Leadership" }));

    await waitFor(() => {
      expect(screen.getByText("Seated Chairman")).toBeTruthy();
    });
  });

  it("shows the party-chair-synced Chairman returned by the executive API", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ...executivePayload,
        headOfState: { characterName: "Ivanka Trump" },
      }),
    })) as unknown as typeof fetch;

    render(<DDVolkskammerPage countryId="DD" />);
    fireEvent.click(screen.getByRole("button", { name: "Leadership" }));

    await waitFor(() => {
      expect(screen.getByText("Ivanka Trump")).toBeTruthy();
    });
  });
});
