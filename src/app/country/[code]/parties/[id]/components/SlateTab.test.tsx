/** @vitest-environment happy-dom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlateTab } from "./SlateTab";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/elections/SlateElectionResults", () => ({
  SlateElectionResults: () => null,
}));
vi.mock("./SlateAssignmentPicker", () => ({ AssignmentPicker: () => null }));
vi.mock("@/contexts/useGameClock", () => ({
  useGameClock: () => ({ formatAbsoluteDeadline: () => "deadline" }),
}));

const raceA = "507f1f77bcf86cd799439011";
const raceB = "507f1f77bcf86cd799439012";
const races = [
  { electionId: raceA, electionType: "commons", state: "NEE" },
  { electionId: raceB, electionType: "commons", state: "NEE" },
  { electionId: "507f1f77bcf86cd799439013", electionType: "commons", state: "SCT" },
].map((race) => ({
  id: null,
  senateClass: null,
  chamberClass: null,
  electionStatus: "active",
  electionCycle: 4,
  electionPrimaryEndTime: null,
  priority: "none" as const,
  notes: null,
  candidateCounts: { invited: 0, considering: 0, accepted: 0, declined: 0, withdrawn: 0, filed: 0 },
  createdAt: null,
  updatedAt: null,
  ...race,
}));

function detailResponse(electionId: string) {
  return {
    slate: {
      id: null,
      electionId,
      electionType: "commons",
      state: "NEE",
      priority: "none",
      notes: null,
      archivedAt: null,
    },
    candidates: [],
    election: {
      id: electionId,
      electionType: "commons",
      state: "NEE",
      status: "active",
      cycle: 4,
      primaryEndTime: null,
      phaseStatus: null,
    },
    electionDisplay: null,
    stateAssignedCandidateIds: [],
  };
}

function response(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("SlateTab race details", () => {
  it("loads only opened races, reuses fresh details, and resets on state change", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/slate")) return response({ items: races, stateAggregates: [] });
      if (url.includes("/slate/")) return response(detailResponse(url.split("/").pop()!));
      return response({ isActive: true, pausedAt: null, lastTurnProcessed: null });
    });
    vi.stubGlobal("fetch", fetchMock);

    const props = {
      countryCode: "uk",
      countryId: "UK",
      partyId: "1",
      partyColor: "#123456",
      canManageSlate: false,
      partyMembers: [],
      scopeState: "NEE",
    };
    const view = render(<SlateTab {...props} />);

    await screen.findAllByRole("button", { name: "Show slate" });
    const detailsUrl = `/api/country/uk/parties/1/slate/${raceA}`;
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/slate/")).length).toBe(0);

    fireEvent.click(screen.getAllByRole("button", { name: "Show slate" })[0]!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(detailsUrl, { cache: "no-store" }));
    expect(
      fetchMock.mock.calls
        .filter(([url]) => String(url).includes("/slate/"))
        .map(([url]) => String(url))
    ).toEqual([detailsUrl]);

    fireEvent.click(screen.getAllByRole("button", { name: "Hide slate" })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "Show slate" })[0]!);
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Hide slate" })).toHaveLength(1)
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/slate/"))).toHaveLength(1);

    fireEvent.click(screen.getAllByRole("button", { name: "Show slate" })[0]!);
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/slate/"))).toHaveLength(
        2
      )
    );
    expect(
      String(fetchMock.mock.calls.filter(([url]) => String(url).includes("/slate/"))[1]![0])
    ).toContain(raceB);

    // Details reset on a state change; forget the remembered open choice so cards start closed.
    window.localStorage.clear();
    view.rerender(<SlateTab {...props} scopeState="SCT" />);
    await screen.findByRole("button", { name: "Show slate" });
    expect(screen.queryByText("No one is assigned to this race yet.")).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/slate/"))).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Show slate" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/slate/"))).toHaveLength(
        3
      )
    );
    expect(
      String(fetchMock.mock.calls.filter(([url]) => String(url).includes("/slate/"))[2]![0])
    ).toContain("507f1f77bcf86cd799439013");
  });

  it("allows retry after a per-race detail request fails", async () => {
    let fail = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/slate"))
        return response({ items: races.slice(0, 1), stateAggregates: [] });
      if (url.includes("/slate/")) {
        if (fail) return response({ error: "Temporary error" }, false);
        return response(detailResponse(raceA));
      }
      return response({ isActive: true, pausedAt: null, lastTurnProcessed: null });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <SlateTab
        countryCode="uk"
        countryId="UK"
        partyId="1"
        partyColor="#123456"
        canManageSlate={false}
        partyMembers={[]}
        scopeState="NEE"
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Show slate" }));
    await screen.findByRole("button", { name: "Retry slate" });
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry slate" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry slate" })).toBeNull());
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/slate/"))).toHaveLength(2);
  });

  it("resets cached and in-flight details when the party changes", async () => {
    let resolveFirstDetail: ((value: ReturnType<typeof response>) => void) | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/slate"))
        return Promise.resolve(response({ items: races.slice(0, 1), stateAggregates: [] }));
      if (url.includes("/slate/")) {
        if (url.includes("/parties/1/")) {
          return new Promise<ReturnType<typeof response>>((resolve) => {
            resolveFirstDetail = resolve;
          });
        }
        return Promise.resolve(response(detailResponse(raceA)));
      }
      return Promise.resolve(response({ isActive: true, pausedAt: null, lastTurnProcessed: null }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const props = {
      countryCode: "uk",
      countryId: "UK",
      partyId: "1",
      partyColor: "#123456",
      canManageSlate: false,
      partyMembers: [],
      scopeState: "NEE",
    };
    const view = render(<SlateTab {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Show slate" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`/api/country/uk/parties/1/slate/${raceA}`, {
        cache: "no-store",
      })
    );
    window.localStorage.clear();
    view.rerender(<SlateTab {...props} partyId="2" />);

    await screen.findByRole("button", { name: "Show slate" });
    resolveFirstDetail?.(response(detailResponse(raceA)));
    await waitFor(() =>
      expect(screen.queryByText("No one is assigned to this race yet.")).toBeNull()
    );

    fireEvent.click(screen.getByRole("button", { name: "Show slate" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`/api/country/uk/parties/2/slate/${raceA}`, {
        cache: "no-store",
      })
    );
  });

  it("opens cards for viewers who can assign candidates and remembers a manual close", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/slate"))
        return response({ items: races.slice(0, 2), stateAggregates: [] });
      if (url.includes("/slate/")) return response(detailResponse(url.split("/").pop()!));
      return response({ isActive: true, pausedAt: null, lastTurnProcessed: null });
    });
    vi.stubGlobal("fetch", fetchMock);
    const props = {
      countryCode: "uk",
      countryId: "UK",
      partyId: "1",
      partyColor: "#123456",
      canManageSlate: true,
      partyMembers: [],
      scopeState: "NEE",
    };
    const first = render(<SlateTab {...props} />);

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Hide slate" })).toHaveLength(2)
    );
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/slate/"))).toHaveLength(
        2
      )
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Hide slate" })[0]!);
    first.unmount();
    render(<SlateTab {...props} />);
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Show slate" })).toHaveLength(2)
    );
  });
});
