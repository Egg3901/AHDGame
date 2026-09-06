/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BlendOpsSection } from "./BlendOpsSection";
import type { OpsRowVM, OpsTreeVM } from "./campaignBlendViewModel";
import { blendSegments } from "@/components/blend/tokens";

function branch(over: Partial<OpsTreeVM["branches"][number]> = {}) {
  return {
    key: "a" as const,
    label: "Grassroots",
    description: "Small-dollar donor network.",
    level: 1,
    maxLevel: 3,
    segments: blendSegments(1, 3, "#fbbf24"),
    effect: "+$200k/turn",
    costText: "$150,000 · 15a",
    maintenanceText: "",
    maxed: false,
    affordable: true,
    actionable: true,
    statusText: "",
    ...over,
  };
}

function tree(over: Partial<OpsTreeVM> = {}): OpsTreeVM {
  return {
    unlocked: true,
    starterEffect: "Opens a fundraising operation.",
    starterCostText: "$50,000 · 10a",
    starterAffordable: true,
    requiresTarget: false,
    targetName: null,
    targetOptions: [],
    branches: [
      branch(),
      branch({ key: "b", label: "Bundlers" }),
      branch({ key: "c", label: "Direct Mail" }),
    ],
    ...over,
  };
}

function row(over: Partial<OpsRowVM> = {}): OpsRowVM {
  return {
    key: "fundraising",
    label: "Fundraising",
    description: "Increase campaign revenue generation",
    effect: "+$270,250/turn income",
    color: "#fbbf24",
    invested: 3,
    level: "3/10",
    segments: blendSegments(3, 10, "#fbbf24"),
    expanded: false,
    tree: null,
    nextStep: { effect: "+$35k/turn", costText: "$50,000 · 10 actions" },
    ...over,
  };
}

const noop = () => {};

function renderSection(over: Partial<Parameters<typeof BlendOpsSection>[0]> = {}) {
  return render(
    <BlendOpsSection
      rows={[row()]}
      investedLine="3 of 40 invested"
      canAct
      pending={null}
      onToggle={noop}
      onUnlock={noop}
      onUpgrade={noop}
      {...over}
    />
  );
}

describe("row", () => {
  it("shows the lever, its current effect and its level", () => {
    renderSection();
    expect(screen.getByText("Fundraising")).toBeTruthy();
    expect(screen.getByText("+$270,250/turn income")).toBeTruthy();
    expect(screen.getByText("3/10")).toBeTruthy();
  });

  it("renders one segment per point of the ten-point scale", () => {
    const { container } = renderSection();
    expect(container.querySelectorAll("i")).toHaveLength(10);
  });

  it("toggles the lever it was clicked on", () => {
    const onToggle = vi.fn();
    renderSection({ onToggle });
    screen.getByRole("button", { name: /Fundraising/ }).click();
    expect(onToggle).toHaveBeenCalledWith("fundraising");
  });

  it("marks the row expanded for assistive tech", () => {
    renderSection({ rows: [row({ expanded: true, tree: tree() })] });
    expect(screen.getByRole("button", { name: /Fundraising/ }).getAttribute("aria-expanded")).toBe(
      "true"
    );
  });

  it("keeps the tree closed until the row is expanded", () => {
    renderSection();
    expect(screen.queryByText("Grassroots")).toBeNull();
  });
});

