// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DoctrineTab } from "./DoctrineTab";
import { latestEraIndex, DEFAULT_ADOPTED, DEFAULT_POINTS } from "@/lib/military/doctrineTree";

afterEach(() => cleanup());

function seed() {
  return { adopted: { ...DEFAULT_ADOPTED }, points: DEFAULT_POINTS };
}

function renderTab(currentEra = latestEraIndex(), onAdopt = () => {}) {
  return render(
    <DoctrineTab
      currentEra={currentEra}
      doctrine={seed()}
      countryCode="us"
      positionId="secretary_of_defense"
      onAdopt={onAdopt}
    />
  );
}

describe("DoctrineTab (smoke render)", () => {
  it("renders the points header and category nav", () => {
    renderTab();
    expect(screen.getByText("Doctrine Points")).toBeTruthy();
    expect(screen.getByText("National Doctrine")).toBeTruthy();
    expect(screen.getByText(/gains 1 more at the start of each/)).toBeTruthy();
    // land category is selected by default; its firepower path is shown
    expect(screen.getByText("Firepower Warfare")).toBeTruthy();
  });

  it("adopts an available node via the API and reflects the returned state", async () => {
    const onAdopt = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          adopted: { ...DEFAULT_ADOPTED, "firepower-2": 1 },
          points: DEFAULT_POINTS - 2,
        }),
      })
    );
    renderTab(latestEraIndex(), onAdopt);
    // firepower-2 (Artillery Staff Schools) is available: firepower-0/1 are in the default set
    fireEvent.click(screen.getByText("Artillery Staff Schools"));
    expect(screen.getByText(/Adopt doctrine/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Adopt doctrine/));
    // the server-returned state marks the node adopted, and the office refetch fires
    expect(await screen.findByText("✓ Doctrine adopted")).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      "/api/country/us/executive/cabinet/secretary_of_defense/doctrine/adopt",
      expect.objectContaining({ method: "POST" })
    );
    expect(onAdopt).toHaveBeenCalled();
  });

  it("blocks a future-era node", () => {
    renderTab(4);
    // Multi-Domain Maneuver is a 2040s (d=14) node — future at era 4
    fireEvent.click(screen.getByText("Multi-Domain Maneuver"));
    expect(screen.getAllByText(/Requires .* era/).length).toBeGreaterThan(0);
  });

  it("scrolls the whole doctrine matrix as one, not one scrollbar per path", () => {
    const { container } = renderTab();
    // Four paths used to carry four independent scrollbars, which also let the
    // decade columns drift out of alignment with each other.
    const scrollers = container.querySelectorAll(".overflow-x-auto");
    expect(scrollers.length).toBe(1);
    // …and every path still renders inside that single scroller.
    const only = scrollers[0]!;
    for (const name of [
      "Maneuver Warfare",
      "Firepower Warfare",
      "Defensive Warfare",
      "Infantry-Centric Warfare",
    ]) {
      expect(only.textContent).toContain(name);
    }
  });

  it("keeps each path label pinned while the matrix scrolls", () => {
    renderTab();
    const label = screen.getByText("Firepower Warfare");
    expect(label.className).toContain("sticky");
    expect(label.className).toContain("left-0");
  });
});
