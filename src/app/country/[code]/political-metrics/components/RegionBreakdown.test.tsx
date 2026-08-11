/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RegionBreakdown } from "./RegionBreakdown";

afterEach(cleanup);

describe("RegionBreakdown", () => {
  it("sorts regions by value and shows delta vs national", () => {
    render(
      <RegionBreakdown
        nationalValue={60}
        regions={[
          { regionId: "AL", name: "Alabama", value: 52 },
          { regionId: "MI", name: "Michigan", value: 71 },
        ]}
      />
    );
    const rows = screen.getAllByRole("row");
    // rows[0] is the header; data rows sorted by value descending.
    expect(rows[1].textContent).toContain("Michigan");
    expect(rows[1].textContent).toContain("+11");
    expect(rows[2].textContent).toContain("Alabama");
    expect(rows[2].textContent).toContain("−8");
  });
});
