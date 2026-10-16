// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import DemandDriverBanner from "./DemandDriverBanner";
import type { DemandDriver } from "../types";

const driver: DemandDriver = {
  type: "corporate",
  label: "Corporate Demand",
  description: "Global demand includes plant inputs and other market demand.",
  sourceLabel: "Other global demand (including marketing)",
  sourceUnits: 100,
};

afterEach(cleanup);

describe("DemandDriverBanner", () => {
  it("omits an unavailable share instead of inventing zero percent", () => {
    render(<DemandDriverBanner demandDriver={driver} unit="campaigns" />);

    expect(screen.getByText("100 campaigns/day")).toBeTruthy();
    expect(screen.queryByText(/% of total demand/)).toBeNull();
  });

  it("preserves an explicitly recorded zero share", () => {
    render(<DemandDriverBanner demandDriver={{ ...driver, sourceShare: 0 }} unit="campaigns" />);

    expect(screen.getByText("(0.0% of total demand)")).toBeTruthy();
  });
});
