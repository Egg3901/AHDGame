// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { WorldAlignmentView } from "@/lib/alignment/queries/worldAlignment";
import { ColdWarLedgerClient } from "./ColdWarLedgerClient";

const COLD: WorldAlignmentView = {
  enabled: true,
  year: 1953,
  eraKey: "cold-war",
  joinGate: 50,
  remainderLabel: "Non-aligned",
  poles: [
    { id: "WEST", label: "West", shortLabel: "W", accentToken: "info" },
    { id: "EAST", label: "East", shortLabel: "E", accentToken: "error" },
  ],
  crises: [],
  rows: [
    {
      entityId: "US",
      name: "United States",
      isPlayable: true,
      shares: { WEST: 96, EAST: 1 },
      nonAligned: 3,
      previousShares: null,
      axis: 95,
      lead: 95,
      status: "locked",
      topPoleId: "WEST",
      trend: null,
      orgIds: ["NATO"],
    },
    {
      entityId: "YU",
      name: "Yugoslavia",
      isPlayable: true,
      shares: { WEST: 22, EAST: 50 },
      nonAligned: 28,
      previousShares: null,
      axis: -28,
      lead: 28,
      status: "contested",
      topPoleId: "EAST",
      trend: 4,
      orgIds: [],
    },
    {
      entityId: "SE",
      name: "Sweden",
      isPlayable: true,
      shares: { WEST: 30, EAST: 18 },
      nonAligned: 52,
      previousShares: null,
      axis: 12,
      lead: 12,
      status: "non-aligned",
      topPoleId: "WEST",
      trend: null,
      orgIds: [],
    },
  ],
};

const MODERN: WorldAlignmentView = {
  ...COLD,
  year: 2019,
  eraKey: "post-cold-war",
  joinGate: 35,
  poles: [
    { id: "WASHINGTON", label: "Washington", shortLabel: "WSH", accentToken: "info" },
    { id: "MOSCOW", label: "Moscow", shortLabel: "MOS", accentToken: "error" },
    { id: "BEIJING", label: "Beijing", shortLabel: "BEI", accentToken: "warning" },
  ],
  rows: [
    {
      entityId: "US",
      name: "United States",
      isPlayable: true,
      shares: { WASHINGTON: 94, MOSCOW: 1, BEIJING: 1 },
      nonAligned: 4,
      previousShares: null,
      axis: null,
      lead: 93,
      status: "locked",
      topPoleId: "WASHINGTON",
      trend: null,
      orgIds: ["NATO"],
    },
  ],
};

describe("ColdWarLedgerClient", () => {
  it("renders a row per nation with its band", () => {
    render(<ColdWarLedgerClient view={COLD} />);
    expect(screen.getByText("United States")).toBeTruthy();
    expect(screen.getByText("Yugoslavia")).toBeTruthy();
    // "Non-aligned" is both a band label and a filter chip, so scope to cells.
    expect(screen.getByRole("cell", { name: "Contested" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "Non-aligned" })).toBeTruthy();
  });

  it("shows an Axis column only in a two-bloc world", () => {
    const { unmount } = render(<ColdWarLedgerClient view={COLD} />);
    expect(screen.getByRole("columnheader", { name: "Axis" })).toBeTruthy();
    unmount();
    render(<ColdWarLedgerClient view={MODERN} />);
    expect(screen.queryByRole("columnheader", { name: "Axis" })).toBeNull();
  });

  it("uses the era's own bloc columns", () => {
    render(<ColdWarLedgerClient view={MODERN} />);
    for (const short of ["WSH", "MOS", "BEI"]) {
      expect(screen.getByRole("columnheader", { name: short })).toBeTruthy();
    }
  });

  it("filters to a single bloc", () => {
    render(<ColdWarLedgerClient view={COLD} />);
    fireEvent.click(screen.getByRole("button", { name: "East" }));
    expect(screen.getByText("Yugoslavia")).toBeTruthy();
    expect(screen.queryByText("United States")).toBeNull();
  });

  it("filters to the nations in play", () => {
    render(<ColdWarLedgerClient view={COLD} />);
    fireEvent.click(screen.getByRole("button", { name: "In play" }));
    // Locked USA drops out; contested and uncommitted remain.
    expect(screen.queryByText("United States")).toBeNull();
    expect(screen.getByText("Yugoslavia")).toBeTruthy();
    expect(screen.getByText("Sweden")).toBeTruthy();
  });

  it("searches by name", () => {
    render(<ColdWarLedgerClient view={COLD} />);
    fireEvent.change(screen.getByLabelText("Find a nation"), { target: { value: "swed" } });
    expect(screen.getByText("Sweden")).toBeTruthy();
    expect(screen.queryByText("Yugoslavia")).toBeNull();
  });

  it("explains an empty filter result", () => {
    render(<ColdWarLedgerClient view={COLD} />);
    fireEvent.change(screen.getByLabelText("Find a nation"), { target: { value: "zzz" } });
    expect(screen.getByText(/No nation matches/)).toBeTruthy();
  });

  it("explains a world with no alignment recorded", () => {
    render(<ColdWarLedgerClient view={{ ...COLD, rows: [] }} />);
    expect(screen.getByText(/No alignment has been recorded/)).toBeTruthy();
  });

  it("shows a disabled state, and no table, when the gate is off", () => {
    render(<ColdWarLedgerClient view={{ ...COLD, enabled: false, rows: [] }} />);
    expect(screen.getByText(/switched off for this world/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("signs the trend and dashes a missing one", () => {
    // Two decimals, always: drift is 0.04 a turn, so a trend trimmed to "+4"
    // could not tell a nation that gained four points from one that gained
    // four hundredths.
    render(<ColdWarLedgerClient view={COLD} />);
    expect(screen.getByText("+4.00")).toBeTruthy();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("uses no hardcoded colour or font", () => {
    const { container } = render(<ColdWarLedgerClient view={MODERN} />);
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    expect(container.innerHTML).not.toMatch(/font-family|IBM Plex|Georgia/);
  });

  it("marks entities the player cannot play, so macro nations are distinguishable", () => {
    const withMacro: WorldAlignmentView = {
      ...COLD,
      rows: [
        ...COLD.rows,
        {
          entityId: "JO",
          name: "Jordan",
          isPlayable: false,
          shares: { WEST: 40, EAST: 5 },
          nonAligned: 55,
          previousShares: null,
          axis: 35,
          lead: 35,
          status: "contested",
          topPoleId: "WEST",
          trend: null,
          orgIds: [],
        },
      ],
    };
    render(<ColdWarLedgerClient view={withMacro} />);
    expect(screen.getByText("Jordan")).toBeTruthy();
    // One marker only — the playable rows must not carry it.
    expect(screen.getAllByText("not playable")).toHaveLength(1);
  });
});
