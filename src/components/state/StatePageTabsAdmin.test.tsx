/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { State } from "@/lib/db/types";
import { AdminTab } from "./StatePageTabsAdmin";

/**
 * Regression: UK regions used to mount a bespoke commons-only admin tab, so the
 * regional executive (First Minister) was missing from the appointer entirely.
 * They now use the generic, config-driven AdminTab — which must surface the
 * executive seat group AND label the held office with its real country title
 * ("First Minister" for the UK, whose executive officeType key is "governor"),
 * not the hardcoded "Governor".
 */
describe("AdminTab — regional executive (UK First Minister)", () => {
  const ukRegion = { _id: "NIR", countryId: "UK", name: "Northern Ireland" } as State;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        seatGroups: [
          {
            officeType: "governor",
            label: "First Minister",
            groupLabel: "First Minister",
            kind: "executive",
            multiSeat: false,
            vacant: 0,
            total: 1,
          },
          {
            officeType: "commons",
            label: "Commons MP",
            groupLabel: "Commons",
            kind: "lowerChamber",
            multiSeat: true,
            vacant: 0,
            total: 18,
          },
        ],
        filledOfficials: [
          {
            _id: "off-fm",
            officeType: "governor",
            seatsHeld: 1,
            characterId: "char-1",
            nppId: null,
            characterName: "Jane Stormont",
            party: "uk_dup",
            isNPP: false,
          },
        ],
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the executive seat group and labels the held office 'First Minister', not 'Governor'", async () => {
    render(<AdminTab state={ukRegion} players={[]} npps={[]} />);

    // Executive seat group is present in the appointer (was absent before the fix).
    await waitFor(() => {
      expect(screen.getAllByText("First Minister").length).toBeGreaterThan(0);
    });

    // The held executive office uses the config title, not the hardcoded "Governor".
    expect(screen.getByText("Jane Stormont")).toBeTruthy();
    expect(screen.queryByText("Governor")).toBeNull();
  });
});