describe("expanded tree", () => {
  it("shows the branches in place rather than in an overlay", () => {
    const { container } = renderSection({ rows: [row({ expanded: true, tree: tree() })] });
    expect(screen.getByText("Grassroots")).toBeTruthy();
    expect(screen.getByText("Bundlers")).toBeTruthy();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("reports an unlocked operation as active", () => {
    renderSection({ rows: [row({ expanded: true, tree: tree() })] });
    expect(screen.getByText("Operation active")).toBeTruthy();
    expect(screen.getByText("UNLOCKED")).toBeTruthy();
  });

  it("offers the unlock and hides branch actions while the lever is locked", () => {
    const locked = tree({
      unlocked: false,
      branches: [
        branch({ actionable: false, statusText: "Locked" }),
        branch({ key: "b", actionable: false, statusText: "Locked" }),
        branch({ key: "c", actionable: false, statusText: "Locked" }),
      ],
    });
    renderSection({ rows: [row({ expanded: true, tree: locked })] });

    expect(screen.getByText("Unlock operation")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Upgrade" })).toBeNull();
    expect(screen.getAllByText("Locked").length).toBe(3);
  });

  it("disables the unlock the campaign cannot afford, and says so", () => {
    const poor = tree({ unlocked: false, starterAffordable: false });
    renderSection({ rows: [row({ expanded: true, tree: poor })] });
    const btn = screen.getByRole("button", { name: "Insufficient Resources" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables an unaffordable branch and labels the reason", () => {
    const t = tree({
      branches: [branch({ affordable: false }), branch({ key: "b" }), branch({ key: "c" })],
    });
    renderSection({ rows: [row({ expanded: true, tree: t })] });
    const btn = screen.getByRole("button", { name: "Can't Afford" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a maxed branch as maxed with no purchase button", () => {
    const t = tree({
      branches: [
        branch({ level: 3, maxed: true, actionable: false, statusText: "Max Level" }),
        branch({ key: "b" }),
        branch({ key: "c" }),
      ],
    });
    renderSection({ rows: [row({ expanded: true, tree: t })] });
    expect(screen.getByText("Max Level")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Upgrade" })).toHaveLength(2);
  });

  it("passes the branch key back on upgrade", () => {
    const onUpgrade = vi.fn();
    const t = tree({
      branches: [
        branch({ actionable: false, statusText: "" }),
        branch({ key: "b" }),
        branch({ key: "c", actionable: false }),
      ],
    });
    renderSection({ rows: [row({ expanded: true, tree: t })], onUpgrade });
    screen.getByRole("button", { name: "Upgrade" }).click();
    expect(onUpgrade).toHaveBeenCalledWith("fundraising", "b");
  });

  it("names the current opposition target when the lever needs one", () => {
    const t = tree({ requiresTarget: true, targetName: "Rival Candidate" });
    renderSection({ rows: [row({ key: "oppositionResearch", expanded: true, tree: t })] });
    expect(screen.getByText("Current target")).toBeTruthy();
    expect(screen.getByText("Rival Candidate")).toBeTruthy();
  });

  it("shows a branch's ongoing upkeep before it is bought", () => {
    const t = tree({
      branches: [
        branch({ maintenanceText: "+$4,200/turn upkeep" }),
        branch({ key: "b" }),
        branch({ key: "c" }),
      ],
    });
    renderSection({ rows: [row({ expanded: true, tree: t })] });
    expect(screen.getByText("+$4,200/turn upkeep")).toBeTruthy();
  });
});

describe("permissions", () => {
  it("hides every purchase control from a viewer who may not act", () => {
    renderSection({ rows: [row({ expanded: true, tree: tree() })], canAct: false });
    expect(screen.queryByRole("button", { name: "Upgrade" })).toBeNull();
    expect(screen.getByText("Grassroots")).toBeTruthy();
  });

  it("hides the unlock from a viewer who may not act", () => {
    renderSection({
      rows: [row({ expanded: true, tree: tree({ unlocked: false }) })],
      canAct: false,
    });
    expect(screen.queryByRole("button", { name: "Unlock" })).toBeNull();
  });
});

describe("in-flight purchases", () => {
  it("disables the branch whose purchase is in flight", () => {
    renderSection({
      rows: [row({ expanded: true, tree: tree() })],
      pending: "fundraising:a",
    });
    const btn = screen.getByRole("button", { name: "Working" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("leaves the other branches usable", () => {
    renderSection({
      rows: [row({ expanded: true, tree: tree() })],
      pending: "fundraising:a",
    });
    expect(screen.getAllByRole("button", { name: "Upgrade" })).toHaveLength(2);
  });
});

describe("what a lever costs", () => {
  // The briefing used to carry an Action tradeoffs card listing all four
  // levers' prices. It was removed as a duplicate, so the row that spends the
  // money has to answer "what does this buy, and for how much" on both layouts.
  it("puts the next tier's effect and price on the desktop row", () => {
    renderSection();
    expect(screen.getByText(/NEXT \+\$35k\/turn · \$50,000 · 10 actions/)).toBeTruthy();
  });

  it("puts the same line on the mobile row, which showed neither before", () => {
    renderSection({ variant: "mobile" });
    expect(screen.getByText(/NEXT \+\$35k\/turn · \$50,000 · 10 actions/)).toBeTruthy();
    expect(screen.getByText("+$270,250/turn income")).toBeTruthy();
  });

  it("says nothing about a next tier once the lever is maxed", () => {
    renderSection({ rows: [row({ nextStep: null })] });
    expect(screen.queryByText(/NEXT /)).toBeNull();
  });
});

describe("choosing an opposition-research target", () => {
  // The whole target block used to be gated on already having a target, so the
  // only control that opens the picker lived inside the panel that appeared
  // once you had one. There was no way to choose the first, which read on the
  // page as the field having gone missing.
  const FIELD = [
    { id: "t1", name: "Reginald Lindqvist", party: "Democratic Party" },
    { id: "t2", name: "Eleanor Voss", party: "Democratic Party" },
  ];
  const oppoRow = (over = {}) =>
    row({
      expanded: true,
      tree: tree({ requiresTarget: true, targetName: null, targetOptions: FIELD, ...over }),
    });

  it("says so when nobody is being researched yet", () => {
    renderSection({ rows: [oppoRow()], onRetarget: noop });
    expect(screen.getByText("No target yet")).toBeTruthy();
    expect(screen.getByText("Nobody is being researched")).toBeTruthy();
  });

  it("offers a way to choose the first target, not only to change one", () => {
    renderSection({ rows: [oppoRow()], onRetarget: noop });
    expect(screen.getByRole("button", { name: "Choose" })).toBeTruthy();
  });

  it("opens a picker over the field and hands back the pick", () => {
    const onRetarget = vi.fn();
    renderSection({ rows: [oppoRow()], onRetarget });
    fireEvent.click(screen.getByRole("button", { name: "Choose" }));
    fireEvent.click(screen.getByText("Eleanor Voss"));
    expect(onRetarget).toHaveBeenCalledWith("t2");
  });

  it("filters the field as the reader types", () => {
    renderSection({ rows: [oppoRow()], onRetarget: noop });
    fireEvent.click(screen.getByRole("button", { name: "Choose" }));
    fireEvent.change(screen.getByLabelText("Search the field…"), { target: { value: "elea" } });
    expect(screen.getByText("Eleanor Voss")).toBeTruthy();
    expect(screen.queryByText("Reginald Lindqvist")).toBeNull();
  });

  it("says the levels survive a change, because they do", () => {
    // Retargeting only sets the target and a six-turn cooldown; it never
    // touches the levels bought. Saying so is what stops the button reading as
    // a gamble.
    renderSection({ rows: [oppoRow({ targetName: "Reginald Lindqvist" })], onRetarget: noop });
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByText(/keeps every level you have bought/)).toBeTruthy();
  });

  it("names the current target and offers a change once one is set", () => {
    renderSection({ rows: [oppoRow({ targetName: "Reginald Lindqvist" })], onRetarget: noop });
    expect(screen.getByText("Current target")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change" })).toBeTruthy();
  });

  it("says why there is nothing to pick when the field is empty", () => {
    renderSection({ rows: [oppoRow({ targetOptions: [] })], onRetarget: noop });
    expect(screen.getByText("Nobody is standing against you in this race yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Choose" })).toBeNull();
  });

  it("leaves levers that take no target alone", () => {
    renderSection({ rows: [row({ expanded: true, tree: tree() })], onRetarget: noop });
    expect(screen.queryByText("No target yet")).toBeNull();
  });
});
