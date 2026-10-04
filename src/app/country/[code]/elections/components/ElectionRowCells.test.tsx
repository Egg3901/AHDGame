// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ElectionDisplay } from "@/lib/db/types";
import { RegionCell } from "./ElectionRowCells";

const race = (over: Partial<ElectionDisplay>) =>
  ({
    id: "e1",
    electionType: "commons",
    state: "EAE",
    countryId: "UK",
    totalSeats: 47,
    candidates: [],
    ...over,
  }) as unknown as ElectionDisplay;

describe("RegionCell", () => {
  it("tags a by-election so it reads apart from the region's regular race", () => {
    // Ticket 1379: both rows sit in the House of Commons section under the same
    // region, and only the seat count told them apart.
    render(<RegionCell election={race({ electionType: "special_commons", totalSeats: 12 })} />);
    expect(screen.getByText("By-election")).toBeTruthy();
    expect(screen.getByText("12 seats")).toBeTruthy();
  });

  it("leaves the regular race untagged", () => {
    render(<RegionCell election={race({})} />);
    expect(screen.queryByText("By-election")).toBeNull();
    expect(screen.getByText("47 seats")).toBeTruthy();
  });
});
