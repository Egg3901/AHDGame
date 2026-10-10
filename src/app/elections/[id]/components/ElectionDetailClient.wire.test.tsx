/** @vitest-environment happy-dom */
/**
 * The wire feed is fetched only where the ticker will draw it: a presidential
 * race with results coming in, for a signed-in reader. Everything else used to
 * poll a sign-in-only endpoint and log a 401 per visit.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ElectionDetail } from "./ElectionDetailTypes";

const auth = vi.hoisted(() => ({ signedIn: true }));
vi.mock("@/contexts/AuthDataContext", () => ({ useSignedIn: () => auth.signedIn }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/contexts/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/hooks/useGameEvents", () => ({
  useGameTurnStatus: () => null,
  useGameEvents: () => undefined,
}));
vi.mock("../blend/PrimaryBlendView", () => ({
  PrimaryBlendView: ({ stageActions }: { stageActions?: React.ReactNode }) => (
    <div data-testid="blend-primary">{stageActions}</div>
  ),
}));
vi.mock("./GeneralPhaseView", () => ({ GeneralPhaseView: () => null }));
vi.mock("./AdminSection", () => ({ AdminSection: () => null }));

import { ElectionDetailClient } from "./ElectionDetailClient";

function primary(over: Partial<ElectionDetail> = {}): ElectionDetail {
  return {
    id: "69b5b04bdf051bb43fc957b7",
    electionType: "president",
    countryId: "US",
    state: "US",
    status: "active",
    inPrimary: true,
    inGeneral: false,
    isEnded: false,
    isUpcoming: false,
    allCandidates: [],
    byParty: [],
    myCharId: "ch1",
    generalVotes: null,
    primaryCalendar: [{ label: "Wave", turnsRemaining: 0, states: ["IA"], status: "live" }],
    ...over,
  } as unknown as ElectionDetail;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  auth.signedIn = true;
  fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      String(url).includes("/wire") ? { items: [] } : { ...primary(), candidates: [] },
  }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wireCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("/wire"));

describe("the race wire fetch", () => {
  it("runs for a signed-in reader while a wave is being counted", async () => {
    render(<ElectionDetailClient id="US-president" initialElection={primary()} />);
    await waitFor(() => expect(wireCalls().length).toBeGreaterThan(0));
  });

  it("does not run for a signed-out visitor, so there is no 401 to log", async () => {
    auth.signedIn = false;
    render(<ElectionDetailClient id="US-president" initialElection={primary()} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(wireCalls()).toHaveLength(0);
  });

  it("does not run when no wave is live and the ticker will not draw", async () => {
    const quiet = primary({
      primaryCalendar: [{ label: "Wave", turnsRemaining: 5, states: ["IA"], status: "upcoming" }],
    } as Partial<ElectionDetail>);
    render(<ElectionDetailClient id="US-president" initialElection={quiet} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(wireCalls()).toHaveLength(0);
  });
});

describe("enter and withdraw", () => {
  it("are handed to the stage as an actions strip rather than left in the rail", async () => {
    const { findByText } = render(
      <ElectionDetailClient id="US-president" initialElection={primary()} />
    );
    expect((await findByText("Enter race")).closest("[data-testid=blend-primary]")).toBeTruthy();
  });
});
