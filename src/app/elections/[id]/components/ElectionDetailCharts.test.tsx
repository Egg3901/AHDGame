/** @vitest-environment happy-dom */
/**
 * Reading a value off the trend charts.
 *
 * The lines showed the shape of a race but not its numbers: to find out what a
 * candidate held on a given turn you had to eyeball a polyline against a
 * four-step axis. Pointing at a turn now answers it outright.
 */
import React from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LineGraph, type LineSeries } from "./ElectionDetailCharts";
import type { VoteTurnSnapshot } from "./ElectionDetailTypes";

const SERIES: LineSeries[] = [
  { id: "c1", name: "First Ticket", color: "#2563eb" },
  { id: "c2", name: "Second Ticket", color: "#dc2626" },
];

const SNAPSHOTS = [
  { turn: 11, sharesPct: { c1: 51.2, c2: 48.8 }, cumulativeVotes: { c1: 10, c2: 9 } },
  { turn: 12, sharesPct: { c1: 55.5, c2: 44.5 }, cumulativeVotes: { c1: 20, c2: 18 } },
  { turn: 13, sharesPct: { c1: 58.74, c2: 41.26 }, cumulativeVotes: { c1: 30, c2: 27 } },
] as unknown as VoteTurnSnapshot[];

function renderGraph(over: Partial<React.ComponentProps<typeof LineGraph>> = {}) {
  return render(
    <LineGraph
      snapshots={SNAPSHOTS}
      series={SERIES}
      yValues={(id, snap) => snap.sharesPct[id] ?? null}
      yMax={100}
      yLabel={(v) => `${v}%`}
      xLabel={(snap) => `T${snap.turn}`}
      {...over}
    />
  );
}

/** The invisible per-turn hit bands, in turn order. */
const bands = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('rect[fill="transparent"]'));

/**
 * The readout, or null.
 *
 * Queried by role rather than by text: every turn is also an x-axis label, so
 * looking for "T13" on the page finds the axis whether or not anyone asked for
 * a readout.
 */
const readout = () => screen.queryByRole("tooltip");

describe("reading a turn off a trend chart", () => {
  it("gives every turn a hit band, not just the plotted dots", () => {
    // A 4px dot is not a target on a phone, and there is no cursor to aim with.
    const { container } = renderGraph();
    expect(bands(container)).toHaveLength(SNAPSHOTS.length);
  });

  it("says nothing until the reader asks", () => {
    renderGraph();
    expect(readout()).toBeNull();
  });

  it("names the turn and every series on it when hovered", () => {
    const { container } = renderGraph();
    fireEvent.pointerEnter(bands(container)[2]);
    const text = readout()?.textContent ?? "";
    expect(text).toContain("T13");
    expect(text).toContain("First Ticket");
    expect(text).toContain("Second Ticket");
  });

  it("clears when the pointer leaves the chart", () => {
    const { container } = renderGraph();
    fireEvent.pointerEnter(bands(container)[1]);
    expect(readout()?.textContent).toContain("T12");
    fireEvent.pointerLeave(container.querySelector("svg")!);
    expect(readout()).toBeNull();
  });

  it("closes on a second tap, since a tap has no hover to leave", () => {
    const { container } = renderGraph();
    fireEvent.pointerDown(bands(container)[0]);
    expect(readout()?.textContent).toContain("T11");
    fireEvent.pointerDown(bands(container)[0]);
    expect(readout()).toBeNull();
  });

  it("moves to another turn on a tap without closing", () => {
    const { container } = renderGraph();
    fireEvent.pointerDown(bands(container)[0]);
    fireEvent.pointerDown(bands(container)[2]);
    expect(readout()?.textContent).toContain("T13");
    expect(readout()?.textContent).not.toContain("T11");
  });

  it("orders the readout by value, so the leader on that turn reads first", () => {
    const { container } = renderGraph({
      // Second Ticket leads on every turn here, so the order cannot come from
      // the order the series were declared in.
      yValues: (id, snap) => (id === "c1" ? 10 : 90) + (snap.turn - 11),
    });
    fireEvent.pointerEnter(bands(container)[2]);
    const text = readout()?.textContent ?? "";
    expect(text.indexOf("Second Ticket")).toBeLessThan(text.indexOf("First Ticket"));
  });

  it("uses the axis format only until a caller supplies a better one", () => {
    // The y-axis is deliberately lossy — "13.0M" is right for a gridline and
    // wrong for someone who pointed at a turn to ask for the count.
    const { container, rerender } = renderGraph();
    fireEvent.pointerEnter(bands(container)[2]);
    expect(readout()?.textContent).toContain("58.74%");

    rerender(
      <LineGraph
        snapshots={SNAPSHOTS}
        series={SERIES}
        yValues={(id, snap) => snap.sharesPct[id] ?? null}
        yMax={100}
        yLabel={(v) => `${v}%`}
        tooltipValue={(v) => `${v.toFixed(1)}%`}
        xLabel={(snap) => `T${snap.turn}`}
      />
    );
    fireEvent.pointerEnter(bands(container)[2]);
    expect(readout()?.textContent).toContain("58.7%");
  });

  it("leaves out a series that had no value on that turn", () => {
    const { container } = renderGraph({
      yValues: (id, snap) => (id === "c2" ? null : (snap.sharesPct[id] ?? null)),
    });
    fireEvent.pointerEnter(bands(container)[2]);
    const text = readout()?.textContent ?? "";
    expect(text).toContain("First Ticket");
    expect(text).not.toContain("Second Ticket");
  });

  it("says so rather than showing an empty box when a turn counted nothing", () => {
    const { container } = renderGraph({ yValues: () => null });
    fireEvent.pointerEnter(bands(container)[1]);
    expect(readout()?.textContent).toContain("Nothing counted yet");
  });
});
