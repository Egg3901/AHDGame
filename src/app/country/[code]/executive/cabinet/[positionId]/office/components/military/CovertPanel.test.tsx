/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CovertPanel, suspicionLabel, type CovertStatusView } from "./CovertPanel";
import { COVERT_STAGES, FUNDING_COST, FUNDING_PROGRESS } from "@/lib/military/covertNuclear";

afterEach(cleanup);

/** A mid-grind programme: enrichment underway, one crackdown behind it. */
function statusView(over: Partial<CovertStatusView> = {}): CovertStatusView {
  return {
    eligible: true,
    state: {
      stage: 1,
      progress: 30,
      funding: "steady",
      suspicion: 25,
      exposureCount: 1,
      startedTurn: 5,
      completed: false,
      brokenOutTurn: null,
    },
    stages: [...COVERT_STAGES],
    stageProgress: 60,
    discoveryChance: 0.004,
    fundingOptions: (Object.keys(FUNDING_COST) as Array<keyof typeof FUNDING_COST>).map((key) => ({
      key,
      cost: FUNDING_COST[key],
      progress: FUNDING_PROGRESS[key],
    })),
    ...over,
  };
}

function setup(over: Partial<React.ComponentProps<typeof CovertPanel>> = {}) {
  return render(
    <CovertPanel
      status={statusView()}
      currencySymbol="M"
      canAct
      busy={false}
      onSetFunding={vi.fn(async () => true)}
      onBreakout={vi.fn(async () => true)}
      {...over}
    />
  );
}

describe("suspicionLabel", () => {
  it("bands suspicion into COLD, WARM, HOT", () => {
    expect(suspicionLabel(0)).toBe("COLD");
    expect(suspicionLabel(19.9)).toBe("COLD");
    expect(suspicionLabel(20)).toBe("WARM");
    expect(suspicionLabel(50)).toBe("HOT");
  });
});

describe("CovertPanel", () => {
  it("shows a loading card while the flagship's fetch is in flight", () => {
    setup({ status: undefined });
    expect(screen.getByText(/Loading the special programme/)).toBeTruthy();
  });

  it("renders the full stage ladder with completed, current and locked stages", () => {
    setup();
    for (const stage of COVERT_STAGES) {
      expect(screen.getByText(stage.name)).toBeTruthy();
    }
    expect(screen.getByText("Complete")).toBeTruthy();
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(screen.getAllByText("Locked")).toHaveLength(3);
  });

  it("shows the qualitative suspicion band, discovery risk and crackdown count", () => {
    setup();
    expect(screen.getByText("WARM")).toBeTruthy();
    expect(screen.getByText("0.4%")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("offers the funding menu with per-turn costs and marks the active level", () => {
    const onSetFunding = vi.fn(async () => true);
    setup({ onSetFunding });
    const steady = screen.getByRole("button", { name: /steady/i }) as HTMLButtonElement;
    expect(steady.disabled).toBe(true); // the level already set
    fireEvent.click(screen.getByRole("button", { name: /crash/i }));
    expect(onSetFunding).toHaveBeenCalledWith("crash");
    expect(screen.getByText(/M780\/turn/)).toBeTruthy();
  });

  it("requires confirmation before the breakout test", () => {
    const onBreakout = vi.fn(async () => true);
    setup({
      status: statusView({
        state: { ...statusView().state, stage: 5, completed: true, funding: "none" },
      }),
      onBreakout,
    });
    expect(screen.getByText(/The device is assembled/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^breakout test$/i }));
    expect(onBreakout).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /confirm breakout test/i }));
    expect(onBreakout).toHaveBeenCalled();
  });

  it("shows no breakout action once the test is done", () => {
    setup({
      status: statusView({
        state: {
          ...statusView().state,
          stage: 5,
          completed: true,
          funding: "none",
          brokenOutTurn: 44,
        },
      }),
    });
    expect(screen.getByText(/conducted on turn 44/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /breakout/i })).toBeNull();
  });

  it("offers no controls to a viewer who cannot act", () => {
    setup({
      canAct: false,
      status: statusView({
        state: { ...statusView().state, stage: 5, completed: true, funding: "none" },
      }),
    });
    expect(screen.queryByRole("button", { name: /breakout/i })).toBeNull();
  });
});
