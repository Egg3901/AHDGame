// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MergerReviewQueuePanel } from "./MergerReviewQueuePanel";
import { useMergerReviewQueue } from "../useMergerReviewQueue";

const pendingReview = {
  id: "r1",
  acquirerName: "Northern Steel",
  targetName: "Clyde Foundry",
  countryId: "UK",
  seatName: "Board of Trade",
  leadSectorType: "manufacturing",
  combinedSharePercent: 71,
  thresholdPercent: 60,
  status: "pending" as const,
  openedAtTurn: 10,
  decideByTurn: 18,
  defaultDecision: "clearedWithRemedy",
};

const holderPayload = {
  applies: true,
  seatName: "Board of Trade",
  countryId: "UK",
  enforcementLive: true,
  pending: [pendingReview],
  decided: [],
};

function mockFetch(body: unknown) {
  return vi.fn().mockImplementation((_url: string, init?: { method?: string }) => {
    if (init?.method === "POST")
      return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
    return Promise.resolve({ ok: true, json: async () => body });
  });
}

/** Exactly how the office page wires it: hook feeds panel, server decides. */
function Harness() {
  const { data, refetch } = useMergerReviewQueue(true);
  return <MergerReviewQueuePanel data={data} canAct onDecided={refetch} />;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MergerReviewQueuePanel", () => {
  it("shows the national queue to the seated officeholder", async () => {
    vi.stubGlobal("fetch", mockFetch(holderPayload));
    render(<Harness />);

    expect(await screen.findByText(/Northern Steel to Clyde Foundry/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Block$/ })).toBeTruthy();
    expect(screen.getByText(/Mergers referred to the Board of Trade/)).toBeTruthy();
  });

  it("posts the decision to the per-review route", async () => {
    const fetchMock = mockFetch(holderPayload);
    vi.stubGlobal("fetch", fetchMock);
    render(<Harness />);

    fireEvent.click(await screen.findByRole("button", { name: /^Block$/ }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          (c) => c[0] === "/api/merger-reviews/r1" && c[1]?.method === "POST"
        )
      ).toBe(true);
    });
  });

  it("renders nothing for someone who does not hold the seat", async () => {
    vi.stubGlobal("fetch", mockFetch({ applies: false }));
    const { container } = render(<Harness />);

    await waitFor(() => expect(container.textContent).toBe(""));
    expect(screen.queryByText(/Merger review/)).toBeNull();
  });

  it("renders nothing when the country and era have no such seat", async () => {
    // Same closed answer as a command economy: the endpoint reports applies:false
    // and the surface never appears, rather than showing an empty duty.
    vi.stubGlobal("fetch", mockFetch({ applies: false }));
    const { container } = render(<Harness />);
    await waitFor(() => expect(container.textContent).toBe(""));
  });

  it("does not offer decision buttons when the seat cannot act", async () => {
    vi.stubGlobal("fetch", mockFetch(holderPayload));
    function ReadOnlyHarness() {
      const { data, refetch } = useMergerReviewQueue(true);
      return <MergerReviewQueuePanel data={data} canAct={false} onDecided={refetch} />;
    }
    render(<ReadOnlyHarness />);

    expect(await screen.findByText(/Northern Steel to Clyde Foundry/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Block$/ })).toBeNull();
  });
});
