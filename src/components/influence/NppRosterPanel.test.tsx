/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NppRosterPanel } from "./NppRosterPanel";
import type { ActionOption, NPPOption } from "./types";

const ACTIONS: ActionOption[] = [
  {
    type: "boost_loyalty",
    name: "Boost Loyalty",
    description: "",
    actionCost: 1,
    baseFundCost: 12000,
    baseChance: 80,
    available: true,
  },
  {
    type: "boost_influence",
    name: "Boost Influence",
    description: "",
    actionCost: 2,
    baseFundCost: 18000,
    baseChance: 95,
    available: true,
  },
];
const NPPS: NPPOption[] = [
  {
    id: "a",
    sequentialId: 42,
    name: "Ada Low",
    party: "9",
    estimatedChance: 80,
    stats: {
      favorability: 20,
      politicalInfluence: 50,
      loyalty: 20,
      ambition: 40,
      stubbornness: 30,
    },
    currentOfficeLabel: null,
    activeCandidacyLabel: "Senate (Class 2)",
  },
  {
    id: "b",
    name: "Ben Hi",
    party: "9",
    estimatedChance: 80,
    stats: {
      favorability: 80,
      politicalInfluence: 70,
      loyalty: 90,
      ambition: 60,
      stubbornness: 10,
    },
    currentOfficeLabel: "Mayor",
    activeCandidacyLabel: null,
  },
];

afterEach(() => vi.restoreAllMocks());

function setup(scope: "state" | "national" = "national") {
  const onExecute = vi.fn().mockResolvedValue({ ok: true });
  render(
    <NppRosterPanel
      scope={scope}
      npps={NPPS.map((n) => ({
        ...n,
        homeState: scope === "national" ? (n.id === "a" ? "CA" : "NY") : "CA",
      }))}
      actions={ACTIONS}
      onExecute={onExecute}
    />
  );
  return { onExecute };
}

describe("NppRosterPanel", () => {
  it("names the race a candidate is running in rather than a bare Running tag", () => {
    setup();
    expect(screen.getByText(/Running: Senate \(Class 2\)/)).toBeTruthy();
  });

  it("links each NPP name to their profile, falling back to the id without a sequentialId", () => {
    setup();
    expect(screen.getByRole("link", { name: "Ada Low" }).getAttribute("href")).toBe(
      "/politicians/npp/42"
    );
    expect(screen.getByRole("link", { name: "Ben Hi" }).getAttribute("href")).toBe(
      "/politicians/npp/b"
    );
  });

  it("renders a roster row per NPP with an attention dot on the flagged one", () => {
    setup();
    expect(screen.getByText("Ada Low")).toBeTruthy();
    expect(screen.getByText("Ben Hi")).toBeTruthy();
    expect(screen.getAllByTitle(/Low loyalty|Low favorability/).length).toBeGreaterThan(0);
  });

  it("filters to needs-attention", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Needs attention/ }));
    expect(screen.getByText("Ada Low")).toBeTruthy();
    expect(screen.queryByText("Ben Hi")).toBeNull();
  });

  it("shows a state filter only in national scope", () => {
    setup("national");
    expect(screen.getByLabelText(/state/i)).toBeTruthy();
  });

  it("select-all selects every currently-filtered row", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Select all/ }));
    expect(screen.getByText("2 selected")).toBeTruthy();
  });

  it("select-all only covers the filtered subset", () => {
    setup();
    // Needs-attention filter narrows to Ada Low only.
    fireEvent.click(screen.getByRole("button", { name: /Needs attention/ }));
    fireEvent.click(screen.getByRole("button", { name: /Select all/ }));
    expect(screen.getByText("1 selected")).toBeTruthy();
  });

  it("keeps the selection after a bulk action so you can act again", async () => {
    const { onExecute } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Select all/ }));
    expect(screen.getByText("2 selected")).toBeTruthy();

    // Open a bulk action then confirm it.
    fireEvent.click(screen.getByRole("button", { name: "Boost Loyalty" }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));

    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(2));
    // Selection is retained (not cleared) so the player can run another action.
    expect(screen.getByText("2 selected")).toBeTruthy();
  });
});
