/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { PresMapModel, PresMapState } from "../blend/presMap/presMapModel";
import {
  buildSimulationScript,
  simulationFrame,
} from "@/lib/elections/liveResults/simulateResults";
import { NightBroadcast } from "./NightBroadcast";
import { NightStatePanel } from "./NightStatePanel";
import { buildNightMapModel } from "./nightMapModel";
import { ALERT_MS } from "./nightModel";
import { useNightHold } from "./useNightBroadcast";
import { CAND_A, CAND_B, POISON_VOTES, nightFixture, settledFixture, unit } from "./nightTestData";

// The map itself is exercised in the presMap tests; here it dumps the model it
// was handed, so what the broadcast feeds it can be asserted as text.
vi.mock("../blend/presMap/PresidentialMap", () => ({
  PresidentialMap: ({ model }: { model: PresMapModel }) => (
    <div data-testid="map">
      {Object.values(model.states).map((s: PresMapState) => (
        <div key={s.id} data-state-row={s.id} data-pulse={s.pulse ?? ""}>
          {s.id}|{s.caption}|{s.leaderName}|{s.shares.map((x) => `${x.name}:${x.votes}`).join(",")}
        </div>
      ))}
    </div>
  ),
}));
vi.mock("../blend/presMap/CountySection", () => ({
  CountySection: ({ stateId }: { stateId: string }) => <div data-testid="counties">{stateId}</div>,
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const props = { concludedHref: "/elections/e1" };

describe("NightBroadcast", () => {
  it("renders the broadcast chrome from the night payload", () => {
    render(<NightBroadcast data={nightFixture()} {...props} />);
    expect(screen.getByText("LIVE")).toBeTruthy();
    expect(screen.getByText("1 of 6")).toBeTruthy();
    expect(screen.getAllByText("270").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Projected: Alex Morrow wins Georgia \(16 EV\)/).length
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/Too close to call/).length).toBeGreaterThan(0);
    // Next closing batch and its countdown.
    expect(screen.getAllByText("9:00 PM ET").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^in \d+:\d\d$/).length).toBeGreaterThan(0);
  });

  it("renders no number for a state that has not reported", () => {
    const { container } = render(<NightBroadcast data={nightFixture()} {...props} />);
    const text = container.textContent ?? "";
    expect(text).not.toContain(String(POISON_VOTES));
    expect(text).not.toContain("987,654,321");
    const tx = screen.getByText(/^TX\|/);
    expect(tx.textContent).toBe("TX|Polls close 9:00 PM ET||");
    const oh = screen.getByText(/^OH\|/);
    expect(oh.textContent).toBe("OH|Too early to call, 4% reporting||");
    // A state with numbers does carry them.
    expect(screen.getByText(/^PA\|/).textContent).toContain("Alex Morrow:270000");
  });

  it("shows the live bug, not the final bug, while the night is on", () => {
    render(<NightBroadcast data={nightFixture()} {...props} />);
    expect(screen.queryByText("FINAL")).toBeNull();
    expect(screen.queryByTestId("night-settled")).toBeNull();
  });

  it("settles on a winner with a link through to the concluded results", () => {
    render(<NightBroadcast data={settledFixture()} {...props} />);
    expect(screen.getAllByText("FINAL").length).toBeGreaterThan(0);
    const settled = screen.getByTestId("night-settled");
    expect(settled.textContent).toContain("Winner");
    expect(settled.textContent).toContain("Alex Morrow");
    expect(settled.textContent).toContain("100% reporting");
    expect(screen.getByRole("link", { name: "View concluded results" }).getAttribute("href")).toBe(
      "/elections/e1"
    );
    expect(screen.getAllByText(/^[A-Z]{2}\|Projected, 100% reporting/).length).toBe(6);
  });

  it("uses a continue button instead of a link when the page keeps the broadcast in place", () => {
    const onContinue = vi.fn();
    render(<NightBroadcast data={settledFixture()} {...props} onContinue={onContinue} />);
    fireEvent.click(screen.getByRole("button", { name: "View concluded results" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("shows the contingent election when nobody reached the majority", () => {
    render(<NightBroadcast data={settledFixture(null)} {...props} />);
    const settled = screen.getByTestId("night-settled");
    expect(settled.textContent).toContain("Contingent election");
    expect(settled.textContent).toContain("No candidate reached 270 electoral votes");
    expect(settled.textContent).toContain("contingent election in the House");
  });

  it("names the contingent winner when the ballot result is known", () => {
    render(
      <NightBroadcast
        data={settledFixture(null)}
        {...props}
        contingent={{
          result: {
            presidentWinnerId: CAND_B,
            houseVoteTotals: { [CAND_B]: 27 },
            houseThreshold: 26,
            deadlockBreakerUsed: false,
          } as never,
        }}
      />
    );
    const text = screen.getByTestId("night-settled").textContent;
    expect(text).toContain("The House elects Jordan Blake");
    expect(text).toContain("Jordan Blake won 27 of the 26 delegations needed.");
  });

  it("takes the House winner from the payload, never the popular-vote or EV leader", () => {
    const data = settledFixture(CAND_A);
    data.summary.projectedWinner = CAND_B;
    data.summary.resolutionMode = "contingent_deadlock";
    data.summary.contingentResult = {
      presidentWinnerId: CAND_B,
      houseVoteTotals: { [CAND_B]: 11 },
      houseThreshold: 26,
      deadlockBreakerUsed: true,
    } as never;
    render(<NightBroadcast data={data} {...props} />);
    const text = screen.getByTestId("night-settled").textContent;
    expect(text).toContain("Contingent election");
    expect(text).toContain("The House elects Jordan Blake");
    expect(text).toContain("seated under the deadlock rule");
    expect(text).not.toContain("Winner");
  });
});

describe("House deadlock on the settled board", () => {
  it("names the acting president and the House vote window, not the delegation leader", () => {
    const data = settledFixture(CAND_A);
    data.summary.projectedWinner = null;
    data.summary.resolutionMode = "contingent_deadlock";
    data.summary.contingentResult = {
      presidentWinnerId: CAND_B,
      houseVoteTotals: { [CAND_B]: 10 },
      houseThreshold: 26,
      deadlockBreakerUsed: true,
      houseDeadlocked: true,
    } as never;
    data.summary.contingentHouseVote = {
      status: "open",
      actingPresidentName: "Casey Acting",
      closesTurn: 73,
    };
    render(<NightBroadcast data={data} {...props} />);
    const text = screen.getByTestId("night-settled").textContent;
    expect(text).toContain("The House has not chosen a president");
    expect(text).toContain("Casey Acting serves as acting president");
    expect(text).toContain("until turn 73");
    expect(text).not.toContain("The House elects");
  });
});

describe("settling keeps the night's record", () => {
  it("keeps the night feed on the settled board", () => {
    const live = nightFixture();
    live.election.night!.feed = [
      ...live.election.night!.feed,
      { at: "2026-10-08T05:25:00.000Z", stateId: "PA", kind: "call", candidateId: CAND_B },
    ];
    const { rerender } = render(<NightBroadcast data={live} {...props} />);
    rerender(<NightBroadcast data={settledFixture()} {...props} />);
    expect(screen.getAllByText(/Projected: Jordan Blake wins Pennsylvania/).length).toBeGreaterThan(
      0
    );
    expect(screen.queryByText("Polls have not closed yet.")).toBeNull();
  });
});

describe("call alerts in the broadcast", () => {
  const withCall = () => {
    const data = nightFixture();
    data.election.night!.feed = [
      ...data.election.night!.feed,
      { at: "2026-10-08T05:25:00.000Z", stateId: "PA", kind: "call", candidateId: CAND_B },
    ];
    data.units[1] = { ...data.units[1], called: true, calledFor: CAND_B, nightStatus: "called" };
    data.election.night!.calledEv = { [CAND_A]: 16, [CAND_B]: 19 };
    data.election.night!.statesCalled = 2;
    return data;
  };

  it("gives a late joiner no alert for calls already on the board", () => {
    render(<NightBroadcast data={withCall()} {...props} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("alerts a call that lands while watching, once, then clears it", () => {
    vi.useFakeTimers();
    const { rerender } = render(<NightBroadcast data={nightFixture()} {...props} />);
    expect(screen.queryByRole("status")).toBeNull();

    rerender(<NightBroadcast data={withCall()} {...props} />);
    const alert = screen.getByRole("status");
    expect(alert.textContent).toContain("Jordan Blake wins Pennsylvania");
    expect(alert.textContent).toContain("19 electoral votes");
    // The map is told to highlight the called state.
    expect(screen.getByText(/^PA\|/).getAttribute("data-pulse")).toBe("call:PA");

    // A re-poll with the same feed does not alert again.
    rerender(<NightBroadcast data={{ ...withCall() }} {...props} />);
    expect(screen.getAllByRole("status")).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(ALERT_MS + 50);
    });
    expect(screen.queryByRole("status")).toBeNull();
    rerender(<NightBroadcast data={withCall()} {...props} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("NightStatePanel", () => {
  const panel = (id: string, settled = false, data = nightFixture()) => {
    const model = buildNightMapModel(data, settled);
    return render(
      <NightStatePanel
        state={model.states[id]}
        model={model}
        electionId="e1"
        countryId="US"
        turn={35}
        settled={settled}
        onClose={() => {}}
      />
    );
  };

  it("shows status, reporting and poll close for a state that has not reported, and no numbers", () => {
    const { container } = panel("TX");
    expect(container.textContent).toContain("Polls open");
    expect(container.textContent).toContain("Polls close 9:00 PM ET");
    expect(container.textContent).toContain("0.0%");
    expect(container.textContent).toContain("Polls are still open. No votes are reported.");
    expect(container.textContent).not.toContain("987,654,321");
    expect(screen.queryByTestId("counties")).toBeNull();
  });

  it("keeps a too-early state leaderless", () => {
    const { container } = panel("OH");
    expect(container.textContent).toContain("Too early to call");
    expect(container.textContent).not.toContain("Jordan Blake");
    expect(container.textContent).not.toContain("987,654,321");
  });

  it("shows fogged numbers but no counties before a call", () => {
    const { container } = panel("PA");
    expect(container.textContent).toContain("Not yet called");
    expect(container.textContent).toContain("Alex Morrow");
    expect(container.textContent).toContain("270,000 votes");
    expect(screen.queryByTestId("counties")).toBeNull();
    expect(container.textContent).toContain("County results open once the state is called.");
    expect(screen.queryByText(/Open full/)).toBeNull();
  });

  it("opens counties once the state is called", () => {
    const { container } = panel("GA");
    expect(container.textContent).toContain("Projected: Alex Morrow wins");
    expect(screen.getByTestId("counties").textContent).toBe("GA");
  });

  it("opens counties and the full state page once the race has resolved", () => {
    panel("PA", true, settledFixture());
    expect(screen.getByTestId("counties")).toBeTruthy();
    expect(screen.getByText("Open full Pennsylvania page")).toBeTruthy();
  });
});

describe("useNightHold", () => {
  it("shows the night, settles on resolve, and lets the viewer move on", () => {
    const { result, rerender } = renderHook(({ data }) => useNightHold(data), {
      initialProps: { data: nightFixture() },
    });
    expect(result.current).toMatchObject({ show: true, settled: false });

    rerender({ data: settledFixture() });
    expect(result.current).toMatchObject({ show: true, settled: true });

    act(() => result.current.dismiss());
    expect(result.current).toMatchObject({ show: false, settled: false });
  });

  it("shows the normal page when no night is present", () => {
    const quiet = settledFixture();
    quiet.election.status = "active";
    const { result } = renderHook(() => useNightHold(quiet));
    expect(result.current).toMatchObject({ show: false, settled: false });
  });

  it("does not settle a resolved race the viewer never saw as a night", () => {
    const { result } = renderHook(() => useNightHold(settledFixture()));
    expect(result.current).toMatchObject({ show: false, settled: false });
  });

  it("does not settle after an admin replay ends", () => {
    const replay = { ...nightFixture(), simulated: true };
    const { result, rerender } = renderHook(({ data }) => useNightHold(data), {
      initialProps: { data: replay },
    });
    expect(result.current.show).toBe(true);
    rerender({ data: settledFixture() as typeof replay });
    expect(result.current).toMatchObject({ show: false, settled: false });
  });

  it("drops back to the normal page if the night disappears without resolving", () => {
    const { result, rerender } = renderHook(({ data }) => useNightHold(data), {
      initialProps: { data: nightFixture() },
    });
    const paused = settledFixture();
    paused.election.status = "active";
    rerender({ data: paused });
    expect(result.current.show).toBe(false);
  });
});

describe("buildNightMapModel", () => {
  it("never carries leader, shares or votes for a state without numbers", () => {
    const model = buildNightMapModel(nightFixture(), false);
    for (const id of ["TX", "OH", "CA"]) {
      const s = model.states[id];
      expect(s.leaderName).toBe("");
      expect(s.shares).toEqual([]);
      expect(s.totalVotes).toBe(0);
      expect(s.broadcast?.showNumbers).toBe(false);
    }
    expect(model.states.PA.shares).toHaveLength(2);
  });

  it("skips district units the map cannot plot", () => {
    const data = nightFixture();
    data.units.push(unit("ME_CD1", "Maine CD-1", 1, "polls_open"));
    expect(buildNightMapModel(data, false).states.ME_CD1).toBeUndefined();
  });

  it("pulses only the state of the active alert", () => {
    const model = buildNightMapModel(nightFixture(), false, {
      pulseStateId: "GA",
      pulseToken: "call:GA",
    });
    expect(model.states.GA.pulse).toBe("call:GA");
    expect(model.states.PA.pulse).toBeUndefined();
  });
});

describe("admin replay", () => {
  it("drives the same broadcast from simulated frames, from wiped board to a full night", () => {
    const base = nightFixture();
    const script = buildSimulationScript(base, 11);
    const { rerender } = render(<NightBroadcast data={simulationFrame(script, 0.01)} {...props} />);
    expect(screen.getByText("LIVE")).toBeTruthy();
    expect(screen.getByText(/^TX\|Polls close/)).toBeTruthy();

    let called = 0;
    for (const p of [0.3, 0.6, 0.95]) {
      const frame = simulationFrame(script, p);
      rerender(<NightBroadcast data={frame} {...props} />);
      expect(frame.simulated).toBe(true);
      const night = frame.election.night!;
      expect(night.statesCalled).toBeGreaterThanOrEqual(called);
      called = night.statesCalled;
    }
    expect(called).toBeGreaterThan(0);
    // Replays show the same clock, race bar and feed chrome as a live night.
    expect(screen.getAllByText(/ET$/).length).toBeGreaterThan(0);
    expect(screen.getByTestId("race-bar")).toBeTruthy();
  });
});
