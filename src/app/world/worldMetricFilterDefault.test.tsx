/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorldMetricFilterProvider, useWorldMetricFilter } from "./WorldMetricFilterContext";

const preset = vi.fn<() => string | undefined>();
vi.mock("@/contexts/RegisteredCountriesContext", () => ({
  useActivePreset: () => preset(),
}));
vi.mock("@/lib/observability/fetchJson", () => ({
  fetchJson: vi.fn().mockResolvedValue(null),
}));

function ShowFilter() {
  const { metricFilter } = useWorldMetricFilter();
  return <span data-testid="type">{metricFilter.type}</span>;
}

const typeFor = (p: string | undefined) => {
  preset.mockReturnValue(p);
  const { unmount } = render(
    <WorldMetricFilterProvider>
      <ShowFilter />
    </WorldMetricFilterProvider>
  );
  const t = screen.getByTestId("type").textContent;
  unmount();
  return t;
};

describe("the globe's default view", () => {
  it("opens on Blocs in a world that has them", () => {
    // Who is on whose side is the first thing a player should read off the globe.
    expect(typeFor("1953-default")).toBe("blocs");
    expect(typeFor("1979-default")).toBe("blocs");
  });

  it("opens on Tiers where there are no blocs", () => {
    // Otherwise a 2019 world boots into a mode whose lookup is empty: tier
    // colours under a West/East/Non-Aligned legend, describing something that is
    // not on the screen — and with the Blocs chip hidden, nothing to name it.
    expect(typeFor("2019-default")).toBe("none");
    expect(typeFor(undefined)).toBe("none");
  });
});
