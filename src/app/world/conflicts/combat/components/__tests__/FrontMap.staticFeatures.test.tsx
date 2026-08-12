// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { ConflictView } from "../../useCombatState";
import { FrontMap } from "../FrontMap";

/**
 * North Vietnam's static feature, in the shape the shard actually ships: a
 * `regionCode` in properties and the entity id as the feature id.
 */
const NVN_FEATURE = {
  type: "Feature",
  id: "NVN",
  properties: { regionCode: "NVN", name: "North Vietnam" },
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [102, 17],
        [108, 17],
        [108, 23],
        [102, 23],
        [102, 17],
      ],
    ],
  },
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).includes("vietnam")
        ? { ok: true, json: async () => ({ features: [NVN_FEATURE] }) }
        : { ok: true, json: async () => ({ features: [] }) }
    )
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetModules();
});

const conflict = (over: Partial<ConflictView> = {}): ConflictView =>
  ({
    id: "vietnam",
    conflictId: 7,
    name: "Vietnam War",
    hostCountry: "NVN",
    // ⚠️ EMPTY, as it is in production: `regionCodesOfCountry` returns [] for a
    // host that is not a full-autonomous country, which is every proxy-war host.
    hostRegionCodes: [],
    control: 50,
    occupier: null,
    occupierCountry: null,
    sideALabel: "Republic of Vietnam",
    sideBLabel: "DRV",
    ...over,
  }) as unknown as ConflictView;

describe("FrontMap — proxy-war hosts", () => {
  it("renders the host's REGION, not just a meter", async () => {
    // ⚠️ Asserts the rendered path, not that `features` is non-empty. Both consumers
    // filter features against a roster that is [] for a proxy-war host, so a
    // non-empty assertion passes on the broken build while an EMPTY BOX renders.
    const { container } = render(<FrontMap conflict={conflict()} />);

    await waitFor(() => {
      const paths = container.querySelectorAll("svg path");
      expect(paths.length).toBeGreaterThan(0);
    });
  });

  it("falls back to the meter for a host with no geometry at all", async () => {
    // `hasGeometry` keys on the POST-filter count, so an unknown host draws the
    // meter rather than an empty map box.
    const { container } = render(
      <FrontMap conflict={conflict({ hostCountry: "ZZZ", name: "Nowhere War" })} />
    );

    await waitFor(() => {
      expect(container.querySelectorAll("svg path").length).toBe(0);
    });
    // The meter still reports the split.
    expect(screen.getByText(/Republic of Vietnam/)).toBeTruthy();
  });
});
