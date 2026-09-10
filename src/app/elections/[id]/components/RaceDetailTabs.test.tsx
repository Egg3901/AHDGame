/** @vitest-environment happy-dom */
/**
 * The tab shell the race's detail views share.
 *
 * They used to run down the page one after another — two full maps of the
 * United States, a trends chart, the state drivers and the factor ledger — so
 * reading any one meant scrolling past the rest.
 */
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RaceDetailTabs, type RaceDetailPane } from "./RaceDetailTabs";

const PANES: RaceDetailPane[] = [
  { id: "map", label: "Electoral", content: <div>the map</div> },
  {
    id: "presence",
    label: "Campaign presence",
    content: <div>the presence map</div>,
    hash: "#state-org",
  },
  { id: "trends", label: "Trends", content: <div>the charts</div> },
];

afterEach(() => {
  window.location.hash = "";
});

const paneFor = (text: string) => screen.getByText(text).closest("[role=tabpanel]");

describe("swapping between a race's detail views", () => {
  it("opens on the first pane", () => {
    render(<RaceDetailTabs panes={PANES} />);
    expect(paneFor("the map")).not.toHaveProperty("hidden", true);
    expect(paneFor("the charts")?.hasAttribute("hidden")).toBe(true);
  });

  it("gives every pane a tab", () => {
    render(<RaceDetailTabs panes={PANES} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Electoral",
      "Campaign presence",
      "Trends",
    ]);
  });

  it("swaps which pane is shown without unmounting the others", () => {
    // The presence map fetches its own state list and the electoral map holds a
    // selected state; unmounting on each switch would throw that away.
    render(<RaceDetailTabs panes={PANES} />);
    fireEvent.click(screen.getByRole("tab", { name: "Trends" }));
    expect(paneFor("the charts")?.hasAttribute("hidden")).toBe(false);
    expect(paneFor("the map")?.hasAttribute("hidden")).toBe(true);
    // Still in the document, just hidden.
    expect(screen.getByText("the map")).toBeTruthy();
  });

  it("marks the open tab for assistive tech", () => {
    render(<RaceDetailTabs panes={PANES} />);
    fireEvent.click(screen.getByRole("tab", { name: "Trends" }));
    expect(screen.getByRole("tab", { name: "Trends" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Electoral" }).getAttribute("aria-selected")).toBe(
      "false"
    );
  });

  it("opens the pane a deep link asked for", () => {
    // `#state-org` is live: the campaign manager links to it on this page and
    // the presidential primary page links to it from outside. Landing on the
    // section with that pane hidden would be worse than not moving it.
    window.location.hash = "#state-org";
    render(<RaceDetailTabs panes={PANES} />);
    expect(paneFor("the presence map")?.hasAttribute("hidden")).toBe(false);
  });

  it("follows the hash when it changes on a page already open", () => {
    render(<RaceDetailTabs panes={PANES} />);
    expect(paneFor("the map")?.hasAttribute("hidden")).toBe(false);
    window.location.hash = "#state-org";
    fireEvent(window, new Event("hashchange"));
    expect(paneFor("the presence map")?.hasAttribute("hidden")).toBe(false);
  });

  it("keeps the anchor on the section, so the deep link still lands", () => {
    const { container } = render(<RaceDetailTabs panes={PANES} />);
    expect(container.querySelector("#state-org")).toBeTruthy();
  });

  it("draws no tab strip for a single pane, which has nothing to swap to", () => {
    render(<RaceDetailTabs panes={[PANES[0]]} />);
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByText("the map")).toBeTruthy();
  });

  it("renders nothing at all when there are no panes", () => {
    const { container } = render(<RaceDetailTabs panes={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
